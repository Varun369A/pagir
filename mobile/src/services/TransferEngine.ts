/**
 * PAGIR 2 — Transfer Engine
 *
 * Handles P2P file/message transfer:
 *   - Online relay: WebSocket via PAGIR server
 *   - Offline fallback: local Wi-Fi/Bluetooth discovery (future)
 *
 * Encryption flow:
 *   1. Sender generates random AES-256-GCM session key
 *   2. Session key encrypted with recipient's RSA-2048 public key (OAEP-SHA256)
 *   3. Payload encrypted with AES-256-GCM (random IV)
 *   4. Bundle { encryptedKey, iv, ciphertext, meta } sent to relay
 *
 * Message format (relay payload):
 *   { v: 2, senderId, recipientId, encryptedKey, iv, ciphertext, fileName?, fileSize?, mimeType? }
 */

import { encrypt } from '../utils/crypto'
import { contactStore } from './ContactStore'

export interface TransferMeta {
  fileName?: string
  fileSize?: number
  mimeType?: string
  isText?: boolean
}

export interface OutboundTransfer {
  recipientId: string
  data: Uint8Array | string  // file bytes or plain text
  meta: TransferMeta
}

export interface InboundTransfer {
  senderId:   string
  senderName: string
  data: Uint8Array | string
  meta:   TransferMeta
  ts:     number
}

type TransferListener = (transfer: InboundTransfer) => void

class TransferEngine {
  private listeners: TransferListener[] = []
  private ws: WebSocket | null = null

  // ─── Send ──────────────────────────────────────────────────────────────────

  async send(
    recipientId: string,
    data: Uint8Array | string,
    meta: TransferMeta,
    senderPrivateKey: string,
  ): Promise<void> {
    const contact = await contactStore.get(recipientId)
    if (!contact) throw new Error('Contact not found.')
    if (!contact.publicKey) throw new Error('No public key on file for this contact.')

    const bytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data

    const { encryptedKey, iv, ciphertext } = await encrypt(bytes, contact.publicKey)

    const payload = JSON.stringify({
      v: 2,
      recipientId,
      encryptedKey,
      iv,
      ciphertext: Buffer.from(ciphertext).toString('base64'),
      ...meta,
    })

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload)
    } else {
      throw new Error('Not connected to relay. Ensure you have internet and try again.')
    }
  }

  // ─── WebSocket relay ───────────────────────────────────────────────────────

  connect(relayUrl: string, accessToken: string) {
    if (this.ws) this.disconnect()

    this.ws = new WebSocket(`${relayUrl}?token=${accessToken}`)

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'transfer') {
          await this._handleInbound(msg)
        }
      } catch { /* ignore malformed frames */ }
    }

    this.ws.onerror = () => { /* silent — UI layer handles reconnect */ }
    this.ws.onclose = () => { this.ws = null }
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
  }

  onTransfer(listener: TransferListener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  private async _handleInbound(msg: any) {
    const contact = await contactStore.get(msg.senderId)
    const inbound: InboundTransfer = {
      senderId:   msg.senderId,
      senderName: contact?.displayName ?? msg.senderId,
      data:       msg.ciphertext,   // caller is responsible for decryption
      meta: {
        fileName: msg.fileName,
        fileSize: msg.fileSize,
        mimeType: msg.mimeType,
        isText:   msg.isText,
      },
      ts: Date.now(),
    }
    this.listeners.forEach(l => l(inbound))
  }
}

export const transferEngine = new TransferEngine()
