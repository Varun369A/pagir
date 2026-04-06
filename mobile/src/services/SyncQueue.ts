/**
 * PAGIR 2 — Sync Queue
 *
 * Persists outbound transfer intents when offline.
 * On reconnect, replays the queue in order.
 *
 * Queue items are stored in AsyncStorage under `pagir2:sync_queue`.
 * Each item is a JSON blob with { id, recipientId, data (base64), meta, ts, attempts }.
 *
 * Max 50 pending items — oldest dropped when full.
 * Max 5 retry attempts per item — failed items are discarded.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const QUEUE_KEY   = 'pagir2:sync_queue'
const MAX_ITEMS   = 50
const MAX_RETRIES = 5

export interface QueueItem {
  id:          string
  recipientId: string
  data:        string    // base64-encoded encrypted payload
  meta:        Record<string, unknown>
  ts:          number
  attempts:    number
}

class SyncQueue {
  private _cache: QueueItem[] | null = null

  async load(): Promise<QueueItem[]> {
    if (this._cache) return this._cache
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY)
      this._cache = raw ? JSON.parse(raw) : []
    } catch {
      this._cache = []
    }
    return this._cache!
  }

  async push(item: Omit<QueueItem, 'ts' | 'attempts'>): Promise<void> {
    const queue = await this.load()
    if (queue.length >= MAX_ITEMS) queue.shift()   // drop oldest
    queue.push({ ...item, ts: Date.now(), attempts: 0 })
    await this._save(queue)
  }

  async pop(): Promise<QueueItem | null> {
    const queue = await this.load()
    if (queue.length === 0) return null
    const item = queue.shift()!
    await this._save(queue)
    return item
  }

  async peek(): Promise<QueueItem | null> {
    const queue = await this.load()
    return queue[0] ?? null
  }

  async ack(id: string): Promise<void> {
    const queue = await this.load()
    const next  = queue.filter(i => i.id !== id)
    await this._save(next)
  }

  async nack(id: string): Promise<void> {
    const queue = await this.load()
    const idx   = queue.findIndex(i => i.id === id)
    if (idx === -1) return
    queue[idx].attempts += 1
    if (queue[idx].attempts >= MAX_RETRIES) {
      queue.splice(idx, 1)   // discard after too many failures
    }
    await this._save(queue)
  }

  async size(): Promise<number> {
    return (await this.load()).length
  }

  async clear(): Promise<void> {
    this._cache = []
    await AsyncStorage.removeItem(QUEUE_KEY).catch(() => {})
  }

  private async _save(queue: QueueItem[]): Promise<void> {
    this._cache = queue
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => {})
  }
}

export const syncQueue = new SyncQueue()
