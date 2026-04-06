/**
 * PAGIR 2 — WebSocket Relay Route
 *
 * Blind relay for online mesh mode. Server forwards PAGIR frames between
 * authenticated users WITHOUT being able to read the content.
 *
 * WHAT THE SERVER SEES:
 *   - senderId (from JWT — authenticated)
 *   - receiverId (from frame header — plaintext routing field)
 *   - encryptedPayload (opaque bytes — server cannot decrypt)
 *   - frameId (for deduplication)
 *   - timestamp
 *
 * WHAT THE SERVER CANNOT SEE:
 *   - Message content
 *   - File content
 *   - Session keys
 *
 * SECURITY:
 *   - JWT authentication required to connect
 *   - Rate limiting: max 20 frames/sec per sender (matches mobile FloodGuard)
 *   - Max frame size: 2MB (prevents memory exhaustion)
 *   - Receiver must be a registered user (prevents spam to non-users)
 *   - Frame TTL not re-incremented (server cannot inject frames)
 */

import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { authenticate } from '../plugins/auth'
import { userRepo } from '../repositories/userRepo'
import { redis, RedisKey, TTL } from '../config/redis'
import { AppError } from '../plugins/errorHandler'
import logger from '../utils/logger'

const MAX_FRAME_SIZE    = 2 * 1024 * 1024  // 2MB
const MAX_FRAMES_PER_S  = 20
const RATE_WINDOW_S     = 1

/** Map<pagirId, WebSocket> — active connections */
const connections = new Map<string, WebSocket>()

export async function relayRoutes(app: FastifyInstance) {
  // WebSocket endpoint — requires JWT auth via query param or header
  app.get('/ws', {
    websocket: true,
    preHandler: authenticate,
  }, async (socket: WebSocket, request: any) => {
    const pagirId = request.user.pagirId
    if (!pagirId) { socket.close(4001, 'Unauthorized'); return }

    // Register connection
    connections.set(pagirId, socket)
    logger.info({ pagirId }, 'relay: client connected')

    socket.on('message', async (data: Buffer) => {
      try {
        await handleInboundFrame(pagirId, data)
      } catch (err: any) {
        socket.send(JSON.stringify({ error: err.message }))
      }
    })

    socket.on('close', () => {
      connections.delete(pagirId)
      logger.info({ pagirId }, 'relay: client disconnected')
    })

    socket.on('error', (err) => {
      logger.warn({ pagirId, err: err.message }, 'relay: socket error')
      connections.delete(pagirId)
    })

    // Send connection ack
    socket.send(JSON.stringify({ type: 'connected', pagirId }))
  })

  // REST fallback: POST /relay/frame (for clients that can't WebSocket)
  app.post('/relay/frame', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['receiverId', 'frameBase64'],
        properties: {
          receiverId:   { type: 'string', minLength: 15, maxLength: 20 },
          frameBase64:  { type: 'string', maxLength: Math.ceil(MAX_FRAME_SIZE * 4 / 3) + 4 },
        },
      },
    },
  }, async (request: any, reply: any) => {
    const { receiverId, frameBase64 } = request.body
    const senderId = request.user.pagirId

    const frameRaw = Buffer.from(frameBase64, 'base64')
    await handleInboundFrame(senderId, frameRaw, receiverId)
    return reply.send({ success: true })
  })
}

// ─── Frame relay logic ────────────────────────────────────────────────────────

async function handleInboundFrame(
  senderId: string,
  data:     Buffer | Uint8Array,
  overrideReceiverId?: string,
): Promise<void> {
  // 1. Size check
  if (data.length > MAX_FRAME_SIZE) {
    throw AppError.badRequest('Frame too large', 'FRAME_TOO_LARGE')
  }

  // 2. Rate limit (Redis sliding window)
  const rateKey = RedisKey.relayRateLimit(senderId)
  const now     = Date.now()
  await redis.zadd(rateKey, { score: now, member: `${now}-${Math.random()}` })
  await redis.zremrangebyscore(rateKey, 0, now - RATE_WINDOW_S * 1000)
  const count = await redis.zcard(rateKey)
  await redis.expire(rateKey, RATE_WINDOW_S + 5)

  if (count > MAX_FRAMES_PER_S) {
    throw AppError.tooManyRequests('Rate limit exceeded', 'RELAY_RATE_LIMIT')
  }

  // 3. Parse receiver from frame header (bytes 40-56 are receiver PAGIR ID)
  let receiverId = overrideReceiverId
  if (!receiverId) {
    if (data.length < 72) throw AppError.badRequest('Frame too short', 'INVALID_FRAME')
    // Bytes 40-55: receiver ID (16 ASCII bytes, dashes stripped)
    const receiverBytes = Buffer.from(data).slice(40, 56)
    const raw = receiverBytes.toString('ascii').replace(/\x00/g, '')
    receiverId = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7,11)}-${raw.slice(11,15)}`
  }

  // 4. Verify receiver exists (prevent sending to non-users)
  const receiver = await userRepo.findActiveById(receiverId)
  if (!receiver) {
    throw AppError.notFound('Receiver not found', 'RECEIVER_NOT_FOUND')
  }

  // 5. Deliver via WebSocket if receiver is online
  const receiverSocket = connections.get(receiverId)
  if (receiverSocket?.readyState === 1 /* OPEN */) {
    receiverSocket.send(data)
    logger.debug({ senderId, receiverId, bytes: data.length }, 'relay: delivered online')
    return
  }

  // 6. Queue for offline delivery (store in Redis, TTL 48h)
  const queueKey = RedisKey.offlineQueue(receiverId)
  const frameEntry = JSON.stringify({
    senderId,
    frame:   Buffer.from(data).toString('base64'),
    ts:      now,
  })
  await redis.lpush(queueKey, frameEntry)
  await redis.expire(queueKey, TTL.offlineQueue)
  await redis.ltrim(queueKey, 0, 999)  // max 1000 queued frames

  logger.debug({ senderId, receiverId }, 'relay: queued offline')
}
