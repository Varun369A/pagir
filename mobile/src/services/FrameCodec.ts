/**
 * PAGIR 2 — Frame Codec
 *
 * Binary wire format for ALL PAGIR transmissions (BLE, WiFi Direct, TCP, WebSocket).
 * Every message and file chunk uses this exact frame layout.
 *
 * FRAME LAYOUT (fixed 72-byte header + variable payload + 256-byte signature):
 *
 * Offset  Size  Field
 * ──────────────────────────────────────────────────────────────
 *  0       4    MAGIC        0x50 0x41 0x47 0x52  ("PAGR")
 *  4       1    VERSION      0x02
 *  5       1    TYPE         FrameType enum
 *  6       1    FLAGS        FrameFlags bit field
 *  7       1    TTL          0–255 hop limit
 *  8      16    FRAME_ID     random 16 bytes (UUID) — anti-replay key
 * 24      16    SENDER_ID    PAGIR ID bytes (dashes stripped, 16 ASCII bytes)
 * 40      16    RECEIVER_ID  PAGIR ID bytes
 * 56       4    PAYLOAD_LEN  uint32 big-endian
 * 60       8    TIMESTAMP    uint64 big-endian ms since epoch
 * 68       4    HEADER_CRC   CRC32 of bytes 0–67
 * ──────────────────────────────────────────────────────────────
 * 72       N    PAYLOAD      AES-256-GCM encrypted bytes (see PayloadType)
 * 72+N   256    SIGNATURE    RSA-2048 PKCS#1v2.1 SHA-256 of bytes 0–(72+N-1)
 *
 * Total minimum frame: 72 + 0 + 256 = 328 bytes
 * BLE advertising mode: payload capped at 183 bytes (fits BLE 5 extended adv)
 * WiFi Direct mode: payload up to 65536 bytes per frame (64KB chunk)
 */

export const MAGIC = new Uint8Array([0x50, 0x41, 0x47, 0x52]) // "PAGR"
export const PROTOCOL_VERSION = 0x02
export const HEADER_SIZE      = 72
export const SIGNATURE_SIZE   = 256  // RSA-2048
export const MIN_FRAME_SIZE   = HEADER_SIZE + SIGNATURE_SIZE  // 328 bytes

export const enum FrameType {
  TEXT        = 0x01, // short text message (payload ≤ 4096 bytes)
  FILE_META   = 0x02, // file metadata (fileName, mimeType, totalChunks, fileHash)
  CHUNK       = 0x03, // file data chunk
  ACK         = 0x04, // acknowledgement (frame received ok)
  NACK        = 0x05, // negative ack (request retransmit)
  PING        = 0x06, // keepalive / route probe
  ROUTE_REQ   = 0x07, // "does anyone know path to pagirId X?"
  ROUTE_RESP  = 0x08, // "I can reach pagirId X, N hops"
  KEY_REFRESH = 0x09, // sender broadcasting updated public key
  REVOKE      = 0x0A, // sender revoking their identity
}

export const enum FrameFlag {
  FORWARD   = 0b00000001, // intermediate nodes MUST re-broadcast
  NO_STORE  = 0b00000010, // do not persist to disk (memory/buffer only)
  ENCRYPTED = 0b00000100, // payload is AES-256-GCM encrypted
  CHUNKED   = 0b00001000, // part of multi-chunk file transfer
  PRIORITY  = 0b00010000, // forward before normal frames
  SIGNED    = 0b00100000, // 256-byte RSA signature appended
  BROADCAST = 0b01000000, // receiver field is ignored — all devices should process
  RESERVED  = 0b10000000,
}

export const DEFAULT_TTL  = 64
export const MAX_TTL      = 255
export const BLE_MAX_PAYLOAD = 183   // BLE 5.0 extended advertising data limit
export const CHUNK_SIZE      = 65536 // 64KB — WiFi Direct chunk size
export const BLE_CHUNK_SIZE  = 160   // BLE chunk size (fits in advertising frame)

// ─── Frame Header Fields ──────────────────────────────────────────────────────

export interface FrameHeader {
  version:    number
  type:       FrameType
  flags:      number
  ttl:        number
  frameId:    Uint8Array   // 16 bytes
  senderId:   string       // PAG-XXXX-XXXX-XXXX
  receiverId: string       // PAG-XXXX-XXXX-XXXX (or "BROADCAST" if broadcast flag set)
  payloadLen: number
  timestamp:  number       // ms since epoch
  headerCrc:  number
}

// ─── Payload Types (before encryption) ───────────────────────────────────────

export interface TextPayload {
  text: string
  replyToFrameId?: string
}

export interface FileMetaPayload {
  fileId:      string    // random UUID linking all chunks
  fileName:    string
  mimeType:    string
  totalSize:   number
  totalChunks: number
  fileHash:    string    // sha256 of complete raw file bytes
  chunkSize:   number
}

export interface ChunkPayload {
  fileId:     string
  chunkIndex: number     // 0-based
  totalChunks: number
  chunkHash:  string     // sha256 of this chunk's plaintext bytes
  data:       Uint8Array // encrypted chunk bytes
}

export interface AckPayload {
  ackedFrameId: string
  chunkIndex?:  number
}

export interface NackPayload {
  nackedFrameId: string
  chunkIndex?:   number
  reason:        string
}

// ─── Encode / Decode ─────────────────────────────────────────────────────────

