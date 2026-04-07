/**
 * PAGIR 2 — API Client
 *
 * Typed HTTP client with:
 *   - Automatic JWT refresh on 401
 *   - Exponential backoff retry
 *   - Request ID tracking
 *   - Token persistence in AsyncStorage (not Keychain — access tokens are short-lived)
 *
 * Base URL versioning: all routes are /api/v2/*
 */

import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

const BASE_URL = __DEV__
  ? 'http://10.0.2.2:3000/api/v2'                              // Android emulator → local
  : 'https://pagir2backend-production.up.railway.app/api/v2'   // Railway production

const AS_ACCESS_TOKEN  = 'pagir2:access_token'
const AS_REFRESH_TOKEN = 'pagir2:refresh_token'

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  skipAuth?: boolean
  retries?: number
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string; requestId: string }
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

class ApiClient {
  private accessToken:  string | null = null
  private refreshToken: string | null = null
  private refreshPromise: Promise<void> | null = null

  // ── Token management ───────────────────────────────────────────────────────

  async loadTokens(): Promise<void> {
    try {
      const [access, refresh] = await AsyncStorage.multiGet([AS_ACCESS_TOKEN, AS_REFRESH_TOKEN])
      this.accessToken  = access[1]  ?? null
      this.refreshToken = refresh[1] ?? null
    } catch {}
  }

  async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    this.accessToken  = accessToken
    this.refreshToken = refreshToken
    await AsyncStorage.multiSet([
      [AS_ACCESS_TOKEN,  accessToken],
      [AS_REFRESH_TOKEN, refreshToken],
    ]).catch(() => {})
  }

  async clearTokens(): Promise<void> {
    this.accessToken  = null
    this.refreshToken = null
    await AsyncStorage.multiRemove([AS_ACCESS_TOKEN, AS_REFRESH_TOKEN]).catch(() => {})
  }

  isAuthenticated(): boolean {
    return !!this.accessToken
  }

  getAccessToken(): string | null {
    return this.accessToken
  }

  // ── Core request ───────────────────────────────────────────────────────────

  private async request<T>(options: RequestOptions): Promise<T> {
    const { method, path, body, skipAuth = false, retries = 3 } = options

    const headers: Record<string, string> = {
      'Content-Type':    'application/json',
      'X-Request-ID':    _generateId(),
      'X-Platform':      Platform.OS,
      'X-App-Version':   '2.0.0',
    }

    if (!skipAuth && this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(`${BASE_URL}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        })

        // 401 → refresh once then retry
        if (res.status === 401 && !skipAuth && attempt === 0) {
          await this._refreshAccessToken()
          headers['Authorization'] = `Bearer ${this.accessToken}`
          continue
        }

        const json = await res.json() as ApiEnvelope<T>

        if (!json.success) {
          throw new ApiError(
            json.error?.code ?? 'UNKNOWN_ERROR',
            json.error?.message ?? 'Request failed',
            res.status
          )
        }

        return json.data as T
      } catch (err) {
        if (err instanceof ApiError) throw err
        lastError = err as Error
        if (attempt < retries - 1) {
          await _sleep(Math.min(500 * Math.pow(2, attempt), 4000))
        }
      }
    }

    throw lastError ?? new Error('Request failed after retries')
  }

  private async _refreshAccessToken(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = (async () => {
      try {
        if (!this.refreshToken) throw new Error('No refresh token')
        const result = await this.request<{ accessToken: string; refreshToken: string }>({
          method: 'POST',
          path:   '/auth/token/refresh',
          body:   { refreshToken: this.refreshToken },
          skipAuth: true,
          retries: 1,
        })
        await this.saveTokens(result.accessToken, result.refreshToken)
      } finally {
        this.refreshPromise = null
      }
    })()

    return this.refreshPromise
  }

  // ── Auth endpoints ─────────────────────────────────────────────────────────

  async requestOtp(
    phoneNumber: string,
    email: string,
    platform: 'android' | 'ios'
  ): Promise<{ message: string; alreadyRegistered: boolean }> {
    return this.request({ method: 'POST', path: '/auth/otp/send', body: { phoneNumber, email, platform }, skipAuth: true })
  }

  async verifyOtp(params: {
    phoneNumber: string
    otp: string
    pagirId: string
    deviceFingerprint: string
    publicKey: string
    name?: string
    platform?: 'android' | 'ios'
  }): Promise<{ accessToken: string; refreshToken: string; pagirId: string; isNewUser: boolean }> {
    const result = await this.request<{
      accessToken: string; refreshToken: string; pagirId: string; isNewUser: boolean
    }>({ method: 'POST', path: '/auth/otp/verify', body: params, skipAuth: true })
    await this.saveTokens(result.accessToken, result.refreshToken)
    return result
  }

  async requestOtpByEmail(email: string): Promise<{ message: string }> {
    return this.request({ method: 'POST', path: '/auth/otp/send-by-email', body: { email }, skipAuth: true })
  }

  async verifyOtpByEmail(email: string, otp: string): Promise<{
    accessToken: string; refreshToken: string; pagirId: string
  }> {
    const result = await this.request<{
      accessToken: string; refreshToken: string; pagirId: string
    }>({ method: 'POST', path: '/auth/otp/verify-by-email', body: { email, otp }, skipAuth: true })
    await this.saveTokens(result.accessToken, result.refreshToken)
    return result
  }

  async logout(): Promise<void> {
    try {
      await this.request({ method: 'POST', path: '/auth/logout', body: {} })
    } finally {
      await this.clearTokens()
    }
  }

  async emergencyWipe(newPagirId: string, newPublicKey: string): Promise<void> {
    await this.request({ method: 'POST', path: '/auth/emergency-wipe', body: { newPagirId, newPublicKey } })
  }

  async deleteAccount(): Promise<void> {
    await this.request({ method: 'DELETE', path: '/auth/account' })
    await this.clearTokens()
  }

  // ── User endpoints ─────────────────────────────────────────────────────────

  async getMyProfile(): Promise<{
    pagirId: string; displayName: string; publicKey: string; keyVersion: number; isActive: boolean
  }> {
    return this.request({ method: 'GET', path: '/users/me' })
  }

  async lookupUser(pagirId: string): Promise<{
    pagirId: string; displayName: string; publicKey: string
  } | null> {
    try {
      return await this.request({ method: 'GET', path: `/users/${encodeURIComponent(pagirId)}`, skipAuth: true })
    } catch {
      return null
    }
  }

  async updatePublicKey(publicKey: string): Promise<void> {
    await this.request({ method: 'PUT', path: '/users/me/public-key', body: { publicKey } })
  }

  // ── Relay endpoints ────────────────────────────────────────────────────────

  async sendFrame(receiverId: string, frameBase64: string): Promise<void> {
    await this.request({ method: 'POST', path: '/relay/frame', body: { receiverId, frameBase64 } })
  }

  async pollFrames(): Promise<Array<{ senderId: string; frame: string; ts: number }>> {
    return this.request({ method: 'GET', path: '/relay/poll' }) as any
  }
}

function _generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function _sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const apiClient = new ApiClient()
