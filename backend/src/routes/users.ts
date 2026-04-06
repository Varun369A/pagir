/**
 * PAGIR 2 — User / directory routes
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../plugins/auth'
import { userController } from '../controllers/userController'

const PAGIR_ID = /^PAG-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/

const UpdatePublicKeyBody = z.object({
  publicKey: z.string().min(10).max(8000),
})

export function registerUserRoutes(app: FastifyInstance): void {

  // GET /users/me — authenticated, returns own profile (used for key recovery)
  app.get('/users/me', { preHandler: [authenticate] }, async (req, reply) => {
    const data = await userController.getMyProfile(req.user.sub)
    return reply.status(200).send({ success: true, data })
  })

  // GET /users/:pagirId — public, phonebook lookup
  app.get('/users/:pagirId', async (req, reply) => {
    const { pagirId } = req.params as { pagirId: string }
    if (!PAGIR_ID.test(pagirId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid PAGIR ID format', requestId: req.id },
      })
    }
    const data = await userController.getPublicProfile(pagirId)
    return reply.status(200).send({ success: true, data })
  })

  // PUT /users/me/public-key — authenticated, rotate public key
  app.put('/users/me/public-key', { preHandler: [authenticate] }, async (req, reply) => {
    const body = UpdatePublicKeyBody.parse(req.body)
    await userController.updatePublicKey(req.user.sub, body.publicKey)
    return reply.status(200).send({ success: true, data: { message: 'Public key updated' } })
  })
}