export interface EncodedFrame {
  header:    FrameHeader
  payload:   Uint8Array
  signature: Uint8Array  // 256 bytes, empty if SIGNED flag not set
  raw:       Uint8Array  // full wire bytes
}

/**
 * Encode a PAGIR frame to binary wire format.
 * Caller provides pre-encrypted payload and signature.
 */
export function encodeFrame(
  header: Omit<FrameHeader, 'payloadLen' | 'headerCrc'>,
  payload: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  const frameSize = HEADER_SIZE + payload.length + signature.length
  const buf       = new ArrayBuffer(frameSize)
  const view      = new DataView(buf)
  const u8        = new Uint8Array(buf)

  // Magic
  u8.set(MAGIC, 0)
  // Version
  view.setUint8(4, PROTOCOL_VERSION)
  // Type
  view.setUint8(5, header.type)
  // Flags
  view.setUint8(6, header.flags)
  // TTL
  view.setUint8(7, header.ttl)
  // Frame ID (16 bytes)
  u8.set(header.frameId.slice(0, 16), 8)
  // Sender ID (16 bytes ASCII, dashes stripped)
  const senderBytes = _pagirIdToBytes(header.senderId)
  u8.set(senderBytes, 24)
  // Receiver ID (16 bytes)
  const receiverBytes = _pagirIdToBytes(header.receiverId)
  u8.set(receiverBytes, 40)
  // Payload length
  view.setUint32(56, payload.length, false) // big-endian
  // Timestamp (split 64-bit into two 32-bit)
  const ts = header.timestamp
  view.setUint32(60, Math.floor(ts / 0x100000000), false)
  view.setUint32(64, ts >>> 0, false)
  // Header CRC (calculated over bytes 0–67)
  const crc = _crc32(u8.slice(0, 68))
  view.setUint32(68, crc, false)

  // Payload
  u8.set(payload, HEADER_SIZE)
  // Signature
  u8.set(signature, HEADER_SIZE + payload.length)

  return u8
}

/**
 * Decode raw bytes into a structured frame.
 * Returns null if magic bytes don't match or CRC fails.
 */
export function decodeFrame(raw: Uint8Array): EncodedFrame | null {
  if (raw.length < MIN_FRAME_SIZE) return null

  // Verify magic
  if (raw[0] !== 0x50 || raw[1] !== 0x41 || raw[2] !== 0x47 || raw[3] !== 0x52) return null

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)

  // Verify header CRC
  const storedCrc   = view.getUint32(68, false)
  const computedCrc = _crc32(raw.slice(0, 68))
  if (storedCrc !== computedCrc) return null // corrupted header

  const payloadLen = view.getUint32(56, false)
  if (raw.length < HEADER_SIZE + payloadLen) return null // truncated

  const flags = view.getUint8(6)
  const hasSig = (flags & FrameFlag.SIGNED) !== 0
  const expectedSize = HEADER_SIZE + payloadLen + (hasSig ? SIGNATURE_SIZE : 0)
  if (raw.length < expectedSize) return null

  const tsHigh = view.getUint32(60, false)
  const tsLow  = view.getUint32(64, false)
  const timestamp = tsHigh * 0x100000000 + tsLow

  const header: FrameHeader = {
    version:    view.getUint8(4),
    type:       view.getUint8(5) as FrameType,
    flags,
    ttl:        view.getUint8(7),
    frameId:    raw.slice(8, 24),
    senderId:   _bytesToPagirId(raw.slice(24, 40)),
    receiverId: _bytesToPagirId(raw.slice(40, 56)),
    payloadLen,
    timestamp,
    headerCrc:  storedCrc,
  }

  const payload   = raw.slice(HEADER_SIZE, HEADER_SIZE + payloadLen)
  const signature = hasSig
    ? raw.slice(HEADER_SIZE + payloadLen, HEADER_SIZE + payloadLen + SIGNATURE_SIZE)
    : new Uint8Array(0)

  return { header, payload, signature, raw }
}

// ─── Frame ID ────────────────────────────────────────────────────────────────

export function newFrameId(): Uint8Array {
  const id = new Uint8Array(16)
  const crypto: any = require('react-native-quick-crypto')
  const rand = crypto.randomBytes(16)
  id.set(rand)
  return id
}

export function frameIdToHex(id: Uint8Array): string {
  return Array.from(id).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function hexToFrameId(hex: string): Uint8Array {
  const id = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    id[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return id
}

// ─── PAGIR ID packing ────────────────────────────────────────────────────────

/** PAG-AB12-CD34-EF56 → 16 ASCII bytes (dashes stripped) */
function _pagirIdToBytes(id: string): Uint8Array {
  const stripped = id.replace(/-/g, '') // PAGAB12CD34EF56 — 15 chars
  const padded   = stripped.padEnd(16, '\x00')
  return new TextEncoder().encode(padded.slice(0, 16))
}

/** 16 ASCII bytes → PAG-AB12-CD34-EF56 */
function _bytesToPagirId(bytes: Uint8Array): string {
  const str = new TextDecoder().decode(bytes).replace(/\x00/g, '')
  if (str.length < 15) return str
  return `${str.slice(0, 3)}-${str.slice(3, 7)}-${str.slice(7, 11)}-${str.slice(11, 15)}`
}

// ─── CRC32 ───────────────────────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

export function _crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
