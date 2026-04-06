/**
 * PAGIR 2 — Chunk Engine
 *
 * Splits large files (up to 10GB+) into fixed-size chunks for mesh transmission.
 * Each chunk is independently encrypted and independently routable.
 *
 * SEND FLOW:
 *   1. Compute sha256 of entire file (integrity anchor)
 *   2. Split into N chunks of CHUNK_SIZE bytes
 *   3. Compute sha256 of each chunk (per-chunk integrity)
 *   4. Emit FILE_META frame (fileName, totalChunks, fileHash)
 *   5. Emit CHUNK frames in order (but receiver handles out-of-order)
 *   6. Wait for ACK from receiver after each chunk (with retransmit on NACK)
 *
 * RECEIVE FLOW:
 *   1. FILE_META frame arrives → create ChunkBuffer entry
 *   2. CHUNK frames arrive in any order → stored by index
 *   3. When all chunks received → verify each chunk hash
 *   4. Concatenate chunks → verify full file hash
 *   5. Deliver complete file to application layer
 *
 * SECURITY:
 *   - Full-file SHA-256: prevents partial file substitution
 *   - Per-chunk SHA-256: isolates corruption to single chunk
 *   - Chunk re-request: NACK any chunk whose hash doesn't match
 *   - No chunk stored permanently: kept in memory until reassembly, then flushed
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { FrameType, FrameFlag, CHUNK_SIZE } from './FrameCodec'
import type { FileMetaPayload, ChunkPayload } from './FrameCodec'

const crypto: any = require('react-native-quick-crypto')

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChunkBuffer {
  fileId:      string
  fileName:    string
  mimeType:    string
  totalSize:   number
  totalChunks: number
  fileHash:    string
  chunkSize:   number
  receivedAt:  number   // first chunk arrival timestamp
  chunks:      Map<number, Uint8Array>   // chunkIndex → plaintext bytes
}

export type ChunkCompleteCallback = (fileId: string, fileName: string, mimeType: string, data: Uint8Array) => void
export type ChunkProgressCallback = (fileId: string, received: number, total: number) => void

// ─── Outbound: file → chunks ─────────────────────────────────────────────────

export interface PreparedTransfer {
  fileId:      string
  meta:        FileMetaPayload
  chunks:      ChunkPayload[]
}

/**
 * Prepare a file for transmission.
 * Returns metadata frame payload + array of chunk payloads.
 * Does NOT encrypt — MeshRouter/FrameSecurity handles encryption.
 */
export async function prepareTransfer(
  fileName:  string,
  mimeType:  string,
  data:      Uint8Array,
  chunkSize = CHUNK_SIZE,
): Promise<PreparedTransfer> {
  const fileId      = _uuid()
  const fileHash    = await _sha256hex(data)
  const totalChunks = Math.ceil(data.length / chunkSize)

  const meta: FileMetaPayload = {
    fileId,
    fileName,
    mimeType,
    totalSize:   data.length,
    totalChunks,
    fileHash,
    chunkSize,
  }

  const chunks: ChunkPayload[] = []
  for (let i = 0; i < totalChunks; i++) {
    const start     = i * chunkSize
    const end       = Math.min(start + chunkSize, data.length)
    const chunkData = data.slice(start, end)
    const chunkHash = await _sha256hex(chunkData)

    chunks.push({
      fileId,
      chunkIndex:  i,
      totalChunks,
      chunkHash,
      data: chunkData,
    })
  }

  return { fileId, meta, chunks }
}

/**
 * Serialize a FileMetaPayload to bytes for frame payload.
 */
export function encodeFileMeta(meta: FileMetaPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta))
}

/**
 * Serialize a ChunkPayload to bytes for frame payload.
 * Format: 4-byte chunkIndex (big-endian) + 4-byte totalChunks + data bytes
 * JSON header is prepended as length-prefixed string.
 */
export function encodeChunk(chunk: ChunkPayload): Uint8Array {
  const header = JSON.stringify({
    fileId:     chunk.fileId,
    chunkIndex: chunk.chunkIndex,
    totalChunks: chunk.totalChunks,
    chunkHash:  chunk.chunkHash,
  })
  const headerBytes = new TextEncoder().encode(header)
  const buf         = new Uint8Array(2 + headerBytes.length + chunk.data.length)
  const view        = new DataView(buf.buffer)
  view.setUint16(0, headerBytes.length, false)
  buf.set(headerBytes, 2)
  buf.set(chunk.data, 2 + headerBytes.length)
  return buf
}

