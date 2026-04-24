import fs from 'fs'
import path from 'path'
import os from 'os'
import { encryptLine, decryptLine, writeEncrypted, readEncrypted } from '../secure-storage'
import type { BasePlatformAdapter, ConnectOptions, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const CONFIG_FILE   = path.join(HEARTH_DIR, 'telegram-config.json')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'telegram-messages.jsonl')
const MAX_LINES     = 2000

interface TelegramConfig { token: string }
interface RawMsg { from: string; chatId: number; chatTitle: string | null; text: string; timestamp: string }

interface TelegramSingleton {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot:     any
  status:  'stopped' | 'connecting' | 'connected' | 'error'
  botName: string | null
  error:   string | null
}

export class TelegramAdapter implements BasePlatformAdapter {
  readonly name: PlatformName = 'telegram'
  private _g: TelegramSingleton | undefined = undefined

  getState(): PlatformState {
    const g = this._g
    return {
      platform: 'telegram',
      status:   g?.status  ?? 'stopped',
      qrImage:  null,
      identity: g?.botName ? `@${g.botName}` : null,
      meta:     { hasToken: !!this._loadToken() },
      error:    g?.error   ?? null,
    }
  }

  private _loadToken(): string | null {
    return readEncrypted<TelegramConfig>(CONFIG_FILE)?.token ?? null
  }

  async connect(opts?: ConnectOptions): Promise<void> {
    if (this._g) {
      if (this._g.status !== 'error') return
      await this.disconnect()
    }

    const t = opts?.token ?? this._loadToken()
    if (!t) throw new Error('No Telegram bot token provided')
    if (opts?.token) writeEncrypted(CONFIG_FILE, { token: opts.token })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Telegraf } = require('telegraf') as typeof import('telegraf')

    const g: TelegramSingleton = { bot: null, status: 'connecting', botName: null, error: null }

    try {
      const bot = new Telegraf(t)
      const me = await bot.telegram.getMe()
      g.bot     = bot
      g.status  = 'connected'
      g.botName = me.username ?? me.first_name

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bot.on('message', (ctx: any) => {
        try {
          const msg = ctx.message
          if (!msg?.text) return
          this._append({ from: msg.from?.username ?? msg.from?.first_name ?? 'unknown', chatId: msg.chat.id, chatTitle: msg.chat.title ?? null, text: msg.text, timestamp: new Date().toISOString() })
        } catch { /* non-critical */ }
      })

      this._g = g
      bot.launch().catch((err: Error) => { g.status = 'error'; g.error = err.message })
    } catch (err) {
      g.status = 'error'
      g.error  = err instanceof Error ? err.message : 'Invalid token or network error'
      this._g = g
    }
  }

  async disconnect(): Promise<void> {
    if (!this._g) return
    try { this._g.bot?.stop() } catch {}
    this._g = undefined
  }

  async send(chatIdOrUsername: string, text: string): Promise<string> {
    if (!this._g || this._g.status !== 'connected') return 'Error: Telegram bot is not connected.'
    try {
      const target = /^\d+$/.test(chatIdOrUsername) ? parseInt(chatIdOrUsername) : chatIdOrUsername
      await this._g.bot.telegram.sendMessage(target, text)
      return `Message sent to ${chatIdOrUsername}.`
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
        .map(m => ({ platform: 'telegram' as const, from: m.from, room: m.chatTitle, text: m.text, timestamp: m.timestamp }))
    } catch { return [] }
  }

  async tryAutoConnect(): Promise<void> {
    if (this._loadToken()) await this.connect().catch(() => {})
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
