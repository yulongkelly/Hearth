import fs from 'fs'
import { encryptLine } from '../secure-storage'
import type { AttachmentInfo } from '../platform-adapter'

// ─── Re-export so adapters only need one import source ────────────────────────
export type { AttachmentInfo }

// ─── 1. Deduplication ─────────────────────────────────────────────────────────

export class MessageDeduplicator {
  private readonly _ttlMs:   number
  private readonly _maxSize: number
  private readonly _seen = new Map<string, number>()  // id → expiry timestamp ms

  constructor(ttlSeconds = 300, maxSize = 1000) {
    this._ttlMs   = ttlSeconds * 1000
    this._maxSize = maxSize
  }

  /** Returns true if `id` is a duplicate (already seen within TTL). */
  has(id: string): boolean {
    const now    = Date.now()
    const expiry = this._seen.get(id)
    if (expiry !== undefined) {
      if (expiry > now) return true
      this._seen.delete(id)
    }
    if (this._seen.size >= this._maxSize) {
      const first = this._seen.keys().next().value
      if (first !== undefined) this._seen.delete(first)
    }
    this._seen.set(id, now + this._ttlMs)
    return false
  }
}

// ─── 2. Message chunking ──────────────────────────────────────────────────────

export const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  email: Infinity,
}

export function splitText(text: string, limit: number): string[] {
  if (!isFinite(limit) || text.length <= limit) return [text]
  const chunks: string[] = []
  let offset = 0
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + limit))
    offset += limit
  }
  return chunks
}

// ─── 3. Attachment metadata ───────────────────────────────────────────────────

export function formatAttachments(attachments: AttachmentInfo[]): string {
  return attachments.map(a => {
    switch (a.type) {
      case 'image':   return '[image]'
      case 'sticker': return '[sticker]'
      case 'voice':   return a.duration != null ? `[voice: ${a.duration}s]` : '[voice]'
      case 'video':   return a.duration != null ? `[video: ${a.duration}s]` : '[video]'
      case 'file':    return a.name ? `[file: ${a.name}]` : '[file]'
      default:        return '[attachment]'
    }
  }).join(' ')
}

// ─── 4. Shared appender factory ───────────────────────────────────────────────

const MAX_LINES = 2000

export function createAppender(hearthDir: string, messagesFile: string) {
  return function append(msg: object): void {
    try {
      if (!fs.existsSync(hearthDir)) fs.mkdirSync(hearthDir, { recursive: true, mode: 0o700 })
      fs.appendFileSync(messagesFile, encryptLine(msg) + '\n', { mode: 0o600, encoding: 'utf8' })
      const lines = fs.readFileSync(messagesFile, 'utf8').split('\n').filter(Boolean)
      if (lines.length > MAX_LINES)
        fs.writeFileSync(messagesFile, lines.slice(-MAX_LINES).join('\n') + '\n', { mode: 0o600 })
    } catch { /* non-critical */ }
  }
}
