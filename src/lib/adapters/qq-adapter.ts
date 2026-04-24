// Official QQ Bot API: https://bot.q.qq.com/wiki/develop/api/
// Register your bot at https://q.qq.com to get App ID + Client Secret.

import fs from 'fs'
import path from 'path'
import os from 'os'
import { encryptLine, decryptLine, writeEncrypted, readEncrypted } from '../secure-storage'
import type { BasePlatformAdapter, ConnectOptions, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'

const API_BASE      = 'https://api.sgroup.qq.com'
const TOKEN_URL     = 'https://bots.qq.com/app/getAppAccessToken'
const GATEWAY_PATH  = `${API_BASE}/gateway`

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const CONFIG_FILE   = path.join(HEARTH_DIR, 'qq-config.json')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'qq-messages.jsonl')
const MAX_LINES     = 2000

// Intents: GROUP_AND_C2C_EVENT (bit 25) + DIRECT_MESSAGE (bit 12)
const INTENTS = (1 << 25) | (1 << 12)

interface QqConfig { appId: string; clientSecret: string }
interface RawMsg { from: string; room: string | null; text: string; timestamp: string }

interface QqSingleton {
  status:     'stopped' | 'connecting' | 'connected' | 'error'
  botName:    string | null
  appId:      string | null
  error:      string | null
  // Internal WS state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws:                any
  heartbeatTimer:    NodeJS.Timeout | undefined
  tokenRefreshTimer: NodeJS.Timeout | undefined
  accessToken:       string | null
  sessionId:         string | null
  seq:               number
  lastMsgIds:        Map<string, string>  // openid/group_openid → last msg_id (for passive replies)
}

export class QqAdapter implements BasePlatformAdapter {
  readonly name: PlatformName = 'qq'
  private _g: QqSingleton | undefined = undefined

  getState(): PlatformState {
    const g = this._g
    return {
      platform: 'qq',
      status:   g?.status  ?? 'stopped',
      qrImage:  null,
      identity: g?.botName ? `${g.botName}` : null,
      meta:     { hasCredentials: !!this._loadConfig() },
      error:    g?.error   ?? null,
    }
  }

  private _loadConfig(): QqConfig | null {
    return readEncrypted<QqConfig>(CONFIG_FILE)
  }

  async connect(opts?: ConnectOptions): Promise<void> {
    if (this._g?.status === 'connecting' || this._g?.status === 'connected') return
    await this.disconnect()

    const config: QqConfig | null =
      opts?.token && opts?.secret
        ? { appId: opts.token, clientSecret: opts.secret }
        : this._loadConfig()

    if (!config) throw new Error('QQ App ID and Client Secret are required')
    if (opts?.token && opts?.secret) writeEncrypted(CONFIG_FILE, config)

    const g: QqSingleton = {
      status: 'connecting', botName: null, appId: config.appId, error: null,
      ws: null, heartbeatTimer: undefined, tokenRefreshTimer: undefined,
      accessToken: null, sessionId: null, seq: 0, lastMsgIds: new Map(),
    }
    this._g = g

    this._startConnection(config).catch(err => {
      if (this._g === g) { g.status = 'error'; g.error = err.message }
    })
  }

