import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'

const HEARTH_DIR        = path.join(os.homedir(), '.hearth')
const FALLBACK_KEY_FILE = path.join(HEARTH_DIR, '.master-key')
const SERVICE = 'hearth'
const ACCOUNT = 'master-key'

// 4-byte magic prefix that identifies an encrypted text file ('ENC\0')
const TEXT_MAGIC = Buffer.from([0x45, 0x4e, 0x43, 0x00])

let cachedKey: Buffer | null = null

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initSecureStorage() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const keytar = require('keytar') as typeof import('keytar')
    let b64 = await keytar.getPassword(SERVICE, ACCOUNT)
    if (!b64) {
      b64 = crypto.randomBytes(32).toString('base64')
      await keytar.setPassword(SERVICE, ACCOUNT, b64)
    }
    cachedKey = Buffer.from(b64, 'base64')
  } catch {
    // Fallback: key stored in file (protects against file-only leaks, not same-user processes)
    if (!fs.existsSync(HEARTH_DIR)) fs.mkdirSync(HEARTH_DIR, { recursive: true, mode: 0o700 })
    if (!fs.existsSync(FALLBACK_KEY_FILE))
      fs.writeFileSync(FALLBACK_KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 })
    cachedKey = Buffer.from(fs.readFileSync(FALLBACK_KEY_FILE, 'utf8').trim(), 'hex')
  }
}

// ─── JSON object encryption (credentials, tokens) ────────────────────────────
// Format: [iv 12][tag 16][ciphertext]
// Detection: encrypted files are binary; plaintext JSON always starts with '{' (0x7b)

export function writeEncrypted(filePath: string, data: object) {
  if (!cachedKey) throw new Error('Secure storage not initialized')
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cachedKey, iv)
  const ct     = Buffer.concat([cipher.update(JSON.stringify(data, null, 2), 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  const tmp    = filePath + '.tmp'
  const dir    = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(tmp, Buffer.concat([iv, tag, ct]), { mode: 0o600 })
  fs.renameSync(tmp, filePath)
}

export function readEncrypted<T>(filePath: string): T | null {
  if (!cachedKey) return null
  try {
    const buf = fs.readFileSync(filePath)
    if (buf[0] === 0x7b) {
      // Plaintext JSON — migrate in place
      const data = JSON.parse(buf.toString('utf8')) as T
      writeEncrypted(filePath, data as object)
      return data
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', cachedKey, buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()])
    return JSON.parse(plain.toString('utf8')) as T
  } catch { return null }
}

// ─── Text file encryption (memory.txt, user.txt) ─────────────────────────────
// Format: [TEXT_MAGIC 4][iv 12][tag 16][ciphertext]
// Detection: TEXT_MAGIC prefix (can't appear in valid UTF-8 text due to the null byte)

export function writeEncryptedText(filePath: string, content: string) {
  if (!cachedKey) throw new Error('Secure storage not initialized')
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cachedKey, iv)
  const ct     = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  const tmp    = filePath + '.tmp'
  const dir    = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(tmp, Buffer.concat([TEXT_MAGIC, iv, tag, ct]), { mode: 0o600 })
  fs.renameSync(tmp, filePath)
}

export function readEncryptedText(filePath: string): string {
  try {
    const buf = fs.readFileSync(filePath)
    if (buf.subarray(0, 4).equals(TEXT_MAGIC)) {
      if (!cachedKey) return ''  // encrypted but key not ready
      const decipher = crypto.createDecipheriv('aes-256-gcm', cachedKey, buf.subarray(4, 16))
      decipher.setAuthTag(buf.subarray(16, 32))
      const plain = Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()])
      return plain.toString('utf8')
    }
    // Plaintext text file — migrate in place if key is ready
    const content = buf.toString('utf8')
    if (cachedKey) writeEncryptedText(filePath, content)
    return content
  } catch { return '' }
}

// ─── Per-line encryption (events.jsonl) ──────────────────────────────────────
// Encrypted line format: 'ENC:' + base64(iv[12] + tag[16] + ciphertext)
// Plaintext lines (migration): raw JSON strings without the prefix

export function encryptLine(data: object): string {
  if (!cachedKey) return JSON.stringify(data)  // graceful degradation for event log
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cachedKey, iv)
  const ct     = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return 'ENC:' + Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptLine(line: string): object | null {
  try {
    if (!line.startsWith('ENC:')) return JSON.parse(line)  // plaintext migration
    if (!cachedKey) return null
    const buf     = Buffer.from(line.slice(4), 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', cachedKey, buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()])
    return JSON.parse(plain.toString('utf8'))
  } catch { return null }
}
