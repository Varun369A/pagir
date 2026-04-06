/**
 * PAGIR 2 — OTP session repository
 */

import type { OtpSession } from '@prisma/client'
import { db } from '../config/database'

export const otpRepo = {
  async create(data: {
    phoneHash: string
    otpHash: string
    expiresAt: Date
    ipAddress: string
  }): Promise<Pick<OtpSession, 'id'>> {
    return db.otpSession.create({
      data: { ...data, attempts: 0, maxAttempts: 3 },
      select: { id: true },
    })
  },

  async findById(id: string): Promise<OtpSession | null> {
    return db.otpSession.findUnique({ where: { id } })
  },

  async incrementAttempts(id: string): Promise<void> {
    await db.otpSession.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    })
  },

  async delete(id: string): Promise<void> {
    await db.otpSession.delete({ where: { id } }).catch(() => {})
  },

  async deleteExpired(): Promise<number> {
    const result = await db.otpSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    return result.count
  },
}
