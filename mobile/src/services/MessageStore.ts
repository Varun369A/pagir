/**
 * PAGIR 2 — Message Store
 *
 * SQLite-backed local history of all transfers (sent + received).
 * Indexed by contactId for fast per-conversation queries.
 *
 * Schema:
 *   messages (id TEXT PK, contactId TEXT, direction TEXT, mimeType TEXT,
 *             fileName TEXT, fileSize INT, data TEXT, ts INT, read INT)
 */

import { open, type DB } from '@op-engineering/op-sqlite'


export interface Message {
  id:        string
  contactId: string
  direction: 'in' | 'out'
  mimeType:  string | null
  fileName:  string | null
  fileSize:  number | null
  data:      string   // base64 for binary, plain text for text
  ts:        number
  read:      boolean
}

class MessageStore {
  private db: DB | null = null

  async init(): Promise<void> {
    if (this.db) return
    this.db = open({ name: 'pagir2_messages.db', location: 'default' })
    await this.db.executeAsync(`
      CREATE TABLE IF NOT EXISTS messages (
        id        TEXT PRIMARY KEY,
        contactId TEXT NOT NULL,
        direction TEXT NOT NULL,
        mimeType  TEXT,
        fileName  TEXT,
        fileSize  INTEGER,
        data      TEXT NOT NULL,
        ts        INTEGER NOT NULL,
        read      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contactId, ts DESC);
    `)
  }

  private get _db(): DB {
    if (!this.db) throw new Error('MessageStore not initialized. Call init() first.')
    return this.db
  }

  async save(msg: Omit<Message, 'read'>): Promise<void> {
    await this._db.executeAsync(
      `INSERT OR REPLACE INTO messages (id, contactId, direction, mimeType, fileName, fileSize, data, ts, read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [msg.id, msg.contactId, msg.direction, msg.mimeType ?? null, msg.fileName ?? null, msg.fileSize ?? null, msg.data, msg.ts]
    )
  }

  async getByContact(contactId: string, limit = 50, before?: number): Promise<Message[]> {
    const rows = before
      ? await this._db.executeAsync(
          `SELECT * FROM messages WHERE contactId = ? AND ts < ? ORDER BY ts DESC LIMIT ?`,
          [contactId, before, limit]
        )
      : await this._db.executeAsync(
          `SELECT * FROM messages WHERE contactId = ? ORDER BY ts DESC LIMIT ?`,
          [contactId, limit]
        )
    return (rows.rows?._array ?? []).map(toMessage)
  }

  async markRead(contactId: string): Promise<void> {
    await this._db.executeAsync(
      `UPDATE messages SET read = 1 WHERE contactId = ? AND read = 0`,
      [contactId]
    )
  }

  async unreadCount(contactId: string): Promise<number> {
    const rows = await this._db.executeAsync(
      `SELECT COUNT(*) as cnt FROM messages WHERE contactId = ? AND read = 0 AND direction = 'in'`,
      [contactId]
    )
    return (rows.rows?._array?.[0]?.cnt as number) ?? 0
  }

  async delete(id: string): Promise<void> {
    await this._db.executeAsync(`DELETE FROM messages WHERE id = ?`, [id])
  }

  async deleteByContact(contactId: string): Promise<void> {
    await this._db.executeAsync(`DELETE FROM messages WHERE contactId = ?`, [contactId])
  }

  async deleteAll(): Promise<void> {
    await this._db.executeAsync(`DELETE FROM messages`)
  }
}

function toMessage(row: any): Message {
  return {
    id:        row.id,
    contactId: row.contactId,
    direction: row.direction as 'in' | 'out',
    mimeType:  row.mimeType ?? null,
    fileName:  row.fileName ?? null,
    fileSize:  row.fileSize ?? null,
    data:      row.data,
    ts:        row.ts,
    read:      row.read === 1,
  }
}

export const messageStore = new MessageStore()
