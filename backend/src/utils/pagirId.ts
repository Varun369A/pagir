/**
 * PAGIR 2 — Server-side PAGIR ID utilities
 *
 * Server only validates IDs — it never generates them.
 * The device always generates the ID to ensure zero-knowledge.
 */

// Unambiguous alphabet (no 0/O/1/I/L — visually distinct on screen)
const PAGIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

// PAG-XXXX-XXXX-XXXX
export const PAGIR_ID_REGEX = /^PAG-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/

/**
 * Server-side validation: is this a structurally valid PAGIR ID?
 * The regex is slightly permissive (allows some excluded chars) because
 * the device enforces the exact alphabet; server just needs a sanity check.
 */
export function isValidPagirId(id: string): boolean {
  return /^PAG-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(id)
}

export { PAGIR_ALPHABET }