export function decodeChunk(bytes: Uint8Array): ChunkPayload {
  const view       = new DataView(bytes.buffer, bytes.byteOffset)
  const headerLen  = view.getUint16(0, false)
  const headerStr  = new TextDecoder().decode(bytes.slice(2, 2 + headerLen))
  const header     = JSON.parse(headerStr)
  const data       = bytes.slice(2 + headerLen)
  return { ...header, data }
}

// ─── Inbound: chunks → file ──────────────────────────────────────────────────

class ChunkAssembler {
  /** Map<fileId, ChunkBuffer> */
  private _buffers = new Map<string, ChunkBuffer>()

  private _onComplete?: ChunkCompleteCallback
  private _onProgress?: ChunkProgressCallback

  onComplete(cb: ChunkCompleteCallback) { this._onComplete = cb }
  onProgress(cb: ChunkProgressCallback) { this._onProgress = cb }

  registerFileMeta(meta: FileMetaPayload): void {
    if (this._buffers.has(meta.fileId)) return  // already started
    this._buffers.set(meta.fileId, {
      fileId:      meta.fileId,
      fileName:    meta.fileName,
      mimeType:    meta.mimeType,
      totalSize:   meta.totalSize,
      totalChunks: meta.totalChunks,
      fileHash:    meta.fileHash,
      chunkSize:   meta.chunkSize,
      receivedAt:  Date.now(),
      chunks:      new Map(),
    })
  }

  async receiveChunk(chunk: ChunkPayload): Promise<'ok' | 'hash_mismatch' | 'complete' | 'unknown_file'> {
    const buf = this._buffers.get(chunk.fileId)
    if (!buf) return 'unknown_file'

    // Verify chunk integrity
    const actualHash = await _sha256hex(chunk.data)
    if (actualHash !== chunk.chunkHash) return 'hash_mismatch'

    buf.chunks.set(chunk.chunkIndex, chunk.data)
    this._onProgress?.(chunk.fileId, buf.chunks.size, buf.totalChunks)

    if (buf.chunks.size < buf.totalChunks) return 'ok'

    // All chunks received — reassemble
    return await this._reassemble(buf)
  }

  private async _reassemble(buf: ChunkBuffer): Promise<'complete' | 'hash_mismatch'> {
    // Concatenate chunks in order
    const total = new Uint8Array(buf.totalSize)
    let offset  = 0
    for (let i = 0; i < buf.totalChunks; i++) {
      const chunk = buf.chunks.get(i)
      if (!chunk) return 'hash_mismatch'  // missing chunk
      total.set(chunk, offset)
      offset += chunk.length
    }

    // Verify full file hash
    const actualHash = await _sha256hex(total)
    if (actualHash !== buf.fileHash) {
      this._buffers.delete(buf.fileId)
      return 'hash_mismatch'
    }

    // Deliver
    this._onComplete?.(buf.fileId, buf.fileName, buf.mimeType, total)
    this._buffers.delete(buf.fileId)
    return 'complete'
  }

  missingChunks(fileId: string): number[] {
    const buf = this._buffers.get(fileId)
    if (!buf) return []
    const missing: number[] = []
    for (let i = 0; i < buf.totalChunks; i++) {
      if (!buf.chunks.has(i)) missing.push(i)
    }
    return missing
  }

  progress(fileId: string): { received: number; total: number } | null {
    const buf = this._buffers.get(fileId)
    if (!buf) return null
    return { received: buf.chunks.size, total: buf.totalChunks }
  }

  /** Remove stale incomplete transfers (older than 2 hours) */
  pruneStale(): void {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000
    for (const [id, buf] of this._buffers) {
      if (buf.receivedAt < cutoff) this._buffers.delete(id)
    }
  }
}

export const chunkAssembler = new ChunkAssembler()

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _sha256hex(data: Uint8Array): Promise<string> {
  const hash = crypto.createHash('sha256')
  hash.update(Buffer.from(data))
  return hash.digest('hex')
}

function _uuid(): string {
  const bytes = crypto.randomBytes(16) as Buffer
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