  private async _startConnection(config: QqConfig): Promise<void> {
    const g = this._g
    if (!g) return

    // Acquire access token
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: config.appId, clientSecret: config.clientSecret }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!tokenRes.ok) throw new Error(`Token request failed: ${tokenRes.status}`)
    const { access_token, expires_in } = await tokenRes.json() as { access_token: string; expires_in: string | number }
    g.accessToken = access_token

    // Refresh token before it expires
    if (g.tokenRefreshTimer) clearTimeout(g.tokenRefreshTimer)
    g.tokenRefreshTimer = setTimeout(
      () => { if (this._g === g) this._startConnection(config).catch(() => {}) },
      Math.max((Number(expires_in) - 60) * 1000, 5000)
    )

    // Get WebSocket gateway URL
    const gwRes = await fetch(GATEWAY_PATH, {
      headers: { Authorization: `QQBot ${access_token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!gwRes.ok) throw new Error(`Gateway request failed: ${gwRes.status}`)
    const { url } = await gwRes.json() as { url: string }

    this._openWS(url, access_token, config)
  }

  private _openWS(url: string, accessToken: string, config: QqConfig): void {
    const g = this._g
    if (!g) return

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WebSocket } = require('ws') as typeof import('ws')
    const ws = new WebSocket(url)
    g.ws = ws

    ws.on('message', (raw: Buffer) => {
      try { this._onMessage(JSON.parse(raw.toString()), accessToken, config) } catch {}
    })

    ws.on('close', (code: number) => {
      if (this._g !== g) return
      if (g.heartbeatTimer) { clearInterval(g.heartbeatTimer); g.heartbeatTimer = undefined }
      if (code !== 1000 && g.status !== 'stopped') {
        g.status = 'connecting'
        setTimeout(() => { if (this._g === g) this._startConnection(config).catch(() => {}) }, 5000)
      }
    })

    ws.on('error', (err: Error) => {
      if (this._g === g) { g.status = 'error'; g.error = err.message }
    })
  }

  private _onMessage(
    msg: { op: number; d?: Record<string, unknown>; s?: number; t?: string },
    accessToken: string,
    config: QqConfig,
  ): void {
    const g = this._g
    if (!g) return

    const { op, d = {}, s, t } = msg
    if (s !== undefined) g.seq = s

    if (op === 10) {
      // HELLO → start heartbeat + identify
      const interval = (d.heartbeat_interval as number) || 41250
      if (g.heartbeatTimer) clearInterval(g.heartbeatTimer)
      g.heartbeatTimer = setInterval(() => {
        g.ws?.send(JSON.stringify({ op: 1, d: g.seq || null }))
      }, interval)
      g.ws?.send(JSON.stringify({ op: 2, d: { token: `QQBot ${accessToken}`, intents: INTENTS, shard: [0, 1] } }))

    } else if (op === 11) {
      // HEARTBEAT_ACK — no-op

    } else if (op === 0) {
      if (t === 'READY') {
        g.status    = 'connected'
        g.sessionId = (d.session_id as string) ?? null
        const user  = d.user as Record<string, unknown> | undefined
        g.botName   = (user?.username as string) ?? (user?.id as string) ?? config.appId

      } else if (t === 'C2C_MESSAGE_CREATE') {
        const author  = d.author as Record<string, unknown>
        const openid  = author?.user_openid as string
        const content = this._stripMarkup(d.content as string)
        const msgId   = d.id as string
        if (openid && msgId) g.lastMsgIds.set(openid, msgId)
        if (openid && content)
          this._append({ from: openid, room: null, text: content, timestamp: new Date().toISOString() })

      } else if (t === 'GROUP_AT_MESSAGE_CREATE') {
        const groupOpenid  = d.group_openid as string
        const author       = d.author as Record<string, unknown>
        const memberOpenid = author?.member_openid as string
        const content      = this._stripMarkup(d.content as string)
        const msgId        = d.id as string
        if (groupOpenid && msgId) g.lastMsgIds.set(groupOpenid, msgId)
        if (content)
          this._append({ from: memberOpenid || 'unknown', room: groupOpenid, text: content, timestamp: new Date().toISOString() })
      }
    }
  }

  private _stripMarkup(text: string): string {
    return (text ?? '').replace(/<[^>]+>/g, '').trim()
  }

  async disconnect(): Promise<void> {
    if (!this._g) return
    const g = this._g
    this._g = undefined
    if (g.heartbeatTimer)    clearInterval(g.heartbeatTimer)
    if (g.tokenRefreshTimer) clearTimeout(g.tokenRefreshTimer)
    try { g.ws?.close(1000) } catch {}
  }

  async send(target: string, text: string): Promise<string> {
    const g = this._g
    if (!g || g.status !== 'connected') return 'Error: QQ bot is not connected.'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization:  `QQBot ${g.accessToken}`,
    }
    const msgId   = g.lastMsgIds.get(target)
    const payload = JSON.stringify({ content: text, msg_type: 0, ...(msgId ? { msg_id: msgId } : {}) })

    // Try C2C (user openid) first, then group
    for (const url of [
      `${API_BASE}/v2/users/${target}/messages`,
      `${API_BASE}/v2/groups/${target}/messages`,
    ]) {
      const res = await fetch(url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(10_000) })
      if (res.ok) return `Message sent to ${target}.`
    }
    return `Error: could not send to "${target}". The openid may be wrong, or a recent message from them is required to reply.`
  }

  queryMessages(opts: QueryOptions = {}): PlatformMessage[] {
    const { contact, days = 7, limit = 50 } = opts
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    try {
      const lines = fs.readFileSync(MESSAGES_FILE, 'utf8').split('\n').filter(Boolean)
      return lines
        .map(l => { try { return decryptLine(l) as RawMsg } catch { return null } })
        .filter((m): m is RawMsg => m !== null && m.timestamp >= cutoff)
        .filter(m => !contact || m.from.toLowerCase().includes(contact.toLowerCase()) || (m.room ?? '').toLowerCase().includes(contact.toLowerCase()))
        .slice(-limit)
        .reverse()
        .map(m => ({ platform: 'qq' as const, from: m.from, room: m.room, text: m.text, timestamp: m.timestamp }))
    } catch { return [] }
  }

  async tryAutoConnect(): Promise<void> { /* user must connect manually */ }

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
