/**
 * PAGIR 2 — Shared backend types and error codes
 */

// ─── Error codes ──────────────────────────────────────────────────────────────

export enum ErrorCode {
  // Auth
  OTP_INVALID         = 'OTP_INVALID',
  OTP_EXPIRED         = 'OTP_EXPIRED',
  OTP_RATE_LIMITED    = 'OTP_RATE_LIMITED',
  OTP_MAX_ATTEMPTS    = 'OTP_MAX_ATTEMPTS',
  TOKEN_INVALID       = 'TOKEN_INVALID',
  TOKEN_EXPIRED       = 'TOKEN_EXPIRED',
  UNAUTHORIZED        = 'UNAUTHORIZED',
  FORBIDDEN           = 'FORBIDDEN',

  // User
  USER_NOT_FOUND      = 'USER_NOT_FOUND',
  USER_REVOKED        = 'USER_REVOKED',
  USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS',

  // Validation
  VALIDATION_ERROR    = 'VALIDATION_ERROR',
  INVALID_PAGIR_ID    = 'INVALID_PAGIR_ID',

  // Server
  INTERNAL_ERROR      = 'INTERNAL_ERROR',
  NOT_FOUND           = 'NOT_FOUND',

  // Transfer
  TRANSFER_NOT_FOUND  = 'TRANSFER_NOT_FOUND',
  TRANSFER_EXPIRED    = 'TRANSFER_EXPIRED',
}

// ─── API response shape ───────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  success: true
  data: T
  requestId?: string
}

export interface ApiError {
  success: false
  error: {
    code: ErrorCode | string
    message: string
    requestId: string
    details?: unknown
  }
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string   // PAGIR ID
  jti: string   // Unique token ID (for revocation)
  iat?: number
  exp?: number
}

export interface AuthenticatedUser {
  sub: string
  jti: string
}

// Fastify request augmentation
declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser
  }
}
