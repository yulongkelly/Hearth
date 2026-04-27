import path from 'path'
import os from 'os'
import { writeEncrypted, readEncrypted } from '../secure-storage'
import type { BasePlatformAdapter, ConnectOptions, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'

const HEARTH_DIR = path.join(os.homedir(), '.hearth')

interface ImapConfig { email: string; password: string }

const PROVIDER_MAP: Record<string, { imap: [string, number]; smtp: [string, number] }> = {
  'outlook.com': { imap: ['outlook.office365.com', 993], smtp: ['smtp.office365.com', 587] },
  'hotmail.com': { imap: ['outlook.office365.com', 993], smtp: ['smtp.office365.com', 587] },
  'live.com':    { imap: ['outlook.office365.com', 993], smtp: ['smtp.office365.com', 587] },
  'qq.com':      { imap: ['imap.qq.com', 993],           smtp: ['smtp.qq.com', 465] },
}

function detectProvider(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return PROVIDER_MAP[domain] ?? {
    imap: ['imap.' + domain, 993] as [string, number],
    smtp: ['smtp.' + domain, 587] as [string, number],
  }
}

interface State {
  status:   'stopped' | 'connecting' | 'connected' | 'error'
  email:    string
  imapHost: string; imapPort: number
  smtpHost: string; smtpPort: number
  error:    string | null
}

export class ImapPlatformAdapter implements BasePlatformAdapter {
  readonly name: PlatformName
  private readonly configFile: string
  private _g: State | undefined = undefined

  constructor(name: PlatformName, configFileName: string) {
    this.name = name
    this.configFile = path.join(HEARTH_DIR, configFileName)
  }

  getState(): PlatformState {
    return {
      platform: this.name,
      status:   this._g?.status ?? 'stopped',
      qrImage:  null,
      identity: this._g?.email ?? null,
      meta:     { hasToken: !!this._loadConfig() },
      error:    this._g?.error ?? null,
    }
  }

  private _loadConfig(): ImapConfig | null {
    return readEncrypted<ImapConfig>(this.configFile) ?? null
  }

  async connect(opts?: ConnectOptions): Promise<void> {
    if (this._g?.status === 'connecting' || this._g?.status === 'connected') return
    this._g = undefined

    const saved    = this._loadConfig()
    const email    = opts?.token  ?? saved?.email
    const password = opts?.secret ?? saved?.password
    if (!email)    throw new Error('No email address provided')
    if (!password) throw new Error('No password / authorization code provided')

    const provider = detectProvider(email)
    const [imapHost, imapPort] = provider.imap
    const [smtpHost, smtpPort] = provider.smtp

    const g: State = { status: 'connecting', email, imapHost, imapPort, smtpHost, smtpPort, error: null }
    this._g = g

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ImapFlow } = require('imapflow') as typeof import('imapflow')
      const client = new ImapFlow({
        host: imapHost, port: imapPort, secure: true,
        auth: { user: email, pass: password },
        logger: false,
      })
      await client.connect()
      await client.logout()
      if (opts?.token || opts?.secret) writeEncrypted(this.configFile, { email, password })
      g.status = 'connected'
    } catch (err) {
      g.status = 'error'
      g.error  = err instanceof Error ? err.message : 'IMAP authentication failed'
    }
  }

  async disconnect(): Promise<void> {
    this._g = undefined
  }

  async send(_to: string, _text: string): Promise<string> {
    return 'Error: Use the email tool to send messages.'
  }

  queryMessages(_opts?: QueryOptions): PlatformMessage[] {
    return []
  }

  async tryAutoConnect(): Promise<void> {
    if (this._loadConfig()) await this.connect().catch(() => {})
  }
}
