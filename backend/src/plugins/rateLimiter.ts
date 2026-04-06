/**
 * PAGIR 2 — Rate Limiter Plugin
 *
 * Sliding-window rate limiting via Redis.
 * Used as a Fastify preHandler on sensitive routes.
 *
 * Usage:
 *   fastify.post('/auth/otp/send', {
 *     preHandler: rateLimit({ max: 5, window: 60, key: 'otp_send' }),
 *   }, handler)
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { redis } from '../config/redis'
import { AppError } from './errorHandler'

interface RateLimitOptions {
  max:    number   // max requests in window
  window: number   // window in seconds
  key:    string   // human-readable label (used in Redis key)
}

export function rateLimit(opts: RateLimitOptions) {
  return async function rateLimitPreHandler(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    // Key = label + IP (or header forwarded IP)
    const ip  = (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
              ?? request.socket.remoteAddress
              ?? 'unknown'
    const key = `rl:${opts.key}:${ip}`

    const now    = Date.now()
    const window = opts.window * 1000

    // ZADD + ZREMRANGEBYSCORE + ZCARD in a pipeline
    await redis.zadd(key, { score: now, member: `${now}-${Math.random()}` })
    await redis.zremrangebyscore(key, 0, now - window)
    const count = await redis.zcard(key)
    await redis.expire(key, opts.window + 10)

    if (count > opts.max) {
      throw AppError.tooManyRequests(
        `Too many requests. Allowed ${opts.max} per ${opts.window}s.`,
        'RATE_LIMIT_EXCEEDED'
      )
    }
  }
}
