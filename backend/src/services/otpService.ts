/**
 * PAGIR 2 — OTP Service
 *
 * Handles three OTP flows:
 *
 *   1. Standard (sendOtp / verifyOtp):
 *      Phone + email → OTP sent to email → verify returns JWT + pagirId
 *      Also returns alreadyRegistered flag so the UI can redirect to Login
 *
 *   2. Email recovery (sendOtpByEmail / verifyOtpByEmail):
 *      Email only → OTP sent if email is registered → verify returns JWT
 *      Intended for users who forgot their phone number
 *
 * Privacy notes:
 *   - OTP is never stored in plaintext; only bcrypt hash persists
 *   - Phone number is never stored; only HMAC hash
 *   - Email enumeration prevented: sendOtpByEmail always returns same message
 */

import bcrypt from 'bcryptjs'
import { Resend } from 'resend'
import { env } from '../config/env'
import { getRedis, RedisKey, TTL } from '../config/redis'
import {
  generateOtp, generatePhoneSalt, phoneHash, stablePhoneHash,
  emailHash, rateLimitPhoneHash,
} from '../utils/hash'
import { userRepo } from '../repositories/userRepo'
import { otpRepo } from '../repositories/otpRepo'
import { tokenService } from './tokenService'
import { AppError } from '../plugins/errorHandler'
import { ErrorCode } from '../types'
import { logger } from '../utils/logger'

const OTP_EXPIRY_S         = 600   // 10 minutes
const RATE_PHONE_MAX        = 5    // per hour
const RATE_IP_MAX           = 10   // per 10 minutes

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) {
    if (!env.RESEND_API_KEY) throw AppError.internal('RESEND_API_KEY not configured')
    _resend = new Resend(env.RESEND_API_KEY)
  }
  return _resend
}

