/**
 * PAGIR 2 — Friends Routes
 *
 * Server-side friend graph is optional and minimal.
 * PAGIR contacts are primarily local (ContactStore SQLite).
 * Server friend records exist only for:
 *   - Push notification routing ("notify B that A wants to connect")
 *   - Public key verification ("confirm B's key hasn't changed")
 *   - Block list enforcement (global block — not just local)
 *
 * Routes:
 *   POST   /friends/request      — send friend request
 *   GET    /friends              — list accepted friends
 *   POST   /friends/:id/accept   — accept request
 *   POST   /friends/:id/reject   — reject request
 *   DELETE /friends/:id          — remove friend
 *   POST   /friends/:id/block    — global block
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../plugins/auth'
import { db } from '../config/database'
import { AppError } from '../plugins/errorHandler'
import { ErrorCode } from '../types'
import { userRepo } from '../repositories/userRepo'
import { logger } from '../utils/logger'

const SendRequestBody = z.object({
  receiverId: z.string().min(15).max(20),
  message:    z.string().max(200).optional(),
})

export async function friendsRoutes(app: FastifyInstance) {

  // ─── Send friend request ───────────────────────────────────────────────────
  app.post('/friends/request', { preHandler: authenticate }, async (request: any, reply) => {
    const body = SendRequestBody.parse(request.body)
    const senderId = request.user.pagirId

    if (senderId === body.receiverId) {
      throw AppError.badRequest(ErrorCode.SELF_FRIEND_REQUEST, 'Cannot add yourself')
    }

    const receiver = await userRepo.findActiveById(body.receiverId)
    if (!receiver) throw AppError.notFound(ErrorCode.USER_NOT_FOUND, 'User not found')

    // Check for existing request/friendship
    const existing = await db.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId: body.receiverId },
          { senderId: body.receiverId, receiverId: senderId },
        ],
      },
    })

    if (existing?.status === 'ACCEPTED') {
      throw AppError.badRequest(ErrorCode.ALREADY_FRIENDS, 'Already friends')
    }

    if (existing?.status === 'PENDING') {
      throw AppError.badRequest(ErrorCode.REQUEST_PENDING, 'Request already sent')
    }

    if (existing?.status === 'BLOCKED') {
      throw AppError.forbidden(ErrorCode.BLOCKED_USER, 'You are blocked by this user')
    }

    const req = await db.friendRequest.create({
      data: { senderId, receiverId: body.receiverId, status: 'PENDING' },
    })

    logger.info({ senderId, receiverId: body.receiverId }, 'friend request sent')
    return reply.status(201).send({ success: true, requestId: req.id })
  })

  // ─── List friends ─────────────────────────────────────────────────────────
  app.get('/friends', { preHandler: authenticate }, async (request: any, reply) => {
    const pagirId = request.user.pagirId

    const friendships = await db.friendship.findMany({
      where: { OR: [{ userAId: pagirId }, { userBId: pagirId }] },
    })

    const friendIds = friendships.map(f =>
      f.userAId === pagirId ? f.userBId : f.userAId
    )

    const profiles = await Promise.all(friendIds.map(id => userRepo.getPublicProfile(id)))
    const friends = profiles.filter(Boolean).map(p => ({ pagirId: p!.id, displayName: p!.displayName, publicKey: p!.publicKey }))
    return reply.send({ success: true, friends })
  })

  // ─── List pending requests ────────────────────────────────────────────────
  app.get('/friends/requests', { preHandler: authenticate }, async (request: any, reply) => {
    const pagirId = request.user.pagirId

    const pending = await db.friendRequest.findMany({
      where: { receiverId: pagirId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })

    const withProfiles = await Promise.all(pending.map(async r => {
      const p = await userRepo.getPublicProfile(r.senderId)
      return {
        requestId: r.id,
        sender: p ? { pagirId: p.id, displayName: p.displayName, publicKey: p.publicKey } : null,
        createdAt: r.createdAt,
      }
    }))

    return reply.send({ success: true, requests: withProfiles })
  })

  // ─── Accept request ───────────────────────────────────────────────────────
  app.post('/friends/:id/accept', { preHandler: authenticate }, async (request: any, reply) => {
    const { id } = request.params as { id: string }
    const pagirId = request.user.pagirId

    const req = await db.friendRequest.findFirst({
      where: { id, receiverId: pagirId, status: 'PENDING' },
    })
    if (!req) throw AppError.notFound(ErrorCode.REQUEST_NOT_FOUND, 'Request not found')

    await db.$transaction([
      db.friendRequest.update({ where: { id }, data: { status: 'ACCEPTED' } }),
      db.friendship.create({
        data: {
          userAId: req.senderId < pagirId ? req.senderId : pagirId,
          userBId: req.senderId < pagirId ? pagirId : req.senderId,
        },
      }),
    ])

    logger.info({ pagirId, friendId: req.senderId }, 'friend request accepted')
    return reply.send({ success: true })
  })

  // ─── Reject request ───────────────────────────────────────────────────────
  app.post('/friends/:id/reject', { preHandler: authenticate }, async (request: any, reply) => {
    const { id } = request.params as { id: string }
    const pagirId = request.user.pagirId

    await db.friendRequest.updateMany({
      where: { id, receiverId: pagirId, status: 'PENDING' },
      data:  { status: 'REJECTED' },
    })

    return reply.send({ success: true })
  })

  // ─── Remove friend ────────────────────────────────────────────────────────
  app.delete('/friends/:friendId', { preHandler: authenticate }, async (request: any, reply) => {
    const { friendId } = request.params as { friendId: string }
    const pagirId = request.user.pagirId

    await db.friendship.deleteMany({
      where: { OR: [
        { userAId: pagirId, userBId: friendId },
        { userAId: friendId, userBId: pagirId },
      ]},
    })
    await db.friendRequest.deleteMany({
      where: { OR: [
        { senderId: pagirId, receiverId: friendId },
        { senderId: friendId, receiverId: pagirId },
      ]},
    })

    return reply.send({ success: true })
  })

  // ─── Block user ───────────────────────────────────────────────────────────
  app.post('/friends/:friendId/block', { preHandler: authenticate }, async (request: any, reply) => {
    const { friendId } = request.params as { friendId: string }
    const pagirId = request.user.pagirId

    // Remove friendship and any existing requests between these two users
    await db.$transaction([
      db.friendship.deleteMany({
        where: { OR: [
          { userAId: pagirId, userBId: friendId },
          { userAId: friendId, userBId: pagirId },
        ]},
      }),
      db.friendRequest.deleteMany({
        where: { OR: [
          { senderId: pagirId, receiverId: friendId },
          { senderId: friendId, receiverId: pagirId },
        ]},
      }),
    ])
    // Create the block record separately (needs a valid UUID id)
    await db.friendRequest.create({
      data: { senderId: pagirId, receiverId: friendId, status: 'BLOCKED' },
    })

    return reply.send({ success: true })
  })
}
