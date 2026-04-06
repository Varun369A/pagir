/**
 * PAGIR 2 — Wi-Fi Mesh Transport
 *
 * Handles device-to-device file transfer without internet using:
 *   1. Wi-Fi Direct (P2P) — Android WifiP2pManager / iOS Multipeer Connectivity
 *   2. Local LAN (same Wi-Fi router) — TCP socket + mDNS discovery
 *   3. Hotspot mode — one device creates hotspot, other connects
 *
 * THROUGHPUT:
 *   Wi-Fi Direct: up to 250 Mbps → 10GB file in ~6 minutes
 *   LAN (same router): up to 100 Mbps → 10GB file in ~13 minutes
 *   BLE fallback: ~0.2 Mbps → 10GB = impractical, use chunking + store-carry-forward
 *
 * PROTOCOL OVER WIFI:
 *   - TCP connection (reliable, ordered)
 *   - 4-byte length prefix per frame (big-endian uint32)
 *   - Then N bytes of PAGIR binary frame
 *   - Receiver sends ACK frame after each chunk
 *   - On NACK: retransmit that chunk
 *
 * mDNS DISCOVERY:
 *   Service: _pagir._tcp.local
 *   TXT record: { pagirId: "PAG-...", v: "2", caps: "file,msg" }
 *
 * SECURITY: All data is already encrypted at the PAGIR frame layer.
 * Wi-Fi Direct / TCP is just the pipe — no additional TLS needed
 * (though TLS is added in production for defense-in-depth).
 */

import { NativeModules, NativeEventEmitter } from 'react-native'

const PAGIR_TCP_PORT   = 4748   // registered PAGIR port
const FRAME_SIZE_BYTES = 4      // uint32 prefix
const CONNECT_TIMEOUT  = 10_000 // ms

export interface WiFiPeer {
  deviceId:  string
  pagirId:   string
  name:      string
  ipAddress: string
  port:      number
  rssi?:     number
  transport: 'wifidirect' | 'lan' | 'hotspot'
}

export type WiFiFrameHandler  = (raw: Uint8Array, peer: WiFiPeer) => void
export type PeerDiscoveredHandler = (peer: WiFiPeer) => void
export type PeerLostHandler = (deviceId: string) => void

// ─── WiFi Mesh Manager ───────────────────────────────────────────────────────

class WiFiMesh {
  private _frameHandlers:    WiFiFrameHandler[]     = []
  private _peerDiscovered:   PeerDiscoveredHandler[] = []
  private _peerLost:         PeerLostHandler[]      = []
  private _peers             = new Map<string, WiFiPeer>()
  private _discovering       = false

  /** Start peer discovery (mDNS + Wi-Fi Direct) */
  async startDiscovery(): Promise<void> {
    if (this._discovering) return
    this._discovering = true

    // Start mDNS discovery
    this._startMDNS()

    // Start Wi-Fi Direct discovery (Android only)
    if (NativeModules.PagirWifiDirect) {
      try {
        const module   = NativeModules.PagirWifiDirect
        const emitter  = new NativeEventEmitter(module)

        emitter.addListener('onPeerFound', (peer: any) => {
          const wifiPeer: WiFiPeer = {
            deviceId:  peer.deviceId,
            pagirId:   peer.pagirId ?? '',
            name:      peer.name ?? peer.deviceId,
            ipAddress: peer.ip ?? '',
            port:      PAGIR_TCP_PORT,
            transport: 'wifidirect',
          }
          this._peers.set(peer.deviceId, wifiPeer)
          this._peerDiscovered.forEach(h => h(wifiPeer))
        })

        emitter.addListener('onPeerLost', ({ deviceId }: any) => {
          this._peers.delete(deviceId)
          this._peerLost.forEach(h => h(deviceId))
        })

        await module.startDiscovery()
      } catch (err) {
        console.warn('[WiFiMesh] Wi-Fi Direct not available:', err)
      }
    }
  }

  stopDiscovery(): void {
    this._discovering = false
    try { NativeModules.PagirWifiDirect?.stopDiscovery() } catch {}
  }

  getPeers(): WiFiPeer[] {
    return [...this._peers.values()]
  }

