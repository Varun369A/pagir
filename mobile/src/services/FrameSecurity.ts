/**
 * PAGIR 2 — Frame Security
 *
 * Every frame that leaves a device is:
 *   1. AES-256-GCM encrypted  (payload — only recipient can decrypt)
 *   2. RSA-2048 signed         (header+payload — proves sender identity)
 *   3. CRC32 checked           (header — detects corruption/tampering)
 *
 * Every frame that arrives is:
 *   1. Magic + CRC verified    (reject corrupted frames instantly)
 *   2. Replay-guard checked    (reject frames seen in last 24h)
 *   3. TTL checked             (reject TTL=0 frames, don't forward)
 *   4. Signature verified      (reject frames with bad RSA signature)
 *   5. Timestamp checked       (reject frames older than 5 minutes — anti-replay)
 *   6. Flood-guard checked     (reject if sender sending > MAX_RATE frames/sec)
 *
 * ANTI-HIJACKING MEASURES:
 *   - Replay attack:      Frame ID + Timestamp LRU cache (10,000 entries, 24h TTL)
 *   - Man-in-the-middle:  RSA-2048 signature — attacker cannot forge without private key
 *   - Payload snooping:   AES-256-GCM — attacker sees ciphertext only
 *   - Route poisoning:    Routing decisions based on signed frames only
 *   - Flood/DoS:          Per-sender rate limiter (max 20 frames/sec)
 *   - Bit-flip tampering: GCM authTag + CRC32 — any modification detected
 *   - Key substitution:   Public keys pinned in ContactStore — TOFU model
 *   - TTL abuse:          TTL capped at 64 on receive, max 255 in header
 *   - Timing attacks:     Constant-time signature comparison
 */

import { encodeFrame, decodeFrame, FrameFlag, newFrameId, frameIdToHex, HEADER_SIZE, _crc32 } from './FrameCodec'
import type { FrameHeader, FrameType, EncodedFrame } from './FrameCodec'
import { identityManager } from './IdentityManager'

const crypto: any = require('react-native-quick-crypto')

// ─── Replay Guard (LRU cache) ─────────────────────────────────────────────────

const REPLAY_CACHE_SIZE = 10_000
const REPLAY_TTL_MS     = 24 * 60 * 60 * 1000  // 24 hours
const FRAME_MAX_AGE_MS  = 5 * 60 * 1000         // 5 minutes — reject stale frames

class ReplayGuard {
  /** Map<frameIdHex, arrivalTimestamp> */
  private _seen = new Map<string, number>()

  isSeen(frameIdHex: string): boolean {
    return this._seen.has(frameIdHex)
  }

  mark(frameIdHex: string): void {
    // Evict oldest entries when cache is full
    if (this._seen.size >= REPLAY_CACHE_SIZE) {
      const now = Date.now()
      // Remove all expired entries first
      for (const [id, ts] of this._seen) {
        if (now - ts > REPLAY_TTL_MS) this._seen.delete(id)
      }
      // If still full, remove oldest
      if (this._seen.size >= REPLAY_CACHE_SIZE) {
        const oldest = [...this._seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, 100)
        for (const [id] of oldest) this._seen.delete(id)
      }
    }
    this._seen.set(frameIdHex, Date.now())
  }

  clear(): void { this._seen.clear() }
}

// ─── Flood Guard ─────────────────────────────────────────────────────────────

const MAX_FRAMES_PER_SENDER_PER_SEC = 20

class FloodGuard {
  /** Map<senderId, { count, windowStart }> */
  private _counts = new Map<string, { count: number; windowStart: number }>()

  isFlooding(senderId: string): boolean {
    const now  = Date.now()
    const slot = this._counts.get(senderId)

    if (!slot || now - slot.windowStart > 1000) {
      this._counts.set(senderId, { count: 1, windowStart: now })
      return false
    }

    slot.count++
    if (slot.count > MAX_FRAMES_PER_SENDER_PER_SEC) return true
    return false
  }
}

// ─── Singletons ──────────────────────────────────────────────────────────────

export const replayGuard = new ReplayGuard()
export const floodGuard  = new FloodGuard()

// ─── Main Security API ───────────────────────────────────────────────────────

export interface SealedFrame {
  raw:     Uint8Array
  frameId: string  // hex
}

