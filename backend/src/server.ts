/**
 * PAGIR 2 — Fastify 5 application server
 *
 * Lifecycle:
 *   1. Validate environment (env.ts crashes on bad config)
 *   2. Connect database
 *   3. Register global plugins (CORS, helmet, error handler)
 *   4. Register route groups
 *   5. Listen
 *   6. Graceful shutdown on SIGTERM/SIGINT
 */

import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import { env } from './config/env'
import { connectDatabase, disconnectDatabase } from './config/database'
import { registerErrorHandler } from './plugins/errorHandler'
import { registerAuthRoutes } from './routes/auth'
import { registerUserRoutes } from './routes/users'
import { relayRoutes } from './routes/relay'
import { friendsRoutes } from './routes/friends'
import { logger } from './utils/logger'
import { generateRequestId } from './utils/hash'

async function build() {
  const app = Fastify({
    logger: false,   // We use our own Pino logger
    genReqId: generateRequestId,
    trustProxy: true,  // Railway/Nginx sits in front
  })

  // ─── Global plugins ───────────────────────────────────────────────────────

  await app.register(cors, {
    origin: env.NODE_ENV === 'production'
      ? ['https://pagir.app', /^https:\/\/.*\.pagir\.app$/]
      : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Platform', 'X-App-Version'],
  })

  await app.register(helmet, {
    contentSecurityPolicy: false,  // API — no HTML
  })

  registerErrorHandler(app)

  // ─── Request logging ──────────────────────────────────────────────────────

  app.addHook('onRequest', (request, _reply, done) => {
    logger.info({
      requestId: request.id,
      method: request.method,
      url: request.url,
      ip: request.ip,
    }, 'Incoming request')
    done()
  })

  app.addHook('onResponse', (request, reply, done) => {
    logger.info({
      requestId: request.id,
      statusCode: reply.statusCode,
    }, 'Request completed')
    done()
  })

  // ─── Health check ─────────────────────────────────────────────────────────

  app.get('/health', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok', service: 'pagir2-backend', ts: Date.now() })
  })

  // ─── API routes ───────────────────────────────────────────────────────────

  // WebSocket relay (no /api/v2 prefix — WebSocket needs root path)
  await app.register(require('@fastify/websocket'))
  app.register(relayRoutes)

  app.register(async (api) => {
    registerAuthRoutes(api)
    registerUserRoutes(api)
    api.register(friendsRoutes)
  }, { prefix: '/api/v2' })

  // ─── 404 handler ─────────────────────────────────────────────────────────

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found`, requestId: request.id },
    })
  })

  return app
}

async function start() {
  let app: Awaited<ReturnType<typeof build>> | null = null

  try {
    await connectDatabase()
    app = await build()

    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `PAGIR 2 backend started`)
  } catch (err) {
    logger.error({ err }, 'Failed to start server')
    process.exit(1)
  }

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutting down gracefully…')
    if (app) await app.close()
    await disconnectDatabase()
    logger.info('Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

start()