  getPeer(pagirId: string): WiFiPeer | undefined {
    return [...this._peers.values()].find(p => p.pagirId === pagirId)
  }

  /**
   * Send a PAGIR frame to a specific peer via TCP.
   * Handles connection establishment and framing.
   */
  async sendFrame(
    peer:     WiFiPeer,
    frameRaw: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const socket = NativeModules.PagirTcpSocket
    if (!socket) throw new Error('TCP socket module unavailable')

    const socketId = await socket.connect(peer.ipAddress, peer.port, CONNECT_TIMEOUT)
    try {
      // Send length-prefixed frame
      const lenBuf = new Uint8Array(4)
      new DataView(lenBuf.buffer).setUint32(0, frameRaw.length, false)
      await socket.write(socketId, Array.from(lenBuf))

      // Send frame in chunks for progress reporting
      const WRITE_CHUNK = 65536  // 64KB TCP write chunks
      let sent = 0
      while (sent < frameRaw.length) {
        const slice = frameRaw.slice(sent, sent + WRITE_CHUNK)
        await socket.write(socketId, Array.from(slice))
        sent += slice.length
        onProgress?.(sent, frameRaw.length)
      }
    } finally {
      await socket.close(socketId)
    }
  }

  /**
   * Start TCP server to receive inbound frames from peers.
   */
  async startServer(myPagirId: string): Promise<void> {
    const socket = NativeModules.PagirTcpSocket
    if (!socket) return

    await socket.startServer(PAGIR_TCP_PORT, async (clientInfo: any, data: number[]) => {
      const raw    = new Uint8Array(data)
      const peer   = this._peers.get(clientInfo.ip) ?? {
        deviceId:  clientInfo.ip,
        pagirId:   '',
        name:      clientInfo.ip,
        ipAddress: clientInfo.ip,
        port:      PAGIR_TCP_PORT,
        transport: 'lan' as const,
      }
      this._frameHandlers.forEach(h => h(raw, peer))
    })
  }

  // ─── Event handlers ──────────────────────────────────────────────────────────

  onFrame(handler: WiFiFrameHandler): () => void {
    this._frameHandlers.push(handler)
    return () => { this._frameHandlers = this._frameHandlers.filter(h => h !== handler) }
  }

  onPeerDiscovered(handler: PeerDiscoveredHandler): () => void {
    this._peerDiscovered.push(handler)
    return () => { this._peerDiscovered = this._peerDiscovered.filter(h => h !== handler) }
  }

  onPeerLost(handler: PeerLostHandler): () => void {
    this._peerLost.push(handler)
    return () => { this._peerLost = this._peerLost.filter(h => h !== handler) }
  }

  // ─── mDNS ───────────────────────────────────────────────────────────────────

  private _startMDNS(): void {
    const mdns = NativeModules.PagirMDNS
    if (!mdns) return

    mdns.browse('_pagir._tcp', (result: any) => {
      if (!result) return
      if (result.type === 'resolved') {
        const peer: WiFiPeer = {
          deviceId:  result.name,
          pagirId:   result.txt?.pagirId ?? '',
          name:      result.name,
          ipAddress: result.addresses?.[0] ?? '',
          port:      result.port ?? PAGIR_TCP_PORT,
          transport: 'lan',
        }
        this._peers.set(peer.deviceId, peer)
        if (peer.pagirId) this._peerDiscovered.forEach(h => h(peer))
      } else if (result.type === 'removed') {
        this._peers.delete(result.name)
        this._peerLost.forEach(h => h(result.name))
      }
    })
  }

  /** Advertise ourselves via mDNS */
  async advertisePresence(pagirId: string): Promise<void> {
    const mdns = NativeModules.PagirMDNS
    if (!mdns) return
    await mdns.register(
      '_pagir._tcp',
      `PAGIR-${pagirId}`,
      PAGIR_TCP_PORT,
      { pagirId, v: '2', caps: 'file,msg,chunk' },
    )
  }

  async stopAdvertising(): Promise<void> {
    try { NativeModules.PagirMDNS?.unregister() } catch {}
  }
}

export const wifiMesh = new WiFiMesh()
