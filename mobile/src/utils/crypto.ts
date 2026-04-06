/**
 * PAGIR 2 — Cryptographic utilities (mobile)
 *
 * All crypto ops use react-native-quick-crypto (native module backed by OpenSSL).
 * Falls back to Node.js `crypto` in test environments.
 *
 * Encryption scheme:
 *   File/message: AES-256-GCM with a per-transfer session key
 *   Session key:  RSA-OAEP (2048-bit) encrypted with recipient's public key
 */

let crypto: any
try {
  crypto = require('react-native-quick-crypto')
} catch {
  crypto = require('crypto')
}

export interface EncryptedPayload {
  ciphertext: string  // base64 AES-256-GCM ciphertext + 16-byte auth tag appended
  iv:         string  // base64 12-byte nonce
  encKey:     string  // base64 RSA-OAEP encrypted AES-256 session key
}

/**
 * Encrypt plaintext (string or Buffer) for a recipient.
 * Returns base64-encoded ciphertext, IV, and encrypted session key.
 */
export async function encrypt(
  plaintext: string | Buffer,
  recipientPublicKeyPem: string
): Promise<EncryptedPayload> {
  const aesKey = crypto.randomBytes(32)   // AES-256
  const iv     = crypto.randomBytes(12)   // GCM nonce

  const input = typeof plaintext === 'string'
    ? Buffer.from(plaintext, 'utf8')
    : plaintext

  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
  const enc    = Buffer.concat([cipher.update(input), cipher.final()])
  const tag    = cipher.getAuthTag()

  // Append auth tag to ciphertext — recipient splits off last 16 bytes
  const full   = Buffer.concat([enc, tag])

  const encKey = crypto.publicEncrypt(
    { key: recipientPublicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    aesKey
  )

  return {
    ciphertext: full.toString('base64'),
    iv:         iv.toString('base64'),
    encKey:     encKey.toString('base64'),
  }
}

/**
 * Decrypt an encrypted payload using the local private key.
 */
export async function decrypt(
  payload: EncryptedPayload,
  privateKeyPem: string
): Promise<Buffer> {
  const aesKey = crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(payload.encKey, 'base64')
  )

  const iv           = Buffer.from(payload.iv, 'base64')
  const full         = Buffer.from(payload.ciphertext, 'base64')
  const tag          = full.slice(-16)
  const ciphertext   = full.slice(0, -16)

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export async function decryptToString(
  payload: EncryptedPayload,
  privateKeyPem: string
): Promise<string> {
  const buf = await decrypt(payload, privateKeyPem)
  return buf.toString('utf8')
}

/**
 * Generate a fresh RSA-2048 key pair.
 * Returns PEM strings for both public and private keys.
 */
export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair(
      'rsa',
      {
        modulusLength: 2048,
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      },
      (err: Error | null, pub: string, priv: string) => {
        if (err) reject(err)
        else resolve({ publicKey: pub, privateKey: priv })
      }
    )
  })
}

/**
 * Derive a public key from a private key (PEM).
 * Used when public key is lost but private key is available.
 */
export function derivePublicKey(privateKeyPem: string): string {
  const keyObject = crypto.createPrivateKey(privateKeyPem)
  return crypto
    .createPublicKey(keyObject)
    .export({ type: 'spki', format: 'pem' }) as string
}

/**
 * Compute a fingerprint for a public key (first 16 bytes of SHA-256, hex).
 * Used for contact verification UI.
 */
export function publicKeyFingerprint(publicKeyPem: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(publicKeyPem)
    .digest('hex')
  return hash.slice(0, 16).toUpperCase().match(/.{4}/g)!.join(' ')
}
