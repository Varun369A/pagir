/**
 * PAGIR 2 — Global Fastify error handler
 *
 * All errors flow through here. Returns a consistent API error shape:
 * { success: false, error: { code, message, requestId } }
 *
 * Never leak stack traces or internal details in production.
 */

import type { FastifyInstance, FastifyError } from 'fastify'
import { ZodError } from 'zod'
import { ErrorCode } from '../types'
import { logger } from '../utils/logger'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode | string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }

  static badRequest(code: ErrorCode, message: string) {
    return new AppError(code, message, 400)
  }

  static unauthorized(code: ErrorCode, message: string) {
    return new AppError(code, message, 401)
  }

  static forbidden(code: ErrorCode, message: string) {
    return new AppError(code, message, 403)
  }

  static notFound(code: ErrorCode, message: string) {
    return new AppError(code, message, 404)
  }

  static tooManyRequests(code: ErrorCode, message: string) {
    return new AppError(code, message, 429)
  }

  static internal(message = 'An unexpected error occurred') {
    return new AppError(ErrorCode.INTERNAL_ERROR, message, 500)
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError | ZodError | Error, request, reply) => {
    const requestId = request.id as string

    // Zod validation errors
    if (error instanceof ZodError) {
      logger.warn({ requestId, zodErrors: error.issues }, 'Validation error')
      return reply.status(400).send({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
          requestId,
          details: error.issues,
        },
      })
    }

    // Known AppErrors
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        logger.error({ requestId, code: error.code, err: error }, 'Application error')
      } else {
        logger.warn({ requestId, code: error.code, message: error.message }, 'Request error')
      }
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      })
    }

    // Fastify validation errors (e.g., schema mismatch)
    if ((error as FastifyError).validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: error.message,
          requestId,
        },
      })
    }

    // Unknown errors — temporarily surfacing message for diagnosis
    logger.error({ requestId, err: error }, 'Unhandled error')
    return reply.status(500).send({
      success: false,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: error.message,
        requestId,
      },
    })
  })
}
