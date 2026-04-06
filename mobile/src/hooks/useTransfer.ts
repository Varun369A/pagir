/**
 * PAGIR 2 — useTransfer hook
 *
 * Subscribes to inbound transfers from TransferEngine.
 * Returns the latest received transfer and a send helper.
 */

import { useCallback, useEffect, useState } from 'react'
import { transferEngine, type InboundTransfer, type TransferMeta } from '../services/TransferEngine'

interface Result {
  lastTransfer: InboundTransfer | null
  send: (recipientId: string, data: Uint8Array | string, meta: TransferMeta, privateKey: string) => Promise<void>
  sending: boolean
  sendError: string | null
}

export function useTransfer(): Result {
  const [lastTransfer, setLastTransfer] = useState<InboundTransfer | null>(null)
  const [sending, setSending]           = useState(false)
  const [sendError, setSendError]       = useState<string | null>(null)

  useEffect(() => {
    const unsub = transferEngine.onTransfer(t => setLastTransfer(t))
    return unsub
  }, [])

  const send = useCallback(async (
    recipientId: string,
    data: Uint8Array | string,
    meta: TransferMeta,
    privateKey: string,
  ) => {
    setSending(true)
    setSendError(null)
    try {
      await transferEngine.send(recipientId, data, meta, privateKey)
    } catch (err: any) {
      setSendError(err?.message ?? 'Transfer failed')
      throw err
    } finally {
      setSending(false)
    }
  }, [])

  return { lastTransfer, send, sending, sendError }
}
