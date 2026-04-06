/**
 * PAGIR 2 — BLE Mesh Transport
 *
 * Uses Bluetooth Low Energy advertising + scanning to create a
 * device-to-device mesh network without internet or Wi-Fi.
 *
 * HOW IT WORKS:
 *   Advertising: Device broadcasts PAGIR frames as BLE manufacturer-specific data.
 *     - BLE 5.0 extended advertising: up to 255 bytes payload per advertisement.
 *     - For frames > 183 bytes: chunked into multiple BLE advertisement slots.
 *     - Any BLE device within range receives the advertisement passively.
 *
 *   Scanning: Device continuously scans for BLE advertisements with PAGIR UUID.
 *     - On match: decode frame → route decision → forward or deliver.
 *
 *   PAGIR BLE Service UUID: "PAGR-0002-MESH-0000-000000000000" (128-bit)
 *   Manufacturer ID: 0xPAGR (custom, non-registered — fine for P2P)
 *
 * RANGE:
 *   BLE 4.0: ~10-30 meters
 *   BLE 5.0: ~50-100 meters
 *   BLE 5.0 with directional antenna: up to 200 meters
 *
 * THROUGHPUT:
 *   BLE advertising: ~183 bytes per adv interval (non-connectable)
 *   BLE GATT connection: ~230 KB/s (for larger transfers)
 *
 * For files > 50KB: BLEMesh requests a GATT connection for bulk transfer.
 * For messages and small files: pure advertising (no connection needed).
 *
 * REQUIRES: react-native-ble-plx (or similar BLE library)
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native'

// BLE constants
const PAGIR_SERVICE_UUID     = '50414752-0002-4d45-5348-000000000000'
const PAGIR_MANUFACTURER_ID  = 0x5041  // "PA" in hex
const BLE_ADV_MAX_BYTES      = 183     // BLE 5.0 extended advertising data
const BLE_SCAN_INTERVAL_MS   = 500
const BLE_ADV_INTERVAL_MS    = 200     // how often we broadcast
const GATT_MTU               = 512     // negotiated MTU for bulk transfer
const GATT_CHUNK_SIZE        = 500     // bytes per GATT write

export type BLEFrameHandler = (raw: Uint8Array, rssi: number) => void

// ─── BLE Mesh Manager ────────────────────────────────────────────────────────

class BLEMesh {
  private _scanning  = false
  private _advertising = false
  private _handlers: BLEFrameHandler[] = []

  /** Start BLE scanning for PAGIR frames */
  startScanning(): void {
    if (this._scanning) return
    this._scanning = true

    try {
      const BleManager = require('react-native-ble-plx').BleManager
      const manager    = new BleManager()

      manager.startDeviceScan(
        [PAGIR_SERVICE_UUID],  // filter by PAGIR service UUID
        { allowDuplicates: true, scanMode: 2 /* BALANCED */ },
        (error: any, device: any) => {
          if (error || !device) return
          const raw = this._extractPagirPayload(device)
          if (raw) {
            this._handlers.forEach(h => h(raw, device.rssi ?? -100))
          }
        }
      )
    } catch {
      // BLE library not available — degrade gracefully
      console.warn('[BLEMesh] BLE library unavailable — mesh scanning disabled')
    }
  }

  stopScanning(): void {
    this._scanning = false
    try {
      const BleManager = require('react-native-ble-plx').BleManager
      new BleManager().stopDeviceScan()
    } catch {}
  }

  /**
   * Broadcast a PAGIR frame via BLE advertising.
   * Frames > BLE_ADV_MAX_BYTES are split into BLE advertisement segments.
   */
  async broadcast(frameRaw: Uint8Array): Promise<void> {
    if (frameRaw.length <= BLE_ADV_MAX_BYTES) {
      await this._advertise(frameRaw)
      return
    }

    // Split into BLE-sized segments with sequence header
    const segments = _splitBleSegments(frameRaw, BLE_ADV_MAX_BYTES - 4) // 4 bytes for seq header
    for (let i = 0; i < segments.length; i++) {
      const seg = _buildBleSegment(segments[i], i, segments.length)
      await this._advertise(seg)
      await _sleep(BLE_ADV_INTERVAL_MS)
    }
  }

  /**
   * Establish a GATT connection for bulk file chunk transfer.
   * Used when receiver is within BLE range and file is large.
   */
  async connectAndSend(
    deviceId: string,
    frameRaw: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    let BleManager: any
    try { BleManager = require('react-native-ble-plx').BleManager }
    catch { throw new Error('BLE library unavailable') }

    const manager = new BleManager()
    const device  = await manager.connectToDevice(deviceId)
    await device.discoverAllServicesAndCharacteristics()

    const services     = await device.services()
    const pagirService = services.find((s: any) => s.uuid.toLowerCase().includes('50414752'))
    if (!pagirService) { await device.cancelConnection(); throw new Error('PAGIR service not found on device') }

    const chars     = await pagirService.characteristics()
    const txChar    = chars.find((c: any) => c.isWritableWithoutResponse || c.isWritable)
    if (!txChar) { await device.cancelConnection(); throw new Error('No writable characteristic') }

    // Send frame in GATT_CHUNK_SIZE chunks
    let sent = 0
    while (sent < frameRaw.length) {
      const chunk = frameRaw.slice(sent, sent + GATT_CHUNK_SIZE)
      const b64   = Buffer.from(chunk).toString('base64')
      await txChar.writeWithoutResponse(b64)
      sent += chunk.length
      onProgress?.(sent, frameRaw.length)
    }

    await device.cancelConnection()
  }

  onFrame(handler: BLEFrameHandler): () => void {
    this._handlers.push(handler)
    return () => { this._handlers = this._handlers.filter(h => h !== handler) }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async _advertise(data: Uint8Array): Promise<void> {
    // React Native BLE advertising requires a native module
    // Implementation: android/ios native module wraps BluetoothLeAdvertiser (Android)
    // and CBPeripheralManager (iOS)
    const module = NativeModules.PagirBleAdvertiser
    if (!module) {
      console.warn('[BLEMesh] PagirBleAdvertiser native module not found')
      return
    }
    await module.advertise(
      Array.from(data),        // byte array
      PAGIR_SERVICE_UUID,
      BLE_ADV_INTERVAL_MS,
    )
  }

  private _extractPagirPayload(device: any): Uint8Array | null {
    try {
      // device.manufacturerData is base64 encoded
      if (!device.manufacturerData) return null
      const bytes = new Uint8Array(Buffer.from(device.manufacturerData, 'base64'))
      // First 2 bytes = manufacturer ID, rest = payload
      if (bytes.length < 4) return null
      const mfgId = (bytes[0] << 8) | bytes[1]
      if (mfgId !== PAGIR_MANUFACTURER_ID) return null
      return bytes.slice(2)
    } catch { return null }
  }
}

