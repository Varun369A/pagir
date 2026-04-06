/**
 * PAGIR 2 — Redis client (ioredis)
 *
 * Uses ioredis which supports the standard rediss:// URL format directly.
 * This works with Upstash (binary protocol), Redis Labs, and self-hosted Redis.
 *
 * All Redis keys namespaced through RedisKey helpers — no raw string keys anywhere.
 */

import IORedis from 'ioredis'
import { env } from './env'

let _client: IORedis | null = null

export function getRedisClient(): IORedis {
  if (_client) return _client

  _client = new IORedis(env.REDIS_URL, {
    tls: env.REDIS_TLS ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    enableReadyCheck: false,  // Upstash doesn't support CLUSTER INFO
    lazyConnect: false,
  })

  _client.on('error', (err) => {
    // Log but don't crash — Redis errors are non-fatal for most operations
    console.error('[Redis] Connection error:', err.message)
  })

  return _client
}

// Convenience wrapper with typed methods
export const redis = {
  // Sorted sets (for rate limiting)
  zadd:            (key: string, args: { score: number; member: string }) =>
                     getRedisClient().zadd(key, args.score, args.member),
  zremrangebyscore:(key: string, min: number | string, max: number | string) =>
                     getRedisClient().zremrangebyscore(key, min, max),
  zcard:           (key: string) => getRedisClient().zcard(key),

  // Strings
  set:    (key: string, value: string, opts?: { ex?: number }) =>
            opts?.ex
              ? getRedisClient().set(key, value, 'EX', opts.ex)
              : getRedisClient().set(key, value),
  setex:  (key: string, ttl: number, value: string) =>
            getRedisClient().setex(key, ttl, value),
  get:    (key: string) => getRedisClient().get(key),
  del:    (...keys: string[]) => getRedisClient().del(...keys),
  exists: (key: string) => getRedisClient().exists(key),
  expire: (key: string, ttl: number) => getRedisClient().expire(key, ttl),

  // Lists (for offline queue)
  lpush:  (key: string, ...values: string[]) => getRedisClient().lpush(key, ...values),
  rpush:  (key: string, ...values: string[]) => getRedisClient().rpush(key, ...values),
  lrange: (key: string, start: number, stop: number) =>
            getRedisClient().lrange(key, start, stop),
  ltrim:  (key: string, start: number, stop: number) =>
            getRedisClient().ltrim(key, start, stop),
  llen:   (key: string) => getRedisClient().llen(key),

  // Keys
  keys:   (pattern: string) => getRedisClient().keys(pattern),
  scan:   (cursor: number, pattern: string, count: number) =>
            getRedisClient().scan(cursor, 'MATCH', pattern, 'COUNT', count),
}

// ─── Key namespace helpers ────────────────────────────────────────────────────

export const RedisKey = {
  // OTP
  otpSession:       (phoneHash: string)  => `otp:session:${phoneHash}`,
  otpLookup:        (stableHash: string) => `otp:lookup:${stableHash}`,
  otpByEmail:       (emailHash: string)  => `otp:email:${emailHash}`,
  otpRatePhone:     (hash: string)       => `otp:rate:phone:${hash}`,
  otpRateIp:        (ip: string)         => `otp:rate:ip:${ip}`,

  // Tokens
  refreshToken:     (pagirId: string)    => `token:refresh:${pagirId}`,
  accessRevoked:    (jti: string)        => `token:revoked:${jti}`,

  // Identity
  pagirIdRevoked:   (pagirId: string)    => `revoked:${pagirId}`,
  userOnline:       (pagirId: string)    => `presence:${pagirId}`,

  // Relay
  offlineQueue:     (pagirId: string)    => `relay:queue:${pagirId}`,
  relayRateLimit:   (pagirId: string)    => `relay:rate:${pagirId}`,

  // Push tokens
  pushToken:        (pagirId: string)    => `push:token:${pagirId}`,
}

// TTL constants (seconds)
export const TTL = {
  OTP_SESSION:      660,
  RATE_PHONE:       3_600,
  RATE_IP:          600,
  REFRESH_TOKEN:    7_776_000,
  ACCESS_REVOKED:   86_400,
  PAGIR_ID_REVOKED: 31_536_000,
  PRESENCE:         35,
  offlineQueue:     172_800,  // 48 hours
}

// For backwards-compat with code that uses getRedis()
export const getRedis = getRedisClient
