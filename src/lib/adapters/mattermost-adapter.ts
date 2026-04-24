import fs from 'fs'
import path from 'path'
import os from 'os'
import { encryptLine, decryptLine, writeEncrypted, readEncrypted } from '../secure-storage'
import type { BasePlatformAdapter, ConnectOptions, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const CONFIG_FILE   = path.join(HEARTH_DIR, 'mattermost-config.json')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'mattermost-messages.jsonl')
const MAX_LINES     = 2000

interface MattermostConfig { token: string; serverUrl: string }
interface RawMsg { from: string; channel: string | null; team: string | null; text: string; timestamp: string }

interface MattermostSingleton {
  ws:       WebSocket | null
  status:   'stopped' | 'connecting' | 'connected' | 'error'
  identity: string | null
  teamName: string | null
  error:    string | null
}

export class MattermostAdapter implements BasePlatformAdapter {
  readonly name: PlatformName = 'mattermost'
  private _g: MattermostSingleton | undefined = undefined

  getState(): PlatformState {
    const g = this._g
    return {
      platform: 'mattermost',
      status:   g?.status   ?? 'stopped',
      qrImage:  null,
      identity: g?.identity ?? null,
      meta:     { team: g?.teamName ?? null, hasToken: !!this._loadConfig() },
      error:    g?.error    ?? null,
    }
  }

  private _loadConfig(): MattermostConfig | null {
    return readEncrypted<MattermostConfig>(CONFIG_FILE) ?? null
  }

  async connect(opts?: ConnectOptions): Promise<void> {
    if (this._g) {
      if (this._g.status !== 'error') return
      await this.disconnect()
    }

    const saved     = this._loadConfig()
    const token     = opts?.token  ?? saved?.token
    const serverUrl = (opts?.secret ?? saved?.serverUrl ?? '').replace(/\/$/, '')
    if (!token)     throw new Error('No Mattermost personal access token provided')
    if (!serverUrl) throw new Error('No Mattermost server URL provided (e.g. https://mattermost.example.com)')

    const g: MattermostSingleton = { ws: null, status: 'connecting', identity: null, teamName: null, error: null }
    this._g = g

    try {
      // Validate token by fetching current user
      const res = await fetch(`${serverUrl}/api/v4/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Auth failed: ${res.status} ${res.statusText}`)
      const me = await res.json() as { username: string; id: string }
      g.identity = `@${me.username}`

      // Fetch first team name for display
      const teamsRes = await fetch(`${serverUrl}/api/v4/users/me/teams`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (teamsRes.ok) {
        const teams = await teamsRes.json() as Array<{ display_name: string }>
        g.teamName = teams[0]?.display_name ?? null
      }

      if (opts?.token || opts?.secret) writeEncrypted(CONFIG_FILE, { token, serverUrl })

      // Open WebSocket
      const wsUrl = serverUrl.replace(/^https?/, m => m === 'https' ? 'wss' : 'ws') + '/api/v4/websocket'
      const ws    = new WebSocket(wsUrl)
      g.ws = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ seq: 1, action: 'authentication_challenge', data: { token } }))
        g.status = 'connected'
      }

      ws.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data as string) as { event?: string; data?: Record<string, unknown> }
          if (payload.event !== 'posted') return
          const post = JSON.parse(payload.data?.post as string ?? '{}') as { user_id?: string; channel_id?: string; message?: string; create_at?: number }
          if (!post.message) return
          this._append({
            from:      post.user_id    ?? 'unknown',
            channel:   post.channel_id ?? null,
            team:      g.teamName,
            text:      post.message,
            timestamp: post.create_at  ? new Date(post.create_at).toISOString() : new Date().toISOString(),
          })
        } catch { /* non-critical */ }
      }

      ws.onerror = () => { g.status = 'error'; g.error = 'WebSocket error' }
      ws.onclose = () => { if (g.status === 'connected') g.status = 'stopped' }
    } catch (err) {
      g.status = 'error'
      g.error  = err instanceof Error ? err.message : 'Connection failed'
    }
  }

  async disconnect(): Promise<void> {
    if (!this._g) return
    try { this._g.ws?.close() } catch {}
    this._g = undefined
  }

  async send(channelId: string, text: string): Promise<string> {
    if (!this._g || this._g.status !== 'connected') return 'Error: Mattermost is not connected.'
    const cfg = this._loadConfig()
    if (!cfg) return 'Error: No Mattermost credentials saved.'
    try {
      const res = await fetch(`${cfg.serverUrl}/api/v4/posts`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ channel_id: channelId, message: text }),
      })
      if (!res.ok) return `Error: ${res.status} ${res.statusText}`
      return `Message sent to ${channelId}.`
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
          platform: 'mattermost' as const,
          from:     m.from,
          room:     m.team && m.channel ? `${m.team}/${m.channel}` : (m.channel ?? m.team ?? null),
          text:     m.text,
          timestamp: m.timestamp,
        }))
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
