/**
 * PAGIR 2 — Auth controller
 *
 * Controllers are thin orchestrators. They:
 *   - Call service methods
 *   - Return typed results
 *   - Never touch the database directly
 */

import { otpService } from '../services/otpService'
import { tokenService } from '../services/tokenService'

export const authController = {
  async sendOtp(phoneNumber: string, email: string, ip: string) {
    return otpService.sendOtp(phoneNumber, email, ip)
  },

  async verifyOtp(body: {
    phoneNumber: string
    otp: string
    pagirId: string
    deviceFingerprint: string
    name: string
    publicKey: string
  }, ip: string) {
    return otpService.verifyOtp(
      body.phoneNumber,
      body.otp,
      body.pagirId,
      body.deviceFingerprint,
      body.name,
      body.publicKey,
      ip
    )
  },

  async sendOtpByEmail(email: string, ip: string) {
    return otpService.sendOtpByEmail(email, ip)
  },

  async verifyOtpByEmail(email: string, otp: string) {
    return otpService.verifyOtpByEmail(email, otp)
  },

  async refreshToken(refreshToken: string) {
    return tokenService.refresh(refreshToken)
  },

  async logout(pagirId: string, jti: string) {
    return tokenService.revoke(pagirId, jti)
  },

  async emergencyWipe(oldPagirId: string, newPagirId: string, newPublicKey: string) {
    return otpService.emergencyWipe(oldPagirId, newPagirId, newPublicKey)
  },

  async deleteAccount(pagirId: string) {
    return otpService.deleteAccount(pagirId)
  },
}
