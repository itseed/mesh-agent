import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../env.js'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const VERSION = 'v1'

function getKey(): Buffer {
  return createHash('sha256').update(env.TOKEN_ENCRYPTION_KEY).digest()
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

export function decryptSecret(payload: string): string {
  if (!payload.startsWith(`${VERSION}.`)) {
    return payload
  }
  const [, ivB64, tagB64, encB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !encB64) {
    throw new Error('Malformed encrypted payload')
  }
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()])
  return dec.toString('utf8')
}

export function isEncrypted(payload: string | null | undefined): boolean {
  return !!payload && payload.startsWith(`${VERSION}.`)
}
