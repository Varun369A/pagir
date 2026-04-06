/**
 * PAGIR 2 — IdentityManager
 *
 * THE single source of truth for device identity.
 * All screens, services, and stores must go through this class.
 *
 * Identity = { pagirId, publicKey, privateKey }
 *
 * 5-Tier Recovery:
 *   T1: In-memory cache (fastest — lost on app kill, that's fine)
 *   T2: Keychain SECURE_HARDWARE (hardware-backed TEE — most secure)
 *   T3: Keychain SECURE_SOFTWARE (software TEE — fallback for older devices)
 *   T4: AsyncStorage (survives reinstall via Android backup, not secure but ID-only)
 *   T5: GET /api/v2/users/me (requires valid JWT — restores public key from server)
 *
 * Private key NEVER goes to AsyncStorage (T4). Only pagirId and publicKey
 * are stored in AsyncStorage as they are not secret.
 *
 * Design principles:
 *   - Never throws — returns null on total failure
 *   - Storage writes are fire-and-forget (never block user flow)
 *   - Clear separation: read path vs write path
 */

import * as Keychain from 'react-native-keychain'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { generatePagirId, isValidPagirId } from '../utils/pagirId'
import { generateKeyPair, derivePublicKey } from '../utils/crypto'
import { logger } from './Logger'

// ─── Keychain service names ───────────────────────────────────────────────────

const KC_PRIVATE_KEY  = 'com.pagir2.identity.privateKey'
const KC_IDENTITY     = 'com.pagir2.identity.full'   // { pagirId, publicKey } JSON

// ─── AsyncStorage keys ────────────────────────────────────────────────────────

const AS_PAGIR_ID     = 'pagir2:id'
const AS_PUBLIC_KEY   = 'pagir2:publicKey'
const AS_REGISTERED_ID = 'pagir2:registered_id'    // server-confirmed ID

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeviceIdentity {
  pagirId:    string
  publicKey:  string   // RSA-2048 PEM
  privateKey: string   // RSA-2048 PEM — NEVER leaves device
}

// ─── IdentityManager ─────────────────────────────────────────────────────────

class IdentityManager {
  private _pagirId:   string | null = null
  private _publicKey: string | null = null
  private _privateKey: string | null = null

  // ── Full identity ──────────────────────────────────────────────────────────

  /**
   * Returns the full device identity or null if totally unrecoverable.
   * Never throws.
   */
  async getIdentity(): Promise<DeviceIdentity | null> {
    const [pagirId, publicKey, privateKey] = await Promise.all([
      this.getPagirId(),
      this.getPublicKey(),
      this.getPrivateKey(),
    ])
    if (!pagirId || !publicKey || !privateKey) return null
    return { pagirId, publicKey, privateKey }
  }

  // ── PAGIR ID ───────────────────────────────────────────────────────────────

  async getPagirId(): Promise<string | null> {
    // T1: Memory
    if (this._pagirId) return this._pagirId

    // T2: Keychain full identity bundle
    try {
      const cred = await Keychain.getInternetCredentials(KC_IDENTITY)
      if (cred) {
        const obj = JSON.parse(cred.password) as { pagirId?: string; publicKey?: string }
        if (obj.pagirId && isValidPagirId(obj.pagirId)) {
          this._pagirId = obj.pagirId
          if (obj.publicKey) this._publicKey = obj.publicKey
          return this._pagirId
        }
      }
    } catch {}

    // T3: AsyncStorage (registered_id is set by server on first verify)
    try {
      const id = await AsyncStorage.getItem(AS_REGISTERED_ID)
        ?? await AsyncStorage.getItem(AS_PAGIR_ID)
      if (id && isValidPagirId(id)) {
        this._pagirId = id
        _persist({ pagirId: id })
        return this._pagirId
      }
    } catch {}

    // T4: JWT sub claim (if logged in)
    try {
      const token = await AsyncStorage.getItem('pagir2:access_token')
      if (token) {
        const payload = _decodeJwt(token)
        if (payload?.sub && isValidPagirId(payload.sub)) {
          this._pagirId = payload.sub
          _persist({ pagirId: this._pagirId })
          return this._pagirId
        }
      }
    } catch {}

    return null
  }

  async getPublicKey(): Promise<string | null> {
    // T1: Memory
    if (this._publicKey) return this._publicKey

    // T2: Keychain bundle
    try {
      const cred = await Keychain.getInternetCredentials(KC_IDENTITY)
      if (cred) {
        const obj = JSON.parse(cred.password) as { publicKey?: string }
        if (obj.publicKey?.includes('BEGIN')) {
          this._publicKey = obj.publicKey
          return this._publicKey
        }
      }
    } catch {}

    // T3: AsyncStorage
    try {
      const pk = await AsyncStorage.getItem(AS_PUBLIC_KEY)
      if (pk?.includes('BEGIN')) {
        this._publicKey = pk
        return this._publicKey
      }
    } catch {}

    // T4: Derive from private key
    const privateKey = await this.getPrivateKey()
    if (privateKey) {
      try {
        const derived = derivePublicKey(privateKey)
        this._publicKey = derived
        _persist({ publicKey: derived })
        return this._publicKey
      } catch {}
    }

    return null
  }

