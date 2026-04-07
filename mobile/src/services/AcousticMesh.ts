/**
 * TARANG-OLI (தரங்க்-ஒலி) — Acoustic Mesh Transport
 *
 * OLI = ஒலி = Sound (Tamil)
 * TARANG = तरंग = Wave (Sanskrit)
 *
 * Inspired by blue whale communication:
 *   - Blue whale: 188 dB, 800km range via ocean SOFAR channel
 *   - TARANG-OLI: phone speaker, FSK encoded, hop-by-hop mesh
 *
 * Protocol (FSK — Frequency Shift Keying):
 *   Preamble:    17,000 Hz × 3 pulses  (sync marker)
 *   Bit 0:       18,000 Hz × 23ms
 *   Bit 1:       19,000 Hz × 23ms
 *   Postamble:   17,500 Hz × 46ms
 *   Data rate:   ~43 bits/sec = ~5 bytes/sec
 *
 * Range (open air):
 *   Phone speaker only:      50 – 500m
 *   External speaker (₹200): 1 – 5km
 *   100 users × 5km:         500km (Coimbatore → Chennai)
 *
 * Used by MeshRouter as transport layer 5.
 * Falls back automatically when BLE and WiFi are unavailable.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native'

const { OliModule } = NativeModules

export type AcousticFrameHandler = (data: Uint8Array) => void

class AcousticMesh {
  private _handlers:  AcousticFrameHandler[] = []
  private _listening  = false
  private _emitter:   NativeEventEmitter | null = null
  private _sub:       any = null

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async startListening(): Promise<void> {
    if (this._listening || !OliModule) return
    this._listening = true

    this._emitter = new NativeEventEmitter(OliModule)
    this._sub = this._emitter.addListener('OliFrame', (b64: string) => {
      try {
        const bytes = Buffer.from(b64, 'base64')
        const u8    = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        this._handlers.forEach(h => h(u8))
      } catch { /* malformed — skip */ }
    })

    await OliModule.startListening()
    console.log('[TARANG-OLI ஒலி] Listening started')
  }

  async stopListening(): Promise<void> {
    if (!this._listening) return
    this._listening = false
    this._sub?.remove()
    this._sub = null
    if (OliModule) await OliModule.stopListening()
  }

  // ─── Transmit ─────────────────────────────────────────────────────────────

  /**
   * Broadcast a PAGIR frame via acoustic FSK.
   * Frame is encoded in 18-19 kHz range (inaudible to most humans).
   */
  async broadcast(frame: Uint8Array): Promise<void> {
    if (!OliModule) return
    const b64 = Buffer.from(frame).toString('base64')
    await OliModule.transmit(b64)
  }

  // ─── Handler registration ────────────────────────────────────────────────

  onFrame(handler: AcousticFrameHandler): () => void {
    this._handlers.push(handler)
    return () => { this._handlers = this._handlers.filter(h => h !== handler) }
  }

  isAvailable(): boolean {
    return Platform.OS === 'android' && !!OliModule
  }

  isListening(): boolean { return this._listening }
}

export const acousticMesh = new AcousticMesh()

/**
 * TARANG-OLI Protocol Specification
 *
 * Named after the blue whale discovery:
 * Blue whales communicate 800km via the ocean SOFAR channel.
 * TARANG-OLI does the same via phone speakers and human mesh.
 *
 * Key insight:
 *   100 PAGIR users × 5km acoustic range = 500km coverage
 *   No towers. No internet. No server. No infrastructure.
 *   The users ARE the network.
 *
 * Protocol identity:
 *   Name:       TARANG-OLI
 *   Tamil:      தரங்க்-ஒலி
 *   Meaning:    Wave-Sound
 *   Version:    1.0.0
 *   Origin:     Coimbatore, Tamil Nadu, India
 *   Inspired by: Balaenoptera musculus (Blue Whale)
 */
export const OLI_PROTOCOL_META = {
  name:       'TARANG-OLI',
  tamil:      'தரங்க்-ஒலி',
  meaning:    'Wave-Sound',
  version:    '1.0.0',
  origin:     'Coimbatore, Tamil Nadu, India',
  inspiredBy: 'Blue Whale SOFAR channel communication',
  rangeM:     { phoneOnly: 500, externalSpeaker: 5000 },
  usersFor500km: 100,
  frequencies: { sync: 17000, zero: 18000, one: 19000, post: 17500 },
  dataRateBps: 43,
} as const
