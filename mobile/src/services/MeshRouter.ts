/**
 * PAGIR 2 — Mesh Router
 *
 * The brain of PAGIR's offline-first mesh network.
 * Orchestrates all transport layers and makes routing decisions.
 *
 * TRANSPORT PRIORITY (best → fallback):
 *   1. Wi-Fi Direct      — fastest (250 Mbps), requires proximity
 *   2. LAN (same router) — fast (100 Mbps), no internet, same network
 *   3. BLE GATT          — medium (230 KB/s), short range
 *   4. BLE Advertising   — slow (183 B/adv), passive relay capable
 *   5. Internet Relay    — no proximity needed, but requires internet
 *   6. Store + Forward   — defer until a path becomes available
 *
 * ROUTING TABLE:
 *   Learned from ROUTE_REQ/ROUTE_RESP frames and peer advertisements.
 *   Each entry: { pagirId, transport, lastSeen, hopCount, metric }
 *   Table expires entries after 5 minutes (peers move around).
 *
 * MESH HOP PROTOCOL:
 *   - Intermediate PAGIR nodes forward frames addressed to others
 *   - TTL decrements on each hop (starts at 64, drops frame at 0)
 *   - Frame IDs prevent loops (FrameSecurity.ReplayGuard)
 *   - Directional: ROUTE_REQ floods, ROUTE_RESP is unicast back
 *
 * SECURITY AT ROUTING LAYER:
 *   - Intermediate nodes cannot decrypt payloads (no keys)
 *   - Nodes CAN read sender/receiver IDs in header (for routing)
 *   - To hide metadata: receiver ID is encrypted in a future version
 *     (Sealed sender — similar to Signal's approach)
 */

import { sealFrame, openFrame, shouldForward, decrementTtl, replayGuard } from './FrameSecurity'
import { FrameType, FrameFlag, DEFAULT_TTL, encodeFrame, decodeFrame, newFrameId, frameIdToHex } from './FrameCodec'
import { bleMesh, bleSegmentAssembler } from './BLEMesh'
import { wifiMesh } from './WiFiMesh'
import { identityManager } from './IdentityManager'
import { contactStore } from './ContactStore'
import { syncQueue } from './SyncQueue'
import { chunkAssembler, decodeChunk, encodeChunk, encodeFileMeta, prepareTransfer } from './ChunkEngine'
import type { FileMetaPayload, ChunkPayload } from './FrameCodec'
import { apiClient } from '../store/apiClient'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RouteEntry {
  pagirId:   string
  transport: 'wifidirect' | 'lan' | 'ble_gatt' | 'ble_adv' | 'internet' | 'unknown'
  metric:    number   // lower = better (0 = direct, 1 = one hop, etc.)
  lastSeen:  number   // timestamp
  deviceId?: string   // underlying transport device ID
}

export interface DeliveredMessage {
  senderId: string
  type:     'text' | 'file'
  text?:    string
  fileId?:  string
  fileName?: string
  mimeType?: string
  data?:    Uint8Array
  ts:       number
}

export type DeliveryHandler = (msg: DeliveredMessage) => void

// ─── Routing Table ───────────────────────────────────────────────────────────

class RoutingTable {
  private _table = new Map<string, RouteEntry>()
  private ROUTE_TTL_MS = 5 * 60 * 1000  // routes expire after 5 min

  set(entry: RouteEntry): void {
    this._table.set(entry.pagirId, entry)
  }

  get(pagirId: string): RouteEntry | null {
    const entry = this._table.get(pagirId)
    if (!entry) return null
    if (Date.now() - entry.lastSeen > this.ROUTE_TTL_MS) {
      this._table.delete(pagirId)
      return null
    }
    return entry
  }

  remove(pagirId: string): void { this._table.delete(pagirId) }
  clear(): void { this._table.clear() }
  all(): RouteEntry[] { return [...this._table.values()] }
}

const routingTable = new RoutingTable()

// ─── Mesh Router ─────────────────────────────────────────────────────────────