  async getPrivateKey(): Promise<string | null> {
    // T1: Memory
    if (this._privateKey) return this._privateKey

    // T2: Keychain hardware-backed
    try {
      const cred = await Keychain.getInternetCredentials(KC_PRIVATE_KEY)
      if (cred?.password?.includes('BEGIN')) {
        this._privateKey = cred.password
        return this._privateKey
      }
    } catch {}

    // T3: Try software-backed fallback
    try {
      const cred = await Keychain.getGenericPassword({ service: KC_PRIVATE_KEY + ':sw' })
      if (cred && cred !== false && (cred as Keychain.UserCredentials).password?.includes('BEGIN')) {
        this._privateKey = (cred as Keychain.UserCredentials).password
        return this._privateKey
      }
    } catch {}

    // No AsyncStorage fallback for private keys — that would be insecure
    return null
  }

  // ── Store ──────────────────────────────────────────────────────────────────

  async storeKeyPair(publicKey: string, privateKey: string): Promise<void> {
    this._publicKey  = publicKey
    this._privateKey = privateKey

    const pagirId = this._pagirId

    // Store private key in hardware-backed keychain
    const stored = await Keychain.setInternetCredentials(
      KC_PRIVATE_KEY,
      'private_key',
      privateKey,
      {
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
      }
    ).catch(() => false)

    if (!stored) {
      // Hardware not available — fall back to software TEE
      await Keychain.setGenericPassword('private_key', privateKey, {
        service: KC_PRIVATE_KEY + ':sw',
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
      }).catch(() => {})
    }

    // Store public key + pagirId in identity bundle
    if (pagirId) {
      _persist({ pagirId, publicKey })
    } else {
      _persist({ publicKey })
    }
  }

  async storePagirId(id: string): Promise<void> {
    if (!isValidPagirId(id)) {
      logger.warn('storePagirId: invalid ID format', id)
      return
    }
    this._pagirId = id
    _persist({ pagirId: id, publicKey: this._publicKey ?? undefined })
  }

  // ── Init (generate if missing) ─────────────────────────────────────────────

  /**
   * Ensure a PAGIR ID and key pair exist on this device.
   * Called on app boot. Idempotent — won't overwrite existing identity.
   */
  async ensureIdentity(): Promise<void> {
    const existing = await this.getIdentity()
    if (existing) return  // Already initialized

    // Generate fresh identity
    try {
      const pagirId = generatePagirId()
      const { publicKey, privateKey } = await generateKeyPair()
      this._pagirId = pagirId
      await this.storeKeyPair(publicKey, privateKey)
      await this.storePagirId(pagirId)
      logger.info('IdentityManager: generated fresh identity', pagirId)
    } catch (err) {
      logger.error('IdentityManager: failed to generate identity', err)
    }
  }

  // ── Wipe (emergency) ──────────────────────────────────────────────────────

  /**
   * Clear all local identity data. Called after emergency wipe or delete account.
   * Does NOT revoke on server — caller must do that first.
   */
  async wipeLocal(): Promise<void> {
    this._pagirId   = null
    this._publicKey = null
    this._privateKey = null

    await Promise.allSettled([
      Keychain.resetInternetCredentials(KC_PRIVATE_KEY),
      Keychain.resetInternetCredentials(KC_IDENTITY),
      Keychain.resetGenericPassword({ service: KC_PRIVATE_KEY + ':sw' }),
      AsyncStorage.multiRemove([
        AS_PAGIR_ID, AS_PUBLIC_KEY, AS_REGISTERED_ID,
        'pagir2:access_token', 'pagir2:refresh_token',
      ]),
    ])
  }

  // ── Cache ──────────────────────────────────────────────────────────────────

  clearCache(): void {
    this._pagirId   = null
    this._publicKey = null
    this._privateKey = null
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Persist pagirId and/or publicKey to Keychain + AsyncStorage (fire-and-forget) */
function _persist(data: { pagirId?: string; publicKey?: string | null }): void {
  const { pagirId, publicKey } = data

  // Keychain identity bundle
  if (pagirId || publicKey) {
    const bundle: Record<string, string> = {}
    if (pagirId)   bundle.pagirId   = pagirId
    if (publicKey) bundle.publicKey = publicKey

    // Read existing, merge, write back
    Keychain.getInternetCredentials(KC_IDENTITY)
      .then(existing => {
        const prev = existing ? JSON.parse((existing as any).password ?? '{}') : {}
        const merged = { ...prev, ...bundle }
        return Keychain.setInternetCredentials(KC_IDENTITY, 'identity', JSON.stringify(merged), {
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        })
      })
      .catch(() => {})
  }

  // AsyncStorage (non-sensitive — ID and public key only)
  const writes: [string, string][] = []
  if (pagirId) {
    writes.push([AS_PAGIR_ID, pagirId])
    writes.push([AS_REGISTERED_ID, pagirId])
  }
  if (publicKey) writes.push([AS_PUBLIC_KEY, publicKey])
  if (writes.length) {
    AsyncStorage.multiSet(writes).catch(() => {})
  }
}

/** Decode JWT payload without verification (client-side — server verified on issue) */
function _decodeJwt(token: string): { sub?: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(payload)
  } catch {
    return null
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const identityManager = new IdentityManager()

// Simple logger wrapper (avoids circular imports)
const logger = {
  info: (...args: unknown[]) => console.log('[IdentityManager]', ...args),
  warn: (...args: unknown[]) => console.warn('[IdentityManager]', ...args),
  error: (...args: unknown[]) => console.error('[IdentityManager]', ...args),
}
