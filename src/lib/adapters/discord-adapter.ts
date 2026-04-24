import fs from 'fs'
import path from 'path'
import os from 'os'
import { encryptLine, decryptLine, writeEncrypted, readEncrypted } from '../secure-storage'
import type { BasePlatformAdapter, ConnectOptions, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const CONFIG_FILE   = path.join(HEARTH_DIR, 'discord-config.json')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'discord-messages.jsonl')
const MAX_LINES     = 2000

interface DiscordConfig { token: string }
interface RawMsg { from: string; channel: string | null; guild: string | null; text: string; timestamp: string }

interface DiscordSingleton {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client:  any
  status:  'stopped' | 'connecting' | 'connected' | 'error'
  botName: string | null
  guilds:  string[]
  error:   string | null
}

export class DiscordAdapter implements BasePlatformAdapter {
  readonly name: PlatformName = 'discord'
  private _g: DiscordSingleton | undefined = undefined

  getState(): PlatformState {
    const g = this._g
    return {
      platform: 'discord',
      status:   g?.status  ?? 'stopped',
      qrImage:  null,
      identity: g?.botName ?? null,
      meta:     { guilds: g?.guilds ?? [], hasToken: !!this._loadToken() },
      error:    g?.error   ?? null,
    }
  }

  private _loadToken(): string | null {
    return readEncrypted<DiscordConfig>(CONFIG_FILE)?.token ?? null
  }

  async connect(opts?: ConnectOptions): Promise<void> {
    if (this._g) {
      if (this._g.status !== 'error') return
      await this.disconnect()
    }

    const t = opts?.token ?? this._loadToken()
    if (!t) throw new Error('No Discord bot token provided')
    if (opts?.token) writeEncrypted(CONFIG_FILE, { token: opts.token })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client, GatewayIntentBits, Events } = require('discord.js') as typeof import('discord.js')

    const g: DiscordSingleton = { client: null, status: 'connecting', botName: null, guilds: [], error: null }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    })
    g.client = client

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.once(Events.ClientReady, (c: any) => {
      g.status  = 'connected'
      g.botName = c.user.tag
      g.guilds  = c.guilds.cache.map((guild: { name: string }) => guild.name)
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on(Events.MessageCreate, (message: any) => {
      try {
        if (message.author.bot || !message.content) return
        this._append({ from: message.author.username, channel: message.guild ? (message.channel.name ?? null) : null, guild: message.guild?.name ?? null, text: message.content, timestamp: new Date().toISOString() })
      } catch { /* non-critical */ }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on(Events.Error, (err: any) => { g.status = 'error'; g.error = err?.message ?? 'Unknown error' })

    this._g = g

    try {
      await client.login(t)
    } catch (err) {
      g.status = 'error'
      g.error  = err instanceof Error ? err.message : 'Invalid token or network error'
      throw err
    }
  }

  async disconnect(): Promise<void> {
    if (!this._g) return
    try { this._g.client?.destroy() } catch {}
    this._g = undefined
  }

  async send(channelTarget: string, text: string): Promise<string> {
    if (!this._g || this._g.status !== 'connected') return 'Error: Discord bot is not connected.'
    try {
      const { client } = this._g
      let ch = client.channels.cache.get(channelTarget)
      if (!ch) ch = client.channels.cache.find((c: { name?: string }) => c.name === channelTarget)
      if (!ch || !('send' in ch)) return `Error: channel "${channelTarget}" not found.`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (ch as any).send(text)
      return `Message sent to #${channelTarget}.`
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : 'send failed'}`
    }
  }

  queryMessages(opts: QueryOptions = {}): PlatformMessage[] {
    const { contact, channel, days = 7, limit = 50 } = opts
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    try {
      const lines = fs.readFileSync(MESSAGES_FILE, 'utf8').split('\n').filter(Boolean)
      return lines
        .map(l => { try { return decryptLine(l) as RawMsg } catch { return null } })
        .filter((m): m is RawMsg => m !== null && m.timestamp >= cutoff)
        .filter(m => !contact || m.from.toLowerCase().includes(contact.toLowerCase()))
        .filter(m => !channel || (m.channel ?? '').toLowerCase().includes(channel.toLowerCase()))
        .slice(-limit)
        .reverse()
        .map(m => ({
          platform: 'discord' as const,
          from:     m.from,
          room:     m.guild && m.channel ? `${m.guild}#${m.channel}` : (m.channel ?? m.guild ?? null),
          text:     m.text,
          timestamp: m.timestamp,
        }))
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
