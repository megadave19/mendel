/**
 * AES-256-GCM encrypt/decrypt for GitHub PATs stored at rest.
 * Uses Node.js built-in crypto — no extra dependencies.
 *
 * Wire-format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 * - IV  : 12 bytes (96-bit, required for GCM)
 * - Tag : 16 bytes (128-bit auth tag)
 * - Key : first 32 bytes of ENCRYPTION_KEY (UTF-8), satisfying AES-256
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '@/lib/env'

const ALGORITHM = 'aes-256-gcm' as const
const IV_BYTES = 12
const TAG_BYTES = 16

/** Derive a 32-byte key from ENCRYPTION_KEY — validated >= 32 chars by env.ts */
function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'utf8').subarray(0, 32)
}

/**
 * Encrypt a plaintext string.
 * Returns a single colon-delimited hex string suitable for DB storage.
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

/**
 * Decrypt a value produced by encrypt().
 * Throws if the ciphertext is malformed or the auth tag fails (tamper detected).
 */
export function decrypt(ciphertext: string): string {
  const key = getKey()
  const parts = ciphertext.split(':')

  if (parts.length !== 3) {
    throw new Error('crypto: invalid ciphertext format — expected iv:tag:data')
  }

  const [ivHex, authTagHex, encryptedHex] = parts as [string, string, string]

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')

  if (iv.length !== IV_BYTES) throw new Error(`crypto: IV must be ${IV_BYTES} bytes`)
  if (authTag.length !== TAG_BYTES) throw new Error(`crypto: auth tag must be ${TAG_BYTES} bytes`)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