class MeshRouter {
  private _handlers:  DeliveryHandler[] = []
  private _started    = false
  private _myPagirId: string | null = null

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._started) return
    this._started = true

    const identity = await identityManager.getIdentity()
    if (!identity) throw new Error('Cannot start MeshRouter without identity')
    this._myPagirId = identity.pagirId

    // Register transport handlers
    bleMesh.onFrame((raw, rssi) => this._onRawFrame(raw, 'ble_adv', rssi))
    wifiMesh.onFrame((raw, peer) => this._onRawFrame(raw, peer.transport as any, 0))

    // Advertise presence
    await wifiMesh.advertisePresence(identity.pagirId)
    await wifiMesh.startDiscovery()
    await wifiMesh.startServer(identity.pagirId)
    bleMesh.startScanning()

    // Update routing table from WiFi peer discovery
    wifiMesh.onPeerDiscovered(peer => {
      if (peer.pagirId) {
        routingTable.set({
          pagirId:   peer.pagirId,
          transport: peer.transport,
          metric:    peer.transport === 'wifidirect' ? 0 : 1,
          lastSeen:  Date.now(),
          deviceId:  peer.deviceId,
        })
      }
    })

    wifiMesh.onPeerLost(deviceId => {
      // Remove routes that used this device
      for (const entry of routingTable.all()) {
        if (entry.deviceId === deviceId) routingTable.remove(entry.pagirId)
      }
    })

    // Chunk assembly callbacks
    chunkAssembler.onComplete((fileId, fileName, mimeType, data) => {
      this._handlers.forEach(h => h({
        senderId: 'unknown',  // filled in by _onRawFrame context
        type:     'file',
        fileId, fileName, mimeType, data,
        ts: Date.now(),
      }))
    })

    // Drain offline queue when peers appear
    wifiMesh.onPeerDiscovered(() => this._drainQueue())
  }

  async stop(): Promise<void> {
    this._started = false
    bleMesh.stopScanning()
    wifiMesh.stopDiscovery()
    await wifiMesh.stopAdvertising()
  }

  // ─── Send API ────────────────────────────────────────────────────────────────

  /**
   * Send a text message to a contact.
   * Automatically picks best transport.
   */
  async sendText(receiverId: string, text: string): Promise<void> {
    const contact = contactStore.get(receiverId)
    if (!contact) throw new Error('Contact not found')

    const identity = await identityManager.getIdentity()
    if (!identity) throw new Error('No identity')

    const plaintext = new TextEncoder().encode(JSON.stringify({ text, ts: Date.now() }))
    const flags     = FrameFlag.FORWARD | FrameFlag.PRIORITY

    const frame = await sealFrame(FrameType.TEXT, flags, receiverId, plaintext, contact.publicKeyPem)
    await this._dispatch(receiverId, frame.raw, false)
  }

  /**
   * Send a file to a contact.
   * Automatically chunks if large.
   */
  async sendFile(
    receiverId:  string,
    fileName:    string,
    mimeType:    string,
    data:        Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const contact = contactStore.get(receiverId)
    if (!contact) throw new Error('Contact not found')

    const identity = await identityManager.getIdentity()
    if (!identity) throw new Error('No identity')

    const { meta, chunks } = await prepareTransfer(fileName, mimeType, data)

    // Send FILE_META frame first
    const metaPayload = encodeFileMeta(meta)
    const metaFrame   = await sealFrame(
      FrameType.FILE_META,
      FrameFlag.FORWARD | FrameFlag.CHUNKED,
      receiverId, metaPayload, contact.publicKeyPem,
    )
    await this._dispatch(receiverId, metaFrame.raw, false)

    // Send each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkPayload = encodeChunk(chunks[i])
      const chunkFrame   = await sealFrame(
        FrameType.CHUNK,
        FrameFlag.FORWARD | FrameFlag.CHUNKED,
        receiverId, chunkPayload, contact.publicKeyPem,
      )
      await this._dispatch(receiverId, chunkFrame.raw, true)
      onProgress?.(i + 1, chunks.length)
    }
  }

  onDelivery(handler: DeliveryHandler): () => void {
    this._handlers.push(handler)
    return () => { this._handlers = this._handlers.filter(h => h !== handler) }
  }

  // ─── Internal: Frame Dispatch ─────────────────────────────────────────────

  /**
   * Dispatch a frame using the best available transport.
   */
  private async _dispatch(
    receiverId: string,
    frameRaw:   Uint8Array,
    canQueue:   boolean,
  ): Promise<void> {
    const route = routingTable.get(receiverId)

    // Priority 1: Wi-Fi Direct or LAN direct
    if (route && (route.transport === 'wifidirect' || route.transport === 'lan')) {
      const peer = wifiMesh.getPeer(receiverId)
      if (peer) {
        await wifiMesh.sendFrame(peer, frameRaw)
        return
      }
    }

    // Priority 2: BLE GATT (if route known and frame small enough)
    if (route && route.transport === 'ble_adv' && frameRaw.length < 65536) {
      await bleMesh.broadcast(frameRaw)
      return
    }

    // Priority 3: BLE advertising (mesh flood for small frames)
    if (frameRaw.length <= 500) {
      await bleMesh.broadcast(frameRaw)
      return
    }

    // Priority 4: Internet relay
    try {
      if (apiClient.isAuthenticated()) {
        const b64 = Buffer.from(frameRaw).toString('base64')
        // await apiClient.relayFrame(receiverId, b64)  // TODO: relay endpoint
        return
      }
    } catch { /* fall through */ }

    // Priority 5: Queue for later
    if (canQueue) {
      await syncQueue.push({
        id:          frameIdToHex(newFrameId()),
        recipientId: receiverId,
        data:        Buffer.from(frameRaw).toString('base64'),
        meta:        {},
      })
    }
  }

  // ─── Internal: Frame Receive ─────────────────────────────────────────────────

  private async _onRawFrame(
    raw:       Uint8Array,
    transport: string,
    rssi:      number,
  ): Promise<void> {
    // Try to reassemble BLE segments first
    const assembled = bleSegmentAssembler.feed(raw)
    if (!assembled) return  // waiting for more segments

    const frame = decodeFrame(assembled)
    if (!frame) return  // invalid magic or CRC

    const { header } = frame
    const myId = this._myPagirId

    // Update routing table with sender info
    if (header.senderId) {
      routingTable.set({
        pagirId:   header.senderId,
        transport: transport as any,
        metric:    1,
        lastSeen:  Date.now(),
      })
    }

    // Is this frame for me?
    if (header.receiverId === myId) {
      await this._deliver(assembled, header.senderId)
      return
    }

    // Should I forward?
    if (shouldForward(frame, myId ?? '')) {
      const forwarded = decrementTtl(assembled)
      await this._dispatch(header.receiverId, forwarded, false)
      // Mark as seen after forwarding (prevents re-forwarding same frame)
      replayGuard.mark(frameIdToHex(header.frameId))
    }
  }

  private async _deliver(raw: Uint8Array, senderId: string): Promise<void> {
    const identity = await identityManager.getIdentity()
    if (!identity) return

    const contact = contactStore.get(senderId)
    if (!contact) {
      // Unknown sender — ignore (security: don't process frames from non-contacts)
      return
    }

    let plaintext: Uint8Array
    let header: any
    try {
      const result = await openFrame(raw, contact.publicKeyPem, identity.privateKey)
      plaintext = result.plaintext
      header    = result.header
    } catch (err: any) {
      // Log security rejection but don't crash
      console.warn('[MeshRouter] Frame rejected:', err.message)
      return
    }

    switch (header.type) {
      case FrameType.TEXT: {
        const { text } = JSON.parse(new TextDecoder().decode(plaintext))
        this._handlers.forEach(h => h({ senderId, type: 'text', text, ts: Date.now() }))
        break
      }
      case FrameType.FILE_META: {
        const meta = JSON.parse(new TextDecoder().decode(plaintext)) as FileMetaPayload
        chunkAssembler.registerFileMeta(meta)
        break
      }
      case FrameType.CHUNK: {
        const chunk = decodeChunk(plaintext)
        const result = await chunkAssembler.receiveChunk(chunk)
        // ChunkAssembler fires onComplete callback when all chunks arrive
        break
      }
    }
  }

  // ─── Offline Queue Drain ─────────────────────────────────────────────────────

  private async _drainQueue(): Promise<void> {
    let item = await syncQueue.peek()
    while (item) {
      const frameRaw = new Uint8Array(Buffer.from(item.data, 'base64'))
      try {
        await this._dispatch(item.recipientId, frameRaw, false)
        await syncQueue.ack(item.id)
      } catch {
        await syncQueue.nack(item.id)
        break  // stop draining if dispatch fails
      }
      item = await syncQueue.peek()
    }
  }
}

export const meshRouter = new MeshRouter()
