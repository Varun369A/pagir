/**
 * PAGIR 2 — JWT RS256 authentication plugin
 *
 * Decorates request.user with { sub: pagirId, jti } after verifying:
 *   1. Bearer token is present
 *   2. Signature is valid (RS256)
 *   3. Not expired
 *   4. JTI not in revocation Redis set (logout / wipe)
 *
 * Usage:
 *   app.get('/protected', { preHandler: [authenticate] }, handler)
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { getRedis, RedisKey } from '../config/redis'
import { AppError } from './errorHandler'
import { ErrorCode, type JwtPayload } from '../types'

export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    throw AppError.unauthorized(ErrorCode.UNAUTHORIZED, 'Authorization header required')
  }

  const token = authHeader.slice(7)
  let payload: JwtPayload

  try {
    payload = jwt.verify(
      token,
      env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'),
      { algorithms: ['RS256'] }
    ) as JwtPayload
  } catch (err) {
    if ((err as Error).name === 'TokenExpiredError') {
      throw AppError.unauthorized(ErrorCode.TOKEN_EXPIRED, 'Access token expired')
    }
    throw AppError.unauthorized(ErrorCode.TOKEN_INVALID, 'Invalid access token')
  }

  // Check JTI revocation (logout or emergency wipe)
  const redis = getRedis()
  const revoked = await redis.exists(RedisKey.accessRevoked(payload.jti))
  if (revoked) {
    throw AppError.unauthorized(ErrorCode.TOKEN_INVALID, 'Token has been revoked')
  }

  request.user = { sub: payload.sub, jti: payload.jti }
}

/**
 * Admin route authenticator — HMAC-SHA256 shared secret.
 * Used for court-order account revocation (not user-facing).
 */
export async function authenticateAdmin(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  if (!env.ADMIN_SECRET) {
    throw AppError.forbidden(ErrorCode.FORBIDDEN, 'Admin routes are disabled')
  }
  const secret = request.headers['x-admin-secret']
  if (secret !== env.ADMIN_SECRET) {
    throw AppError.unauthorized(ErrorCode.UNAUTHORIZED, 'Invalid admin secret')
  }
}
