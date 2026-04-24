import fs from 'fs'
import path from 'path'
import os from 'os'
import { encryptLine, decryptLine, writeEncrypted, readEncrypted } from '../secure-storage'
import type { BasePlatformAdapter, ConnectOptions, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const CONFIG_FILE   = path.join(HEARTH_DIR, 'matrix-config.json')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'matrix-messages.jsonl')
const MAX_LINES     = 2000

interface MatrixConfig { accessToken: string; homeserverUrl: string }
interface RawMsg { from: string; room: string | null; text: string; timestamp: string }

interface MatrixSingleton {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client:   any
  status:   'stopped' | 'connecting' | 'connected' | 'error'
  identity: string | null
  error:    string | null
}

export class MatrixAdapter implements BasePlatformAdapter {
  readonly name: PlatformName = 'matrix'
  private _g: MatrixSingleton | undefined = undefined

  getState(): PlatformState {
    const g = this._g
    return {
      platform: 'matrix',
      status:   g?.status   ?? 'stopped',
      qrImage:  null,
      identity: g?.identity ?? null,
      meta:     { hasToken: !!this._loadConfig() },
      error:    g?.error    ?? null,
    }
  }

  private _loadConfig(): MatrixConfig | null {
    return readEncrypted<MatrixConfig>(CONFIG_FILE) ?? null
  }

  async connect(opts?: ConnectOptions): Promise<void> {
    if (this._g) {
      if (this._g.status !== 'error') return
      await this.disconnect()
    }

    const saved        = this._loadConfig()
    const accessToken  = opts?.token  ?? saved?.accessToken
    const homeserver   = opts?.secret ?? saved?.homeserverUrl
    if (!accessToken) throw new Error('No Matrix access token provided')
    if (!homeserver)  throw new Error('No Matrix homeserver URL provided (e.g. https://matrix.org)')
    if (opts?.token || opts?.secret) writeEncrypted(CONFIG_FILE, { accessToken, homeserverUrl: homeserver })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('matrix-js-sdk') as typeof import('matrix-js-sdk')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(sdk as any).logger?.disableAll?.()

    const g: MatrixSingleton = { client: null, status: 'connecting', identity: null, error: null }
    this._g = g

    try {
      // Validate token and get userId before starting the full client.
      // The SDK uses a literal "$userId" placeholder if userId isn't provided at construction,
      // which causes filter-creation requests to fail even with a valid token.
      const tempClient = sdk.createClient({ baseUrl: homeserver, accessToken })
      const whoami = await tempClient.whoami()  // throws M_UNKNOWN_TOKEN if invalid
      const userId = whoami.user_id

      const client = sdk.createClient({ baseUrl: homeserver, accessToken, userId })
      g.client = client

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.on('Room.timeline' as any, (event: any, room: any) => {
        try {
          if (event.getType() !== 'm.room.message') return
          const content = event.getContent()
          if (content.msgtype !== 'm.text') return
          this._append({
            from:      event.getSender() ?? 'unknown',
            room:      room?.name ?? room?.roomId ?? null,
            text:      content.body ?? '',
            timestamp: new Date(event.getTs()).toISOString(),
          })
        } catch { /* non-critical */ }
      })

      await client.startClient({ initialSyncLimit: 0 })

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Matrix sync timeout')), 30_000)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.once('sync' as any, (state: string) => {
          clearTimeout(timeout)
          if (state === 'PREPARED') resolve()
          else reject(new Error(`Matrix sync state: ${state}`))
        })
      })

      g.status   = 'connected'
      g.identity = userId
    } catch (err) {
      g.status = 'error'
      g.error  = err instanceof Error ? err.message : 'Connection failed'
      try { g.client?.stopClient() } catch {}
    }
  }

  async disconnect(): Promise<void> {
    if (!this._g) return
    try { this._g.client?.stopClient() } catch {}
    this._g = undefined
  }

  async send(roomId: string, text: string): Promise<string> {
    if (!this._g || this._g.status !== 'connected') return 'Error: Matrix is not connected.'
    try {
      await this._g.client.sendTextMessage(roomId, text)
      return `Message sent to ${roomId}.`
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
        .map(m => ({ platform: 'matrix' as const, from: m.from, room: m.room, text: m.text, timestamp: m.timestamp }))
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
