/**
 * PAGIR 2 — User repository
 *
 * All database access for the User model goes through here.
 * Controllers/services never call `db.user.*` directly — always through this repo.
 * This makes it trivial to add caching, tracing, or swap databases later.
 */

import crypto from 'crypto'
import type { User } from '@prisma/client'
import { db } from '../config/database'

export type PublicUserProfile = Pick<User, 'id' | 'displayName' | 'publicKey'>

export const userRepo = {
  // ── Reads ──────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<User | null> {
    return db.user.findUnique({ where: { id } })
  },

  async findActiveById(id: string): Promise<User | null> {
    return db.user.findFirst({ where: { id, revokedAt: null } })
  },

  async findByStableHash(stableHash: string): Promise<User | null> {
    return db.user.findFirst({ where: { stablePhoneHash: stableHash, revokedAt: null } })
  },

  async findByEmail(email: string): Promise<User | null> {
    return db.user.findFirst({
      where: { email: { equals: email.toLowerCase(), mode: 'insensitive' }, revokedAt: null },
    })
  },

  async getPublicProfile(id: string): Promise<PublicUserProfile | null> {
    const user = await db.user.findFirst({
      where: { id, revokedAt: null },
      select: { id: true, displayName: true, publicKey: true },
    })
    return user
  },

  // Backfill: find users with null stablePhoneHash (pre-migration)
  async findLegacyUsers(): Promise<Pick<User, 'id' | 'phoneHash' | 'phoneSalt'>[]> {
    return db.user.findMany({
      where: { stablePhoneHash: null, revokedAt: null },
      select: { id: true, phoneHash: true, phoneSalt: true },
    })
  },

  // ── Writes ─────────────────────────────────────────────────────────────────

  async create(data: {
    id: string
    phoneHash: string
    phoneSalt: string
    stablePhoneHash: string | null
    email: string | null
    displayName: string
    publicKey: string
    deviceFingerprint: string
  }): Promise<User> {
    return db.user.create({ data })
  },

  async updateOnLogin(id: string, data: {
    displayName: string
    publicKey: string
    phoneHash: string
    phoneSalt: string
    deviceFingerprint?: string
    stablePhoneHash?: string
  }): Promise<User> {
    return db.user.update({ where: { id }, data })
  },

  async backfillStableHash(id: string, stablePhoneHash: string): Promise<User> {
    return db.user.update({ where: { id }, data: { stablePhoneHash } })
  },

  async updatePublicKey(id: string, publicKey: string): Promise<void> {
    await db.user.update({
      where: { id },
      data: { publicKey, keyVersion: { increment: 1 } },
    })
  },

  async revoke(id: string): Promise<void> {
    const user = await db.user.findUnique({ where: { id }, select: { phoneHash: true } })
    if (!user) return
    // SHA256 of original hash + revoke marker = always 64 hex chars (fits VarChar(64))
    const revokedHash = crypto.createHash('sha256').update(user.phoneHash + ':revoked:' + id).digest('hex')
    await db.user.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        phoneHash: revokedHash,
        stablePhoneHash: null,
      },
    })
  },

  // Hard-revoke with phone hash suffix for uniqueness
  async revokeWithSuffix(id: string, suffix: string): Promise<void> {
    const user = await db.user.findUnique({ where: { id }, select: { phoneHash: true } })
    if (!user) return
    // SHA256 of original hash + revoke marker = always 64 hex chars (fits VarChar(64))
    const revokedHash = crypto.createHash('sha256').update(user.phoneHash + ':revoked:' + suffix).digest('hex')
    await db.user.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        phoneHash: revokedHash,
        stablePhoneHash: null,
      },
    })
  },

  async hardDelete(id: string): Promise<void> {
    // Delete related records first (FK constraints), then user
    await db.deviceToken.deleteMany({ where: { userId: id } })
    try {
      await db.friendRequest.deleteMany({ where: { OR: [{ senderId: id }, { receiverId: id }] } })
    } catch (err: any) {
      throw new Error('hardDelete.friendRequest.deleteMany: ' + String(err?.message ?? err) + ' meta:' + JSON.stringify(err?.meta))
    }
    try {
      await db.friendship.deleteMany({ where: { OR: [{ userAId: id }, { userBId: id }] } })
    } catch (err: any) {
      throw new Error('hardDelete.friendship.deleteMany: ' + String(err?.message ?? err) + ' meta:' + JSON.stringify(err?.meta))
    }
    try {
      await db.transferSession.deleteMany({ where: { OR: [{ senderId: id }, { receiverId: id }] } })
    } catch (err: any) {
      throw new Error('hardDelete.transferSession.deleteMany: ' + String(err?.message ?? err) + ' meta:' + JSON.stringify(err?.meta))
    }
    try {
      await db.user.delete({ where: { id } })
    } catch (err: any) {
      throw new Error('hardDelete.user.delete: ' + String(err?.message ?? err) + ' meta:' + JSON.stringify(err?.meta))
    }
  },
}
