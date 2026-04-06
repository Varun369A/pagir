/**
 * PAGIR 2 — Cryptographic utilities
 *
 * All hash functions are pure — no side effects, no I/O.
 * Phone numbers never leave these functions in plaintext.
 */

import crypto from 'crypto'
import { env } from '../config/env'

// OTP: 6-digit numeric code
export function generateOtp(): string {
  // Use crypto.randomInt for cryptographically secure random digits
  return String(crypto.randomInt(100_000, 999_999))
}

// Per-OTP-session random salt (16 bytes hex = 32 chars)
export function generatePhoneSalt(): string {
  return crypto.randomBytes(16).toString('hex')
}

// Per-record phone hash — changes on every OTP send (random salt)
// Used to match phone→OTP-session within a single send/verify cycle
export function phoneHash(phone: string, salt: string): string {
  return crypto
    .createHmac('sha256', salt + env.PHONE_SALT_SECRET)
    .update(phone)
    .digest('hex')
}

// Stable phone hash — deterministic per phone + server secret
// Used for O(1) login: look up user by stablePhoneHash across sessions
export function stablePhoneHash(phone: string): string {
  return crypto
    .createHmac('sha256', env.PHONE_SALT_SECRET)
    .update(phone.replace(/\s/g, ''))
    .digest('hex')
}

// Email hash — for Redis keys (no plaintext email as key)
export function emailHash(email: string): string {
  return crypto
    .createHmac('sha256', env.PHONE_SALT_SECRET + ':email')
    .update(email.toLowerCase())
    .digest('hex')
}

// Rate-limit hash — per-phone bucket (no IP tracking of phone numbers)
export function rateLimitPhoneHash(phone: string): string {
  return crypto
    .createHmac('sha256', 'ratelimit')
    .update(phone)
    .digest('hex')
}

// JWT JTI — unique token identifier for revocation
export function generateJti(): string {
  return crypto.randomBytes(16).toString('hex')
}

// Request ID — 12-char base36 for X-Request-ID header
export function generateRequestId(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12)
}
