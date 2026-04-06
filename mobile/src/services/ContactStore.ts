/**
 * PAGIR 2 — ContactStore
 *
 * SQLite-backed local contact list. No server sync — contacts are
 * purely local (zero-knowledge — server doesn't know your friend graph).
 *
 * Schema:
 *   contacts(pagirId TEXT PK, displayName TEXT, publicKeyPem TEXT,
 *            nickname TEXT, blockedAt INT, addedAt INT, lastSeen INT)
 */

import { open, type DB } from '@op-engineering/op-sqlite'

export interface Contact {
  pagirId:     string
  displayName: string   // From server directory (their chosen name)
  publicKeyPem: string  // RSA-2048 public key — used for encryption
  nickname:    string   // Your custom name for this contact (local only)
  blockedAt:   number | null
  addedAt:     number
  lastSeen:    number | null
}

class ContactStore {
  private db: DB | null = null

  init(): void {
    if (this.db) return
    this.db = open({ name: 'pagir2.db' })
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS contacts (
        pagir_id      TEXT PRIMARY KEY,
        display_name  TEXT NOT NULL,
        public_key    TEXT NOT NULL,
        nickname      TEXT NOT NULL DEFAULT '',
        blocked_at    INTEGER,
        added_at      INTEGER NOT NULL,
        last_seen     INTEGER
      )
    `)
    this.db.execute('CREATE INDEX IF NOT EXISTS idx_contacts_blocked ON contacts(blocked_at)')
  }

  private get _db(): DB {
    if (!this.db) this.init()
    return this.db!
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  getAll(): Contact[] {
    const rows = this._db.execute(
      'SELECT * FROM contacts WHERE blocked_at IS NULL ORDER BY nickname ASC, display_name ASC'
    )
    return (rows.rows?._array ?? []).map(_rowToContact)
  }

  getBlocked(): Contact[] {
    const rows = this._db.execute(
      'SELECT * FROM contacts WHERE blocked_at IS NOT NULL'
    )
    return (rows.rows?._array ?? []).map(_rowToContact)
  }

  get(pagirId: string): Contact | null {
    const rows = this._db.execute(
      'SELECT * FROM contacts WHERE pagir_id = ?',
      [pagirId]
    )
    const arr = rows.rows?._array ?? []
    return arr.length > 0 ? _rowToContact(arr[0]) : null
  }

  search(query: string): Contact[] {
    const q = `%${query.toLowerCase()}%`
    const rows = this._db.execute(
      `SELECT * FROM contacts
       WHERE blocked_at IS NULL
         AND (lower(nickname) LIKE ? OR lower(display_name) LIKE ? OR pagir_id LIKE ?)
       ORDER BY nickname ASC, display_name ASC`,
      [q, q, q]
    )
    return (rows.rows?._array ?? []).map(_rowToContact)
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  add(contact: Omit<Contact, 'addedAt' | 'lastSeen' | 'blockedAt'>): void {
    this._db.execute(
      `INSERT OR IGNORE INTO contacts
       (pagir_id, display_name, public_key, nickname, added_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        contact.pagirId,
        contact.displayName,
        contact.publicKeyPem,
        contact.nickname || contact.displayName,
        Date.now(),
      ]
    )
  }

  updateNickname(pagirId: string, nickname: string): void {
    this._db.execute(
      'UPDATE contacts SET nickname = ? WHERE pagir_id = ?',
      [nickname, pagirId]
    )
  }

  updatePublicKey(pagirId: string, publicKeyPem: string): void {
    this._db.execute(
      'UPDATE contacts SET public_key = ? WHERE pagir_id = ?',
      [publicKeyPem, pagirId]
    )
  }

  updateLastSeen(pagirId: string): void {
    this._db.execute(
      'UPDATE contacts SET last_seen = ? WHERE pagir_id = ?',
      [Date.now(), pagirId]
    )
  }

  block(pagirId: string): void {
    this._db.execute(
      'UPDATE contacts SET blocked_at = ? WHERE pagir_id = ?',
      [Date.now(), pagirId]
    )
  }

  unblock(pagirId: string): void {
    this._db.execute(
      'UPDATE contacts SET blocked_at = NULL WHERE pagir_id = ?',
      [pagirId]
    )
  }

  remove(pagirId: string): void {
    this._db.execute('DELETE FROM contacts WHERE pagir_id = ?', [pagirId])
  }

  removeAll(): void {
    this._db.execute('DELETE FROM contacts')
  }
}

function _rowToContact(row: Record<string, unknown>): Contact {
  return {
    pagirId:     row.pagir_id as string,
    displayName: row.display_name as string,
    publicKeyPem: row.public_key as string,
    nickname:    (row.nickname as string) || (row.display_name as string),
    blockedAt:   row.blocked_at as number | null,
    addedAt:     row.added_at as number,
    lastSeen:    row.last_seen as number | null,
  }
}

export const contactStore = new ContactStore()
