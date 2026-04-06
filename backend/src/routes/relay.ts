/**
 * PAGIR 2 — Blind Frame Relay (REST mode)
 *
 * Server forwards PAGIR frames between authenticated users WITHOUT being
 * able to read the content (zero-knowledge relay).
 *
 * WHAT THE SERVER SEES:
 *   - senderId (from JWT — authenticated)
 *   - receiverId (from request body — routing only)
 *   - encryptedPayload (opaque bytes — server cannot decrypt)
 *
 * WHAT THE SERVER CANNOT SEE:
 *   - Message content, file content, session keys
 *
 * WebSocket mode: pending Fastify 5 compatible @fastify/websocket release.
 * Until then all relay goes through POST /relay/frame (polling model).
 *
 * SECURITY:
 *   - JWT authentication required
 *   - Rate limiting: max 20 frames/sec per sender
 *   - Max frame size: 2MB
 *   - Receiver must be a registered user
 */

import type { FastifyInstance } from 'fastify'
import { authenticate } from '../plugins/auth'
import { userRepo } from '../repositories/userRepo'
import { redis, RedisKey, TTL } from '../config/redis'
import { AppError } from '../plugins/errorHandler'
import { ErrorCode } from '../types'
import { logger } from '../utils/logger'

const MAX_FRAME_SIZE   = 2 * 1024 * 1024   // 2 MB
const MAX_FRAMES_PER_S = 20
const RATE_WINDOW_S    = 1

export async function relayRoutes(app: FastifyInstance) {
  // ─── POST /relay/frame — send an encrypted frame ─────────────────────────
  app.post('/relay/frame', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['receiverId', 'frameBase64'],
        properties: {
          receiverId:  { type: 'string', minLength: 15, maxLength: 22 },
          frameBase64: { type: 'string', maxLength: Math.ceil(MAX_FRAME_SIZE * 4 / 3) + 8 },
        },
      },
    },
  }, async (request: any, reply: any) => {
    const { receiverId, frameBase64 } = request.body as {
      receiverId: string
      frameBase64: string
    }
    const senderId = request.user.pagirId

    const frameRaw = Buffer.from(frameBase64, 'base64')

    if (frameRaw.length > MAX_FRAME_SIZE) {
      throw AppError.badRequest(ErrorCode.FRAME_TOO_LARGE, 'Frame exceeds 2 MB limit')
    }

    // Rate limit per sender (sliding window in Redis)
    const rateKey = RedisKey.relayRateLimit(senderId)
    const now     = Date.now()
    await redis.zadd(rateKey, { score: now, member: `${now}-${Math.random()}` })
    await redis.zremrangebyscore(rateKey, 0, now - RATE_WINDOW_S * 1000)
    const count = await redis.zcard(rateKey)
    await redis.expire(rateKey, RATE_WINDOW_S + 5)

    if (count > MAX_FRAMES_PER_S) {
      throw AppError.tooManyRequests(ErrorCode.RATE_LIMIT_EXCEEDED, 'Relay rate limit exceeded')
    }

    if (frameRaw.length < 72) {
      throw AppError.badRequest(ErrorCode.INVALID_FRAME, 'Frame too short — invalid PAGIR frame')
    }

    // Verify receiver exists
    const receiver = await userRepo.findActiveById(receiverId)
    if (!receiver) {
      throw AppError.notFound(ErrorCode.RECEIVER_NOT_FOUND, 'Receiver not found')
    }

    // Queue for offline delivery (TTL 48h, max 1000 frames per user)
    const queueKey   = RedisKey.offlineQueue(receiverId)
    const frameEntry = JSON.stringify({
      senderId,
      frame: frameBase64,
      ts:    now,
    })
    await redis.lpush(queueKey, frameEntry)
    await redis.expire(queueKey, TTL.offlineQueue)
    await redis.ltrim(queueKey, 0, 999)

    logger.debug({ senderId, receiverId, bytes: frameRaw.length }, 'relay: frame queued')
    return reply.send({ success: true, queued: true })
  })

  // ─── GET /relay/poll — fetch queued frames for the authenticated user ─────
  app.get('/relay/poll', {
    preHandler: authenticate,
  }, async (request: any, reply: any) => {
    const pagirId  = request.user.pagirId
    const queueKey = RedisKey.offlineQueue(pagirId)

    // Drain up to 50 frames per poll
    const entries = await redis.lrange(queueKey, 0, 49)
    if (entries.length > 0) {
      await redis.ltrim(queueKey, entries.length, -1)
    }

    const frames = entries.map((e: string) => {
      try { return JSON.parse(e) } catch { return null }
    }).filter(Boolean)

    return reply.send({ success: true, frames })
  })
}