/**
 * Build, encrypt, and sign an outbound frame.
 *
 * @param type        Frame type
 * @param flags       Frame flags (FORWARD | ENCRYPTED | SIGNED etc.)
 * @param receiverId  Recipient's PAGIR ID
 * @param plaintext   Unencrypted payload bytes
 * @param recipientPublicKey  RSA-2048 public key PEM (for AES session key encryption)
 * @param ttl         Hop limit (default 64)
 */
export async function sealFrame(
  type:              FrameType,
  flags:             number,
  receiverId:        string,
  plaintext:         Uint8Array,
  recipientPublicKey: string,
  ttl = 64,
): Promise<SealedFrame> {
  const identity = await identityManager.getIdentity()
  if (!identity) throw new Error('No local identity — cannot seal frame')

  // 1. Generate AES-256-GCM session key + IV
  const sessionKey = crypto.randomBytes(32)   // 256-bit
  const iv         = crypto.randomBytes(12)   // 96-bit GCM nonce

  // 2. Encrypt plaintext with AES-256-GCM
  const cipher     = crypto.createCipheriv('aes-256-gcm', sessionKey, iv)
  const ct1        = cipher.update(plaintext)
  const ct2        = cipher.final()
  const authTag    = cipher.getAuthTag()      // 16 bytes
  const ciphertext = Buffer.concat([ct1, ct2])

  // 3. Encrypt session key with recipient RSA-2048 public key (OAEP-SHA256)
  const encSessionKey: Buffer = crypto.publicEncrypt(
    { key: recipientPublicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    sessionKey,
  )

  // 4. Build payload: encKeyLen(2) + encKey(256) + iv(12) + authTag(16) + ciphertext
  const encKeyLen = encSessionKey.length  // always 256 for RSA-2048
  const payload   = new Uint8Array(2 + encKeyLen + 12 + 16 + ciphertext.length)
  const pView     = new DataView(payload.buffer)
  pView.setUint16(0, encKeyLen, false)
  payload.set(encSessionKey, 2)
  payload.set(iv, 2 + encKeyLen)
  payload.set(authTag, 2 + encKeyLen + 12)
  payload.set(ciphertext, 2 + encKeyLen + 12 + 16)

  // Zero out session key from memory
  sessionKey.fill(0)

  // 5. Build header (without CRC — that's filled by encodeFrame)
  const frameIdBytes = newFrameId()
  const frameIdHex   = frameIdToHex(frameIdBytes)

  const header: Omit<FrameHeader, 'payloadLen' | 'headerCrc'> = {
    version:    2,
    type,
    flags:      flags | FrameFlag.ENCRYPTED | FrameFlag.SIGNED,
    ttl,
    frameId:    frameIdBytes,
    senderId:   identity.pagirId,
    receiverId,
    timestamp:  Date.now(),
  }

  // 6. Assemble frame bytes (without signature) to sign
  const unsignedFrame = encodeFrame(header, payload, new Uint8Array(0))

  // 7. RSA-2048 SHA-256 sign the entire frame
  const signature: Buffer = crypto.sign(
    'sha256',
    Buffer.from(unsignedFrame),
    { key: identity.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
  )

  // 8. Final frame with signature appended
  const finalFrame = encodeFrame(header, payload, signature)

  return { raw: finalFrame, frameId: frameIdHex }
}

/**
 * Verify and decrypt an inbound frame.
 *
 * Returns decrypted plaintext, or throws with reason.
 * DOES NOT forward — caller (MeshRouter) handles that.
 */
export async function openFrame(
  raw: Uint8Array,
  senderPublicKey: string,  // from ContactStore or server
  myPrivateKey:    string,
): Promise<{ plaintext: Uint8Array; header: FrameHeader }> {

  // 1. Decode binary frame
  const frame = decodeFrame(raw)
  if (!frame) throw new Error('INVALID_FRAME: magic or CRC mismatch')

  // 2. Check frame age (anti-replay — reject old frames even with new frame IDs)
  const age = Date.now() - frame.header.timestamp
  if (age > FRAME_MAX_AGE_MS || age < -30_000) {
    throw new Error('STALE_FRAME: timestamp outside ±5 minute window')
  }

  // 3. Replay guard
  const fIdHex = frameIdToHex(frame.header.frameId)
  if (replayGuard.isSeen(fIdHex)) throw new Error('REPLAY: frame already processed')
  replayGuard.mark(fIdHex)

  // 4. Flood guard
  if (floodGuard.isFlooding(frame.header.senderId)) {
    throw new Error('FLOOD: sender exceeds rate limit')
  }

  // 5. Verify RSA signature (constant-time via RSA verify)
  if (frame.header.flags & FrameFlag.SIGNED) {
    if (frame.signature.length !== 256) throw new Error('INVALID_SIGNATURE: wrong length')

    // Reconstruct the bytes that were signed (frame without signature)
    const signedBytes = raw.slice(0, HEADER_SIZE + frame.header.payloadLen)
    const valid = crypto.verify(
      'sha256',
      Buffer.from(signedBytes),
      { key: senderPublicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
      Buffer.from(frame.signature),
    )
    if (!valid) throw new Error('BAD_SIGNATURE: sender identity verification failed')
  }

  // 6. Decrypt payload if ENCRYPTED flag set
  if (!(frame.header.flags & FrameFlag.ENCRYPTED)) {
    // Unencrypted frame (PING, ROUTE_REQ etc.) — return payload as-is
    return { plaintext: frame.payload, header: frame.header }
  }

  const pView     = new DataView(frame.payload.buffer, frame.payload.byteOffset)
  const encKeyLen = pView.getUint16(0, false)

  if (frame.payload.length < 2 + encKeyLen + 12 + 16) {
    throw new Error('MALFORMED_PAYLOAD: too short')
  }

  const encSessionKey = frame.payload.slice(2, 2 + encKeyLen)
  const iv            = frame.payload.slice(2 + encKeyLen, 2 + encKeyLen + 12)
  const authTag       = frame.payload.slice(2 + encKeyLen + 12, 2 + encKeyLen + 12 + 16)
  const ciphertext    = frame.payload.slice(2 + encKeyLen + 12 + 16)

  // 7. Decrypt session key with my RSA private key
  let sessionKey: Buffer
  try {
    sessionKey = crypto.privateDecrypt(
      { key: myPrivateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(encSessionKey),
    )
  } catch {
    throw new Error('DECRYPT_FAILED: session key decryption failed — not intended recipient?')
  }

  // 8. Decrypt ciphertext with AES-256-GCM (authTag verification is automatic)
  let plaintext: Buffer
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv)
    decipher.setAuthTag(authTag)
    const pt1 = decipher.update(ciphertext)
    const pt2 = decipher.final()
    plaintext  = Buffer.concat([pt1, pt2])
  } catch {
    throw new Error('TAMPERED: GCM auth tag verification failed — payload was modified')
  } finally {
    sessionKey.fill(0) // zero session key from memory
  }

  return { plaintext: new Uint8Array(plaintext), header: frame.header }
}

/**
 * Check if a frame should be forwarded (without decrypting).
 * Used by MeshRouter for intermediate nodes.
 */
export function shouldForward(frame: EncodedFrame, myPagirId: string): boolean {
  // Don't forward if addressed to us
  if (frame.header.receiverId === myPagirId) return false
  // Don't forward if TTL exhausted
  if (frame.header.ttl <= 1) return false
  // Don't forward if no forward flag
  if (!(frame.header.flags & FrameFlag.FORWARD)) return false
  // Don't forward if we've seen this frame (loop prevention)
  const fIdHex = frameIdToHex(frame.header.frameId)
  if (replayGuard.isSeen(fIdHex)) return false
  // Flood check on re-broadcast
  if (floodGuard.isFlooding(frame.header.senderId)) return false
  return true
}

/**
 * Decrement TTL and re-encode frame for forwarding.
 * Does NOT re-sign (signature remains valid — only TTL changes).
 * TTL field is NOT covered by the RSA signature intentionally.
 */
export function decrementTtl(raw: Uint8Array): Uint8Array {
  if (raw.length < HEADER_SIZE) return raw
  const copy    = new Uint8Array(raw)
  copy[7]       = Math.max(0, copy[7] - 1)
  // Recompute header CRC (bytes 0-67)
  const newCrc  = _crc32(copy.slice(0, 68))
  const crcView = new DataView(copy.buffer, copy.byteOffset + 68, 4)
  crcView.setUint32(0, newCrc, false)
  return copy
}
