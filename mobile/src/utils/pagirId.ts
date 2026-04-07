/**
 * PAGIR 2 — PAGIR ID and bundle utilities (mobile)
 *
 * All ID generation and bundle encoding happens on-device.
 * Server only validates, never generates.
 */

const crypto: any = require('react-native-quick-crypto')

// 32-char unambiguous alphabet (no 0/O/1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Generate a new PAGIR ID: PAG-XXXX-XXXX-XXXX
 * Uses CSPRNG — not predictable, not sequential.
 */
export function generatePagirId(): string {
  const bytes = crypto.randomBytes(12)
  let id = 'PAG-'
  for (let g = 0; g < 3; g++) {
    for (let i = 0; i < 4; i++) {
      id += ALPHABET[bytes[g * 4 + i] % 31]
    }
    if (g < 2) id += '-'
  }
  return id
}

export function isValidPagirId(id: string): boolean {
  return /^PAG-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/.test(id)
}

// ─── pagir2:// bundle ─────────────────────────────────────────────────────────
// Bundle = base64url({ v: 2, id, pk })
// Share text = pagir2://<base64url>

export interface PagirBundle {
  v: 2
  id: string
  pk: string  // RSA-2048 public key PEM
}

export function encodePagirBundle(pagirId: string, publicKeyPem: string): string {
  const bundle: PagirBundle = { v: 2, id: pagirId, pk: publicKeyPem }
  return Buffer.from(JSON.stringify(bundle)).toString('base64url')
}

export function decodePagirBundle(encoded: string): { pagirId: string; publicKeyPem: string } | null {
  try {
    const clean = encoded
      .replace(/^pagir2:\/\//i, '')
      .replace(/^pagir:\/\//i, '')   // backwards compat with PAGIR 1
      .trim()
    const json = Buffer.from(clean, 'base64url').toString('utf8')
    const obj = JSON.parse(json) as Partial<PagirBundle>
    if (!obj.id || !obj.pk) return null
    if (!isValidPagirId(obj.id)) return null
    return { pagirId: obj.id, publicKeyPem: obj.pk }
  } catch {
    return null
  }
}

export function pagirBundleToShareText(encoded: string): string {
  return `pagir2://${encoded}`
}

export function extractBundleFromShareText(text: string): string | null {
  const match = text.match(/pagir2?:\/\/([A-Za-z0-9_-]+)/i)
  return match ? match[1] : null
}
