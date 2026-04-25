import { describe, it, expect } from 'vitest'
import './setup.js'
import { encryptSecret, decryptSecret, isEncrypted } from '../lib/crypto.js'

describe('crypto', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const plain = 'ghp_super_secret_token_value_xyz'
    const cipher = encryptSecret(plain)
    expect(cipher).not.toBe(plain)
    expect(isEncrypted(cipher)).toBe(true)
    expect(decryptSecret(cipher)).toBe(plain)
  })

  it('treats unprefixed legacy values as plaintext', () => {
    const legacy = 'plain-token-from-before-encryption'
    expect(isEncrypted(legacy)).toBe(false)
    expect(decryptSecret(legacy)).toBe(legacy)
  })

  it('produces a different ciphertext each call (random IV)', () => {
    const plain = 'same-secret'
    const a = encryptSecret(plain)
    const b = encryptSecret(plain)
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe(plain)
    expect(decryptSecret(b)).toBe(plain)
  })

  it('throws on tampered ciphertext', () => {
    const cipher = encryptSecret('value')
    const parts = cipher.split('.')
    parts[3] = parts[3].slice(0, -2) + 'AA'
    expect(() => decryptSecret(parts.join('.'))).toThrow()
  })
})
