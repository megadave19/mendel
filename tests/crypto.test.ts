import { describe, it, expect, beforeAll } from 'vitest'

// Set ENCRYPTION_KEY before importing lib/crypto (env.ts reads process.env at import time)
beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-key-32-chars-exactly-padded!'
  process.env.DATABASE_URL = 'file:./prisma/dev.db'
})

describe('encrypt / decrypt', () => {
  it('round-trips a short string', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto')
    const plain = 'ghp_testtoken1234567890'
    const ciphertext = encrypt(plain)
    expect(decrypt(ciphertext)).toBe(plain)
  })

  it('produces a different ciphertext each call (random IV)', async () => {
    const { encrypt } = await import('@/lib/crypto')
    const plain = 'same-plaintext'
    expect(encrypt(plain)).not.toBe(encrypt(plain))
  })

  it('ciphertext contains exactly 3 colon-separated hex segments', async () => {
    const { encrypt } = await import('@/lib/crypto')
    const parts = encrypt('hello').split(':')
    expect(parts).toHaveLength(3)
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/)
    }
  })

  it('throws on tampered ciphertext (auth tag failure)', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto')
    const [iv, tag, data] = encrypt('secret').split(':')
    // Flip first byte of auth tag
    const badTag = 'ff' + tag!.slice(2)
    expect(() => decrypt(`${iv}:${badTag}:${data}`)).toThrow()
  })

  it('throws on malformed ciphertext (wrong segment count)', async () => {
    const { decrypt } = await import('@/lib/crypto')
    expect(() => decrypt('notvalid')).toThrow('invalid ciphertext format')
  })
})
