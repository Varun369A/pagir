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
  INVALID_PUBLIC_KEY  = 'INVALID_PUBLIC_KEY',

  // Server
  INTERNAL_ERROR      = 'INTERNAL_ERROR',
  NOT_FOUND           = 'NOT_FOUND',

  // Transfer
  TRANSFER_NOT_FOUND  = 'TRANSFER_NOT_FOUND',
  TRANSFER_EXPIRED    = 'TRANSFER_EXPIRED',

  // Tenant / multi-user isolation
  MISSING_TENANT      = 'MISSING_TENANT',
  TENANT_VIOLATION    = 'TENANT_VIOLATION',

  // Friends / social
  ALREADY_FRIENDS     = 'ALREADY_FRIENDS',
  REQUEST_PENDING     = 'REQUEST_PENDING',
  REQUEST_NOT_FOUND   = 'REQUEST_NOT_FOUND',
  BLOCKED_USER        = 'BLOCKED_USER',
  SELF_FRIEND_REQUEST = 'SELF_FRIEND_REQUEST',

  // Relay / frame
  FRAME_TOO_LARGE     = 'FRAME_TOO_LARGE',
  INVALID_FRAME       = 'INVALID_FRAME',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  RECEIVER_NOT_FOUND  = 'RECEIVER_NOT_FOUND',
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
  sub:     string   // PAGIR ID (JWT subject)
  jti:     string   // token ID
  pagirId: string   // alias for sub — used in route handlers
}

// Fastify request augmentation
declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser
  }
}
