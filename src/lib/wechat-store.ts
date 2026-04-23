import fs from 'fs'
import path from 'path'
import os from 'os'
import { encryptLine, decryptLine } from './secure-storage'

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'wechat-messages.jsonl')
const MAX_LINES     = 2000

export interface WechatMessage {
  from:      string
  room:      string | null
  text:      string
  timestamp: string
}

export function appendWechatMessage(msg: WechatMessage) {
  try {
    if (!fs.existsSync(HEARTH_DIR)) fs.mkdirSync(HEARTH_DIR, { recursive: true, mode: 0o700 })
    fs.appendFileSync(MESSAGES_FILE, encryptLine(msg) + '\n', { mode: 0o600, encoding: 'utf8' })
    trimMessages()
  } catch { /* non-critical */ }
}

function trimMessages() {
  try {
    const lines = fs.readFileSync(MESSAGES_FILE, 'utf8').split('\n').filter(Boolean)
    if (lines.length > MAX_LINES)
      fs.writeFileSync(MESSAGES_FILE, lines.slice(-MAX_LINES).join('\n') + '\n', { mode: 0o600 })
  } catch {}
}

export function queryMessages(opts: { contact?: string; days?: number; limit?: number }): WechatMessage[] {
  const { contact, days = 7, limit = 50 } = opts
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  try {
    const lines = fs.readFileSync(MESSAGES_FILE, 'utf8').split('\n').filter(Boolean)
    return lines
      .map(l => { try { return decryptLine(l) as WechatMessage } catch { return null } })
      .filter((m): m is WechatMessage => m !== null && m.timestamp >= cutoff)
      .filter(m => !contact || m.from.toLowerCase().includes(contact.toLowerCase()))
      .slice(-limit)
      .reverse()
  } catch { return [] }
}
