import fs from 'fs'
import path from 'path'
import os from 'os'
import { WechatyBuilder } from 'wechaty'
import { PuppetWechat4u } from 'wechaty-puppet-wechat4u'
import { encryptLine, decryptLine } from '../secure-storage'
import type { BasePlatformAdapter, ConnectOptions, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const SESSION_DIR   = path.join(HEARTH_DIR, 'wechat-session')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'wechat-messages.jsonl')
const MAX_LINES     = 2000

interface RawMsg { from: string; room: string | null; text: string; timestamp: string }

interface WechatSingleton {
  bot:        ReturnType<typeof WechatyBuilder.build>
  status:     'stopped' | 'scanning' | 'connected' | 'error'
  qr:         string | null
  loggedInAs: string | null
  error:      string | null
}

export class WechatAdapter implements BasePlatformAdapter {
  readonly name: PlatformName = 'wechat'
  private _g: WechatSingleton | undefined = undefined

  getState(): PlatformState {
    const g = this._g
    return {
      platform: 'wechat',
      status:   g?.status     ?? 'stopped',
      qrImage:  g?.qr         ?? null,
      identity: g?.loggedInAs ?? null,
      meta:     {},
      error:    g?.error      ?? null,
    }
  }

  async connect(_opts?: ConnectOptions): Promise<void> {
    if (this._g) {
      if (this._g.status !== 'error') return
      await this.disconnect()
    }

    const bot = WechatyBuilder.build({ puppet: new PuppetWechat4u() })
    const g: WechatSingleton = { bot, status: 'scanning', qr: null, loggedInAs: null, error: null }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bot.on('scan',   (qr: any)   => { g.status = 'scanning'; g.qr = qr })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bot.on('login',  (user: any) => { g.status = 'connected'; g.loggedInAs = user.name(); g.qr = null })
    bot.on('logout', ()          => { g.status = 'stopped'; g.loggedInAs = null })
    bot.on('error',  (e: Error)  => { g.status = 'error'; g.error = e.message })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bot.on('message', async (message: any) => {
      try {
        if (message.self()) return
        const room = message.room()
        this._append({ from: message.talker().name(), room: room ? await room.topic() : null, text: message.text(), timestamp: new Date().toISOString() })
      } catch { /* non-critical */ }
    })

    this._g = g
    await bot.start()
  }

  async disconnect(): Promise<void> {
    if (!this._g) return
    try { await this._g.bot.stop() } catch {}
    this._g = undefined
  }

  async send(contactName: string, text: string): Promise<string> {
    if (!this._g || this._g.status !== 'connected') return 'Error: WeChat is not connected.'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contact = await (this._g.bot as any).Contact.find({ name: contactName })
    if (!contact) return `Error: contact "${contactName}" not found.`
    await contact.say(text)
    return `Message sent to ${contactName}.`
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
        .map(m => ({ platform: 'wechat' as const, from: m.from, room: m.room, text: m.text, timestamp: m.timestamp }))
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
