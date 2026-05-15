import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

const MAGIC = 'ENCV1:'
const KEY_FILE = '.key'

export function loadOrCreateKey(configDir: string): Buffer {
  const keyPath = join(configDir, KEY_FILE)
  if (existsSync(keyPath)) {
    return Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'hex')
  }

  if (!existsSync(configDir)) {
    mkdirSync(configDir, {recursive: true})
  }

  const key = randomBytes(32)
  writeFileSync(keyPath, key.toString('hex'), {encoding: 'utf8', mode: 0o600})
  return key
}

export function encryptString(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return MAGIC + Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

// Returns the plaintext. Files not prefixed with ENCV1: are returned as-is for
// backward-compat with pre-encryption plain JSON files — they will be
// re-encrypted on the next write.
export function decryptString(data: string, key: Buffer): string {
  if (!data.startsWith(MAGIC)) return data

  const buf = Buffer.from(data.slice(MAGIC.length), 'base64')
  const iv = buf.subarray(0, 12)
  const authTag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
