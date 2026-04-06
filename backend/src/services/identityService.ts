/**
 * PAGIR 2 — Identity Service
 *
 * Handles PAGIR ID lifecycle on the server side:
 *   - Validate ID format
 *   - Check ID availability
 *   - Emergency wipe (revoke + new ID + update public key)
 *
 * The heavy lifting for OTP, auth, and tokens is in otpService / tokenService.
 * This service owns only the identity mutation operations.
 */

import { userRepo } from '../repositories/userRepo'
import { AppError } from '../plugins/errorHandler'
import { isValidPagirId } from '../utils/pagirId'
import logger from '../utils/logger'

export const identityService = {

  /**
   * Check whether a PAGIR ID is currently active and registered.
   */
  async checkId(pagirId: string): Promise<{ active: boolean; displayName: string | null }> {
    if (!isValidPagirId(pagirId)) {
      throw AppError.badRequest('Invalid PAGIR ID format', 'INVALID_PAGIR_ID')
    }
    const user = await userRepo.findById(pagirId)
    if (!user) return { active: false, displayName: null }
    if (user.revokedAt) return { active: false, displayName: null }
    return { active: true, displayName: user.displayName }
  },

  /**
   * Update the public key on record for a user.
   * Called after key rotation (e.g. new device install).
   */
  async updatePublicKey(pagirId: string, publicKey: string): Promise<void> {
    if (!publicKey.includes('BEGIN PUBLIC KEY')) {
      throw AppError.badRequest('Invalid RSA public key format', 'INVALID_PUBLIC_KEY')
    }
    await userRepo.updatePublicKey(pagirId, publicKey)
    logger.info({ pagirId }, 'public key updated')
  },

}