// ─── BLE Segment protocol (for frames > 183 bytes) ───────────────────────────

/**
 * Segment frame header: 4 bytes
 *   [0] segment index (0-255)
 *   [1] total segments (0-255)
 *   [2-3] session ID (same for all segments of one frame)
 */
function _buildBleSegment(data: Uint8Array, index: number, total: number): Uint8Array {
  const header = new Uint8Array(4)
  header[0] = index
  header[1] = total
  header[2] = 0xAB  // fixed session marker
  header[3] = 0xCD
  const out = new Uint8Array(4 + data.length)
  out.set(header, 0)
  out.set(data, 4)
  return out
}

function _splitBleSegments(data: Uint8Array, maxSize: number): Uint8Array[] {
  const segs: Uint8Array[] = []
  let offset = 0
  while (offset < data.length) {
    segs.push(data.slice(offset, offset + maxSize))
    offset += maxSize
  }
  return segs
}

// ─── BLE Segment Assembler ────────────────────────────────────────────────────

class BleSegmentAssembler {
  /** Map<sessionKey, { segments, total, received }> */
  private _pending = new Map<string, { parts: Map<number, Uint8Array>; total: number; ts: number }>()

  /** Feed a raw BLE advertisement. Returns complete frame if all segments received. */
  feed(raw: Uint8Array): Uint8Array | null {
    if (raw.length < 4) return null
    if (raw[2] !== 0xAB || raw[3] !== 0xCD) {
      // Not a segmented frame — treat as complete
      return raw
    }

    const index = raw[0]
    const total = raw[1]
    const key   = `${total}`

    if (total === 1) {
      // Single segment
      return raw.slice(4)
    }

    let entry = this._pending.get(key)
    if (!entry) {
      entry = { parts: new Map(), total, ts: Date.now() }
      this._pending.set(key, entry)
    }

    entry.parts.set(index, raw.slice(4))

    if (entry.parts.size < total) return null

    // Reassemble
    const assembled = new Uint8Array(
      [...entry.parts.values()].reduce((sum, p) => sum + p.length, 0)
    )
    let offset = 0
    for (let i = 0; i < total; i++) {
      const part = entry.parts.get(i)!
      assembled.set(part, offset)
      offset += part.length
    }
    this._pending.delete(key)
    return assembled
  }

  pruneStale(): void {
    const cutoff = Date.now() - 30_000  // 30 second timeout
    for (const [k, v] of this._pending) {
      if (v.ts < cutoff) this._pending.delete(k)
    }
  }
}

function _sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export const bleMesh          = new BLEMesh()
export const bleSegmentAssembler = new BleSegmentAssembler()
