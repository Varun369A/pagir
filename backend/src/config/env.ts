/**
 * PAGIR 2 — Environment configuration
 *
 * Validates all required env vars at startup using Zod.
 * Crashes immediately on invalid config — fail fast beats silent misconfiguration.
 */

import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT:     z.coerce.number().default(3000),

  // Database (Neon PostgreSQL)
  DATABASE_URL: z.string().min(10),

  // Redis — standard rediss:// URL (Upstash binary protocol, not REST API)
  REDIS_URL: z.string().min(10),
  REDIS_TLS: z.string().optional().transform(v => v === 'true'),

  // JWT — RS256 asymmetric (PKCS#8 or RSA format, jsonwebtoken supports both)
  JWT_PRIVATE_KEY: z.string().min(100, 'JWT_PRIVATE_KEY required'),
  JWT_PUBLIC_KEY:  z.string().min(100, 'JWT_PUBLIC_KEY required'),
  JWT_ACCESS_TTL:  z.string().default('24h'),
  JWT_REFRESH_TTL: z.string().default('90d'),

  // Crypto
  BCRYPT_ROUNDS:     z.coerce.number().min(10).max(14).default(12),
  PHONE_SALT_SECRET: z.string().min(32, 'PHONE_SALT_SECRET must be at least 32 chars'),

  // Admin secret (HMAC for admin-only routes)
  ADMIN_JWT_SECRET: z.string().min(32).optional(),

  // Email — Resend
  OTP_PROVIDER:   z.enum(['RESEND', 'LOG']).default('LOG'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM:    z.string().optional(),

  // App config
  CORS_ORIGIN:             z.string().default('*'),
  LOG_LEVEL:               z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  UNDELIVERED_PURGE_HOURS: z.coerce.number().default(72),
})

function loadEnv() {
  // Strip channel_binding from Neon DATABASE_URL (Prisma rejects this param)
  if (process.env.DATABASE_URL?.includes('channel_binding')) {
    try {
      const url = new URL(process.env.DATABASE_URL)
      url.searchParams.delete('channel_binding')
      process.env.DATABASE_URL = url.toString()
    } catch { /* leave as-is if URL parse fails */ }
  }

  const result = EnvSchema.safeParse(process.env)
  if (!result.success) {
    console.error('❌  PAGIR 2 cannot start — invalid environment:')
    console.error(JSON.stringify(result.error.format(), null, 2))
    process.exit(1)
  }
  return result.data
}

export const env = loadEnv()
export type Env = typeof env
