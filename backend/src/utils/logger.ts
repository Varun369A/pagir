/**
 * PAGIR 2 — Pino structured logger
 *
 * In production: JSON output (ingested by Railway / DataDog / etc.)
 * In development: pretty-print with colors
 *
 * NEVER log: phone numbers, plaintext messages, private keys, OTP codes.
 * Log: requestType, pagirId (for tracing), request IDs, error codes.
 */

import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
    : undefined,
  redact: {
    // Never leak these even in dev
    paths: ['*.phoneNumber', '*.phone', '*.otp', '*.otpCode', '*.privateKey', '*.password'],
    censor: '[REDACTED]',
  },
  base: {
    service: 'pagir2-backend',
    env: process.env.NODE_ENV,
  },
})