export const otpService = {
  // ── Standard flow ──────────────────────────────────────────────────────────

  async sendOtp(
    phoneNumber: string,
    email: string,
    ipAddress: string
  ): Promise<{ message: string; alreadyRegistered: boolean }> {
    const redis = getRedis()

    // ─── Rate limiting ────────────────────────────────────────────────────
    const rlPhone = rateLimitPhoneHash(phoneNumber)
    const [phoneCount, ipCount] = await Promise.all([
      redis.incr(RedisKey.otpRatePhone(rlPhone)),
      redis.incr(RedisKey.otpRateIp(ipAddress)),
    ])
    if (phoneCount === 1) await redis.expire(RedisKey.otpRatePhone(rlPhone), TTL.RATE_PHONE)
    if (ipCount === 1)    await redis.expire(RedisKey.otpRateIp(ipAddress), TTL.RATE_IP)
    if (phoneCount > RATE_PHONE_MAX) {
      throw AppError.tooManyRequests(ErrorCode.OTP_RATE_LIMITED, 'Too many requests. Please wait before trying again.')
    }
    if (ipCount > RATE_IP_MAX) {
      throw AppError.tooManyRequests(ErrorCode.OTP_RATE_LIMITED, 'Too many requests from this device.')
    }

    // ─── Check if already registered ─────────────────────────────────────
    const stableHash = stablePhoneHash(phoneNumber)
    const existingUser = await userRepo.findByStableHash(stableHash)
    const alreadyRegistered = existingUser !== null

    // ─── Generate OTP ─────────────────────────────────────────────────────
    const otp     = generateOtp()
    const otpHash = await bcrypt.hash(otp, env.BCRYPT_ROUNDS)

    // ─── Session storage ──────────────────────────────────────────────────
    const salt     = generatePhoneSalt()
    const pHash    = phoneHash(phoneNumber, salt)
    const session  = await otpRepo.create({
      phoneHash: pHash,
      otpHash,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_S * 1000),
      ipAddress,
    })
    const payload = JSON.stringify({ sessionId: session.id, phoneNumber, salt, phoneHash: pHash, email })
    await Promise.all([
      redis.setex(RedisKey.otpSession(pHash),   TTL.OTP_SESSION, payload),
      redis.setex(RedisKey.otpLookup(stableHash), TTL.OTP_SESSION, payload),
    ])

    await _deliverOtp(email, otp)

    logger.info({ requestType: 'otp_sent', alreadyRegistered }, 'OTP sent')
    return { message: 'Verification code sent to your email', alreadyRegistered }
  },

  async verifyOtp(
    phoneNumber: string,
    otpCode: string,
    pagirId: string,
    deviceFingerprint: string,
    displayName: string,
    publicKeyPem: string,
    _ipAddress: string
  ): Promise<{ accessToken: string; refreshToken: string; pagirId: string; isNewUser: boolean }> {
    const redis = getRedis()
    const stableHash = stablePhoneHash(phoneNumber)

    // ─── Find session ──────────────────────────────────────────────────────
    const raw = await redis.get(RedisKey.otpLookup(stableHash))
    if (!raw) throw AppError.badRequest(ErrorCode.OTP_INVALID, 'Invalid or expired verification code')

    const phoneData = JSON.parse(raw as string) as {
      sessionId: string; phoneNumber: string; salt: string; phoneHash: string; email: string
    }
    if (phoneData.phoneNumber !== phoneNumber) {
      throw AppError.badRequest(ErrorCode.OTP_INVALID, 'Invalid or expired verification code')
    }

    const session = await otpRepo.findById(phoneData.sessionId)
    if (!session || session.expiresAt < new Date() || session.attempts >= 3) {
      await redis.del(RedisKey.otpLookup(stableHash))
      throw AppError.badRequest(ErrorCode.OTP_INVALID, 'Verification code expired. Please request a new one.')
    }

    const valid = await bcrypt.compare(otpCode, session.otpHash)
    if (!valid) {
      await otpRepo.incrementAttempts(session.id)
      const left = session.maxAttempts - session.attempts - 1
      throw AppError.badRequest(
        ErrorCode.OTP_INVALID,
        left > 0
          ? `Invalid code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Please request a new code.'
      )
    }

    // ─── Consume session ───────────────────────────────────────────────────
    await Promise.all([
      otpRepo.delete(session.id),
      redis.del(RedisKey.otpSession(phoneData.phoneHash)),
      redis.del(RedisKey.otpLookup(stableHash)),
    ])

    // ─── Resolve user ──────────────────────────────────────────────────────
    let existingUser = await userRepo.findByStableHash(stableHash)

    // Backfill: find pre-migration users with null stablePhoneHash
    if (!existingUser) {
      const legacyUsers = await userRepo.findLegacyUsers()
      for (const u of legacyUsers) {
        const hash = (await import('../utils/hash')).phoneHash(phoneData.phoneNumber, u.phoneSalt)
        if (hash === u.phoneHash) {
          existingUser = await userRepo.backfillStableHash(u.id, stableHash)
          logger.info({ requestType: 'stable_hash_backfill', pagirId: u.id }, 'Backfilled stableHash')
          break
        }
      }
    }

    let resolvedPagirId: string
    let isNewUser: boolean

    if (!existingUser) {
      // New registration
      await userRepo.create({
        id: pagirId,
        phoneHash: phoneData.phoneHash,
        phoneSalt: phoneData.salt,
        stablePhoneHash: stableHash,
        email: phoneData.email,
        displayName,
        publicKey: publicKeyPem,
        deviceFingerprint,
      })
      resolvedPagirId = pagirId
      isNewUser = true
      logger.info({ requestType: 'user_registered' }, 'New user registered')
    } else if (existingUser.revokedAt !== null) {
      // Re-registration after emergency wipe
      await userRepo.revokeWithSuffix(existingUser.id, existingUser.id.slice(-8))
      await userRepo.create({
        id: pagirId,
        phoneHash: phoneData.phoneHash,
        phoneSalt: phoneData.salt,
        stablePhoneHash: stableHash,
        email: phoneData.email,
        displayName,
        publicKey: publicKeyPem,
        deviceFingerprint,
      })
      resolvedPagirId = pagirId
      isNewUser = true
      logger.info({ requestType: 'reregistration', oldPagirId: existingUser.id }, 'Re-registered after wipe')
    } else {
      // Returning user
      const isNewDevice = existingUser.deviceFingerprint !== deviceFingerprint
      await userRepo.updateOnLogin(existingUser.id, {
        displayName,
        publicKey: publicKeyPem,
        phoneHash: phoneData.phoneHash,
        phoneSalt: phoneData.salt,
        ...(isNewDevice ? { deviceFingerprint } : {}),
      })
      resolvedPagirId = existingUser.id
      isNewUser = false
      logger.info({ requestType: 'otp_verified', pagirId: resolvedPagirId }, 'OTP verified')
    }

    const tokens = await tokenService.issue(resolvedPagirId)
    return { ...tokens, pagirId: resolvedPagirId, isNewUser }
  },

  // ── Email recovery flow ────────────────────────────────────────────────────

  async sendOtpByEmail(
    email: string,
    ipAddress: string
  ): Promise<{ message: string }> {
    const redis = getRedis()

    // Rate limit by IP
    const ipKey = `${ipAddress}:email`
    const ipCount = await redis.incr(RedisKey.otpRateIp(ipKey))
    if (ipCount === 1) await redis.expire(RedisKey.otpRateIp(ipKey), TTL.RATE_IP)
    if (ipCount > RATE_IP_MAX) {
      throw AppError.tooManyRequests(ErrorCode.OTP_RATE_LIMITED, 'Too many requests from this device.')
    }

    const user = await userRepo.findByEmail(email)
    if (user) {
      const otp    = generateOtp()
      const hash   = await bcrypt.hash(otp, env.BCRYPT_ROUNDS)
      const eHash  = emailHash(email)
      await redis.setex(
        RedisKey.otpByEmail(eHash),
        TTL.OTP_SESSION,
        JSON.stringify({ otpHash: hash, pagirId: user.id, email: user.email })
      )
      await _deliverOtp(user.email!, otp)
      logger.info({ requestType: 'otp_by_email_sent' }, 'Email-only OTP sent')
    }

    // Always same message — no email enumeration
    return { message: 'If that email is registered, a verification code has been sent.' }
  },

  async verifyOtpByEmail(
    email: string,
    otpCode: string
  ): Promise<{ accessToken: string; refreshToken: string; pagirId: string }> {
    const redis  = getRedis()
    const eHash  = emailHash(email)
    const raw    = await redis.get(RedisKey.otpByEmail(eHash))
    if (!raw) throw AppError.badRequest(ErrorCode.OTP_INVALID, 'Invalid or expired verification code')

    const data = JSON.parse(raw as string) as { otpHash: string; pagirId: string; email: string }
    const valid = await bcrypt.compare(otpCode, data.otpHash)
    if (!valid) throw AppError.badRequest(ErrorCode.OTP_INVALID, 'Invalid verification code')

    await redis.del(RedisKey.otpByEmail(eHash))

    const user = await userRepo.findActiveById(data.pagirId)
    if (!user) throw AppError.notFound(ErrorCode.USER_NOT_FOUND, 'Account not found or revoked')

    const tokens = await tokenService.issue(user.id)
    logger.info({ requestType: 'otp_by_email_verified', pagirId: user.id }, 'Email-only OTP verified')
    return { ...tokens, pagirId: user.id }
  },

  // ── Emergency wipe ─────────────────────────────────────────────────────────

  async emergencyWipe(
    oldPagirId: string,
    newPagirId: string,
    newPublicKey: string
  ): Promise<{ message: string; newPagirId: string }> {
    const redis   = getRedis()
    const oldUser = await userRepo.findById(oldPagirId)
    if (!oldUser) throw AppError.notFound(ErrorCode.USER_NOT_FOUND, 'PAGIR ID not found')

    // Idempotent: already revoked (previous wipe partially completed)
    if (oldUser.revokedAt !== null) {
      const existingNew = await userRepo.findById(newPagirId)
      if (!existingNew) {
        await userRepo.create({
          id: newPagirId,
          phoneHash: oldUser.phoneHash.replace(/:revoked:[a-z0-9]+$/, ''),
          phoneSalt: oldUser.phoneSalt,
          stablePhoneHash: null,
          email: oldUser.email,
          displayName: oldUser.displayName,
          publicKey: newPublicKey,
          deviceFingerprint: oldUser.deviceFingerprint,
        })
      }
      return { message: 'PAGIR ID revoked. New ID registered.', newPagirId }
    }

    await userRepo.revokeWithSuffix(oldPagirId, oldPagirId.slice(-8))
    await redis.setex(RedisKey.pagirIdRevoked(oldPagirId), TTL.PAGIR_ID_REVOKED, '1')

    await userRepo.create({
      id: newPagirId,
      phoneHash: oldUser.phoneHash,
      phoneSalt: oldUser.phoneSalt,
      stablePhoneHash: oldUser.stablePhoneHash,
      email: oldUser.email,
      displayName: oldUser.displayName,
      publicKey: newPublicKey,
      deviceFingerprint: oldUser.deviceFingerprint,
    })

    await redis.del(RedisKey.refreshToken(oldPagirId))

    logger.info({ requestType: 'emergency_wipe', oldPagirId, newPagirId }, 'Emergency wipe complete')
    return { message: 'PAGIR ID revoked. New ID registered.', newPagirId }
  },

  // ── Delete account ─────────────────────────────────────────────────────────

  async deleteAccount(pagirId: string): Promise<void> {
    const user = await userRepo.findById(pagirId)
    if (!user) throw AppError.notFound(ErrorCode.USER_NOT_FOUND, 'Account not found')

    await userRepo.hardDelete(pagirId)

    const redis = getRedis()
    await Promise.all([
      redis.del(RedisKey.refreshToken(pagirId)),
      redis.del(RedisKey.pagirIdRevoked(pagirId)),
    ])

    logger.info({ requestType: 'account_deleted', pagirId }, 'Account permanently deleted')
  },
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _deliverOtp(email: string, otp: string): Promise<void> {
  if (env.OTP_PROVIDER === 'LOG') {
    logger.info({ dev_otp: otp, requestType: 'otp_log_delivery' }, '[DEV] OTP — check logs')
    return
  }
  const { error } = await getResend().emails.send({
    from: env.RESEND_FROM!,
    to: email,
    subject: 'Your PAGIR verification code',
    html: _otpEmailHtml(otp),
    text: `Your PAGIR verification code is: ${otp}\n\nValid for 10 minutes. Do not share this code.`,
  })
  if (error) {
    logger.error({ resendError: error }, 'Failed to deliver OTP via Resend')
    throw AppError.internal('Failed to send verification email. Please try again.')
  }
}

function _otpEmailHtml(otp: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>PAGIR Verification</title></head>
<body style="margin:0;padding:0;background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:48px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#1a1a24;border-radius:16px;border:1px solid #2d2d3d;">
        <tr><td style="padding:40px 40px 32px;text-align:center;">
          <div style="display:inline-block;width:56px;height:56px;border-radius:14px;background:#0f0f12;border:1px solid #a78bfa;text-align:center;line-height:56px;font-size:28px;font-weight:700;color:#a78bfa;margin-bottom:24px;">P</div>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f9fafb;">Verify your email</h1>
          <p style="margin:0 0 32px;font-size:14px;color:#6b7280;">Enter this code in PAGIR to complete sign-in.</p>
          <div style="background:#0f0f12;border:1px solid #2d2d3d;border-radius:12px;padding:24px;margin-bottom:32px;">
            <span style="font-size:40px;font-weight:700;color:#a78bfa;letter-spacing:8px;">${otp}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#4b5563;">Valid for 10 minutes &nbsp;·&nbsp; Do not share this code</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
