import fs from 'fs'
import path from 'path'
import os from 'os'
import { encryptLine, decryptLine, writeEncrypted, readEncrypted } from '../secure-storage'
import type { BasePlatformAdapter, ConnectOptions, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const CONFIG_FILE   = path.join(HEARTH_DIR, 'slack-config.json')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'slack-messages.jsonl')
const MAX_LINES     = 2000

interface SlackConfig { token: string; appToken: string }
interface RawMsg { from: string; channel: string | null; team: string | null; text: string; timestamp: string }

interface SlackSingleton {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app:      any
  status:   'stopped' | 'connecting' | 'connected' | 'error'
  botName:  string | null
  teamName: string | null
  error:    string | null
}

export class SlackAdapter implements BasePlatformAdapter {
  readonly name: PlatformName = 'slack'
  private _g: SlackSingleton | undefined = undefined

  getState(): PlatformState {
    const g = this._g
    return {
      platform: 'slack',
      status:   g?.status   ?? 'stopped',
      qrImage:  null,
      identity: g?.botName  ?? null,
      meta:     { team: g?.teamName ?? null, hasToken: !!this._loadConfig() },
      error:    g?.error    ?? null,
    }
  }

  private _loadConfig(): SlackConfig | null {
    return readEncrypted<SlackConfig>(CONFIG_FILE) ?? null
  }

  async connect(opts?: ConnectOptions): Promise<void> {
    if (this._g) {
      if (this._g.status !== 'error') return
      await this.disconnect()
    }

    const saved  = this._loadConfig()
    const token  = opts?.token  ?? saved?.token
    const appTok = opts?.secret ?? saved?.appToken
    if (!token)  throw new Error('No Slack Bot Token provided (xoxb-…)')
    if (!appTok) throw new Error('No Slack App Token provided (xapp-…)')
    if (opts?.token || opts?.secret) writeEncrypted(CONFIG_FILE, { token, appToken: appTok })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { App } = require('@slack/bolt') as typeof import('@slack/bolt')

    const g: SlackSingleton = { app: null, status: 'connecting', botName: null, teamName: null, error: null }
    this._g = g

    const silentLogger = { debug: ()=>{}, info: ()=>{}, warn: ()=>{}, error: ()=>{}, setLevel: ()=>{}, setName: ()=>{} }

    try {
      const app = new App({ token, socketMode: true, appToken: appTok, logger: silentLogger })
      g.app = app

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.message(async ({ message, client }: any) => {
        try {
          if (message.subtype) return
          const info = await client.users.info({ user: message.user }).catch(() => null)
          const from  = info?.user?.real_name ?? info?.user?.name ?? message.user ?? 'unknown'
          const chInfo = await client.conversations.info({ channel: message.channel }).catch(() => null)
          const ch    = chInfo?.channel?.name ?? message.channel ?? null
          this._append({ from, channel: ch, team: g.teamName, text: message.text ?? '', timestamp: new Date().toISOString() })
        } catch { /* non-critical */ }
      })

      await app.start()

      const auth = await app.client.auth.test()
      g.status   = 'connected'
      g.botName  = (auth.bot_id ? `<@${auth.bot_id}>` : auth.user) as string
      g.teamName = auth.team as string
    } catch (err) {
      g.status = 'error'
      g.error  = err instanceof Error ? err.message : 'Connection failed'
    }
  }

  async disconnect(): Promise<void> {
    if (!this._g) return
    try { await this._g.app?.stop() } catch {}
    this._g = undefined
  }

  async send(channel: string, text: string): Promise<string> {
    if (!this._g || this._g.status !== 'connected') return 'Error: Slack is not connected.'
    try {
      await this._g.app.client.chat.postMessage({ channel, text })
      return `Message sent to ${channel}.`
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
        .map(m => ({ platform: 'slack' as const, from: m.from, room: m.channel, text: m.text, timestamp: m.timestamp }))
    } catch { return [] }
  }

  async tryAutoConnect(): Promise<void> {
    if (this._loadConfig()) await this.connect().catch(() => {})
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
