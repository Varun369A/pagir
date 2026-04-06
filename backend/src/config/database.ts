/**
 * PAGIR 2 — Prisma client singleton
 *
 * One instance per process — Prisma manages a connection pool internally.
 * The singleton pattern prevents multiple pools during hot-reload in dev.
 */

import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'error' }]
      : [{ emit: 'event', level: 'error' }],
  })

  if (process.env.NODE_ENV === 'development') {
    client.$on('query' as never, (e: { query: string; duration: number }) => {
      logger.debug({ query: e.query, duration: e.duration }, 'Prisma query')
    })
  }

  client.$on('error' as never, (e: { message: string }) => {
    logger.error({ prismaError: e.message }, 'Prisma error')
  })

  return client
}

// Reuse across hot-reloads in dev
if (process.env.NODE_ENV === 'development') {
  global.__prisma ??= createPrismaClient()
}

export const db: PrismaClient = global.__prisma ?? createPrismaClient()

export async function connectDatabase(): Promise<void> {
  await db.$connect()
  logger.info('Database connected')
}

export async function disconnectDatabase(): Promise<void> {
  await db.$disconnect()
  logger.info('Database disconnected')
}
