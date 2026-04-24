import fs from 'fs'
import path from 'path'
import os from 'os'
import { encryptLine, decryptLine } from '../secure-storage'
import type { BasePlatformAdapter, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const SESSION_DIR   = path.join(HEARTH_DIR, 'whatsapp-session')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'whatsapp-messages.jsonl')
const MAX_LINES     = 2000

interface RawMsg { from: string; room: string | null; text: string; timestamp: string }

interface WhatsAppSingleton {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client:   any
  status:   'stopped' | 'scanning' | 'connecting' | 'connected' | 'error'
  qrImage:  string | null
  identity: string | null
  error:    string | null
}

export class WhatsAppAdapter implements BasePlatformAdapter {
  readonly name: PlatformName = 'whatsapp'
  private _g: WhatsAppSingleton | undefined = undefined

  getState(): PlatformState {
    const g = this._g
    return {
      platform: 'whatsapp',
      status:   g?.status   ?? 'stopped',
      qrImage:  g?.qrImage  ?? null,
      identity: g?.identity ?? null,
      meta:     { hasSession: fs.existsSync(SESSION_DIR) },
      error:    g?.error    ?? null,
    }
  }

  async connect(): Promise<void> {
    if (this._g) {
      if (this._g.status !== 'error') return
      await this.disconnect()
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client, LocalAuth } = require('whatsapp-web.js') as typeof import('whatsapp-web.js')

    const g: WhatsAppSingleton = { client: null, status: 'connecting', qrImage: null, identity: null, error: null }
    this._g = g

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: HEARTH_DIR, clientId: 'hearth' }),
      puppeteer:    { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    })
    g.client = client

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('qr', (qr: any) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const qrcode = require('qrcode') as typeof import('qrcode')
      qrcode.toDataURL(qr, { errorCorrectionLevel: 'L' }, (err: Error | null | undefined, url: string) => {
        if (!err) { g.qrImage = url; g.status = 'scanning' }
      })
    })

    client.on('ready', async () => {
      try {
        const info = await client.getContactById(client.info.wid._serialized)
        g.identity = info.pushname ?? info.name ?? client.info.pushname ?? 'WhatsApp'
      } catch {
        g.identity = client.info?.pushname ?? 'WhatsApp'
      }
      g.status  = 'connected'
      g.qrImage = null
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('message', (msg: any) => {
      try {
        if (!msg.body) return
        const contact = msg._data?.notifyName ?? msg.from ?? 'unknown'
        const room    = msg.isGroupMsg ? (msg._data?.notifyName ?? null) : null
        this._append({ from: contact, room, text: msg.body, timestamp: new Date().toISOString() })
      } catch { /* non-critical */ }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('auth_failure', (err: any) => {
      g.status = 'error'
      g.error  = err?.message ?? 'Authentication failed'
    })

    client.on('disconnected', () => {
      if (g.status === 'connected') { g.status = 'stopped' }
    })

    client.initialize().catch((err: Error) => {
      g.status = 'error'
      g.error  = err.message
    })
  }

  async disconnect(): Promise<void> {
    if (!this._g) return
    try { await this._g.client?.destroy() } catch {}
    this._g = undefined
  }

  async send(target: string, text: string): Promise<string> {
    if (!this._g || this._g.status !== 'connected') return 'Error: WhatsApp is not connected.'
    try {
      const chatId = target.includes('@') ? target : `${target}@c.us`
      await this._g.client.sendMessage(chatId, text)
      return `Message sent to ${target}.`
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : 'send failed'}`
    }
  }

  queryMessages(opts: QueryOptions = {}): PlatformMessage[] {
    const { contact, days = 7, limit = 50 } = opts
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    try {
      const lines = fs.readFileSync(MESSAGES_FILE, 'utf8').split('\n').filter(Boolean)
      return lines
        .map(l => { try { return decryptLine(l) as RawMsg } catch { return null } })
        .filter((m): m is RawMsg => m !== null && m.timestamp >= cutoff)
        .filter(m => !contact || m.from.toLowerCase().includes(contact.toLowerCase()))
        .slice(-limit)
        .reverse()
        .map(m => ({ platform: 'whatsapp' as const, from: m.from, room: m.room, text: m.text, timestamp: m.timestamp }))
    } catch { return [] }
  }

  async tryAutoConnect(): Promise<void> {
    if (fs.existsSync(SESSION_DIR)) await this.connect().catch(() => {})
  }

  private _append(msg: RawMsg): void {
    try {
      if (!fs.existsSync(HEARTH_DIR)) fs.mkdirSync(HEARTH_DIR, { recursive: true, mode: 0o700 })
      fs.appendFileSync(MESSAGES_FILE, encryptLine(msg) + '\n', { mode: 0o600, encoding: 'utf8' })
      this._trim()
    } catch { /* non-critical */ }
  }

  private _trim(): void {
    try {
      const lines = fs.readFileSync(MESSAGES_FILE, 'utf8').split('\n').filter(Boolean)
      if (lines.length > MAX_LINES)
        fs.writeFileSync(MESSAGES_FILE, lines.slice(-MAX_LINES).join('\n') + '\n', { mode: 0o600 })
    } catch {}
  }
}
