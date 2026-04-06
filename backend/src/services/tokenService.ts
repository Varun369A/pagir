/**
 * PAGIR 2 — JWT Token Service
 *
 * Single place for all JWT operations:
 *   issue()    — create access + refresh pair
 *   refresh()  — rotate refresh token (one-time use)
 *   revoke()   — blacklist access JTI + delete refresh JTI from Redis
 */

import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { getRedis, RedisKey, TTL } from '../config/redis'
import { generateJti } from '../utils/hash'
import { AppError } from '../plugins/errorHandler'
import { ErrorCode, type JwtPayload } from '../types'

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export const tokenService = {
  /**
   * Issue a new access + refresh token pair for a PAGIR ID.
   * Stores the refresh token JTI in Redis (rotating — one-time use).
   */
  async issue(pagirId: string): Promise<TokenPair> {
    const privateKey = env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n')
    const accessJti   = generateJti()
    const refreshJti  = generateJti()

    const accessToken = jwt.sign(
      { sub: pagirId, jti: accessJti },
      privateKey,
      { algorithm: 'RS256', expiresIn: env.JWT_ACCESS_TTL as any }
    )
    const refreshToken = jwt.sign(
      { sub: pagirId, jti: refreshJti },
      privateKey,
      { algorithm: 'RS256', expiresIn: env.JWT_REFRESH_TTL as any }
    )

    const redis = getRedis()
    await redis.setex(RedisKey.refreshToken(pagirId), TTL.REFRESH_TOKEN, refreshJti)

    return { accessToken, refreshToken }
  },

  /**
   * Rotate refresh token — verify the incoming refresh token and issue a new pair.
   * The old refresh JTI is overwritten in Redis, making it one-time-use.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const publicKey = env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n')
    let payload: JwtPayload

    try {
      payload = jwt.verify(refreshToken, publicKey, { algorithms: ['RS256'] }) as JwtPayload
    } catch {
      throw AppError.unauthorized(ErrorCode.TOKEN_INVALID, 'Invalid or expired refresh token')
    }

    const redis = getRedis()
    const storedJti = await redis.get(RedisKey.refreshToken(payload.sub))
    if (!storedJti || storedJti !== payload.jti) {
      throw AppError.unauthorized(ErrorCode.TOKEN_INVALID, 'Refresh token has been revoked or replaced')
    }

    return this.issue(payload.sub)
  },

  /**
   * Revoke an access token JTI (logout / wipe).
   * Access token blacklisted until natural expiry; refresh token deleted from Redis.
   */
  async revoke(pagirId: string, accessJti: string): Promise<void> {
    const redis = getRedis()
    await Promise.all([
      redis.setex(RedisKey.accessRevoked(accessJti), TTL.ACCESS_REVOKED, '1'),
      redis.del(RedisKey.refreshToken(pagirId)),
    ])
  },
}
