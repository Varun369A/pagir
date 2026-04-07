/**
 * PAGIR 2 — Auth routes
 *
 * Route-level validation with Zod. Controllers handle business logic.
 * All routes return { success, data } or let the error handler return { success: false, error }.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../plugins/auth'
import { authController } from '../controllers/authController'

const PAGIR_ID = /^PAG-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/
const PHONE    = /^\+\d{7,15}$/

const SendOtpBody = z.object({
  phoneNumber: z.string().regex(PHONE, 'Phone must be E.164 format (+CC followed by digits)'),
  email:       z.string().email('Invalid email address'),
})

const VerifyOtpBody = z.object({
  phoneNumber:       z.string().regex(PHONE),
  otp:               z.string().length(6).regex(/^\d{6}$/),
  pagirId:           z.string().regex(PAGIR_ID, 'Invalid PAGIR ID format'),
  deviceFingerprint: z.string().length(64).regex(/^[0-9a-f]{64}$/),
  name:              z.string().min(1).max(100).default('PAGIR User'),
  publicKey:         z.string().min(10).max(8000),
})

const SendOtpByEmailBody = z.object({
  email: z.string().email(),
})

const VerifyOtpByEmailBody = z.object({
  email: z.string().email(),
  otp:   z.string().length(6).regex(/^\d{6}$/),
})

const EmergencyWipeBody = z.object({
  newPagirId:  z.string().regex(PAGIR_ID),
  newPublicKey: z.string().min(10).max(8000),
})

export function registerAuthRoutes(app: FastifyInstance): void {

  // POST /auth/otp/send
  app.post('/auth/otp/send', async (req, reply) => {
    const body = SendOtpBody.parse(req.body)
    const data = await authController.sendOtp(body.phoneNumber, body.email, req.ip)
    return reply.status(200).send({ success: true, data })
  })

  // POST /auth/otp/verify
  app.post('/auth/otp/verify', async (req, reply) => {
    const body = VerifyOtpBody.parse(req.body)
    const data = await authController.verifyOtp(body, req.ip)
    return reply.status(data.isNewUser ? 201 : 200).send({
      success: true,
      data: {
        accessToken:  data.accessToken,
        refreshToken: data.refreshToken,
        pagirId:      data.pagirId,
        isNewUser:    data.isNewUser,
        tokenType:    'Bearer',
      },
    })
  })

  // POST /auth/otp/send-by-email
  app.post('/auth/otp/send-by-email', async (req, reply) => {
    const body = SendOtpByEmailBody.parse(req.body)
    const data = await authController.sendOtpByEmail(body.email, req.ip)
    return reply.status(200).send({ success: true, data })
  })

  // POST /auth/otp/verify-by-email
  app.post('/auth/otp/verify-by-email', async (req, reply) => {
    const body = VerifyOtpByEmailBody.parse(req.body)
    const data = await authController.verifyOtpByEmail(body.email, body.otp)
    return reply.status(200).send({
      success: true,
      data: { ...data, tokenType: 'Bearer' },
    })
  })

  // POST /auth/token/refresh
  app.post('/auth/token/refresh', async (req, reply) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string }
    if (!refreshToken) {
      return reply.status(400).send({
        success: false,
        error: { code: 'TOKEN_INVALID', message: 'refreshToken required', requestId: req.id },
      })
    }
    const data = await authController.refreshToken(refreshToken)
    return reply.status(200).send({ success: true, data: { ...data, tokenType: 'Bearer' } })
  })

  // POST /auth/logout — authenticated
  app.post('/auth/logout', { preHandler: [authenticate] }, async (req, reply) => {
    await authController.logout(req.user.sub, req.user.jti)
    return reply.status(200).send({ success: true, data: { message: 'Logged out successfully' } })
  })

  // POST /auth/emergency-wipe — authenticated
  app.post('/auth/emergency-wipe', { preHandler: [authenticate] }, async (req, reply) => {
    const body = EmergencyWipeBody.parse(req.body)
    const data = await authController.emergencyWipe(req.user.sub, body.newPagirId, body.newPublicKey)
    return reply.status(200).send({ success: true, data })
  })

  // DELETE /auth/account — authenticated, permanent deletion
  app.delete('/auth/account', { preHandler: [authenticate] }, async (req, reply) => {
    await authController.deleteAccount(req.user.sub, req.user.jti)
    return reply.status(200).send({ success: true, data: { message: 'Account permanently deleted' } })
  })
}
