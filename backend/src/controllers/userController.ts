/**
 * PAGIR 2 — User controller
 */

import { userRepo } from '../repositories/userRepo'
import { AppError } from '../plugins/errorHandler'
import { ErrorCode } from '../types'

export const userController = {
  async getMyProfile(pagirId: string) {
    const user = await userRepo.findActiveById(pagirId)
    if (!user) throw AppError.notFound(ErrorCode.USER_NOT_FOUND, 'Account not found')
    return {
      pagirId:    user.id,
      displayName: user.displayName,
      publicKey:  user.publicKey,
      keyVersion: user.keyVersion,
      isActive:   user.isActive,
    }
  },

  async getPublicProfile(pagirId: string) {
    const user = await userRepo.getPublicProfile(pagirId)
    if (!user) throw AppError.notFound(ErrorCode.USER_NOT_FOUND, 'PAGIR ID not found or revoked')
    return {
      pagirId:     user.id,
      displayName: user.displayName,
      publicKey:   user.publicKey,
    }
  },

  async updatePublicKey(pagirId: string, publicKey: string) {
    const user = await userRepo.findActiveById(pagirId)
    if (!user) throw AppError.notFound(ErrorCode.USER_NOT_FOUND, 'Account not found')
    await userRepo.updatePublicKey(pagirId, publicKey)
  },
}
