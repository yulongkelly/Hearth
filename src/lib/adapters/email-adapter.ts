import fs from 'fs'
import path from 'path'
import os from 'os'
import { decryptLine, writeEncrypted, readEncrypted } from '../secure-storage'
import type { BasePlatformAdapter, ConnectOptions, PlatformMessage, PlatformName, PlatformState, QueryOptions } from '../platform-adapter'
import { createAppender } from './adapter-utils'

const HEARTH_DIR    = path.join(os.homedir(), '.hearth')
const CONFIG_FILE   = path.join(HEARTH_DIR, 'email-config.json')
const MESSAGES_FILE = path.join(HEARTH_DIR, 'email-messages.jsonl')

interface EmailConfig { email: string; password: string }
interface RawMsg { from: string; subject: string; text: string; timestamp: string }

interface EmailSingleton {
  status:   'stopped' | 'connecting' | 'connected' | 'error'
  email:    string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  error:    string | null
}

const PROVIDER_MAP: Record<string, { imap: [string, number]; smtp: [string, number] }> = {
  'gmail.com':        { imap: ['imap.gmail.com', 993],        smtp: ['smtp.gmail.com', 587]        },
  'googlemail.com':   { imap: ['imap.gmail.com', 993],        smtp: ['smtp.gmail.com', 587]        },
  'outlook.com':      { imap: ['outlook.office365.com', 993], smtp: ['smtp.office365.com', 587]    },
  'hotmail.com':      { imap: ['outlook.office365.com', 993], smtp: ['smtp.office365.com', 587]    },
  'live.com':         { imap: ['outlook.office365.com', 993], smtp: ['smtp.office365.com', 587]    },
  'yahoo.com':        { imap: ['imap.mail.yahoo.com', 993],   smtp: ['smtp.mail.yahoo.com', 587]   },
  'icloud.com':       { imap: ['imap.mail.me.com', 993],      smtp: ['smtp.mail.me.com', 587]      },
  'me.com':           { imap: ['imap.mail.me.com', 993],      smtp: ['smtp.mail.me.com', 587]      },
  'protonmail.com':   { imap: ['127.0.0.1', 1143],            smtp: ['127.0.0.1', 1025]            },
  'proton.me':        { imap: ['127.0.0.1', 1143],            smtp: ['127.0.0.1', 1025]            },
}

function detectProvider(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return PROVIDER_MAP[domain] ?? { imap: ['imap.' + domain, 993] as [string, number], smtp: ['smtp.' + domain, 587] as [string, number] }
}

export class EmailAdapter implements BasePlatformAdapter {
  readonly name: PlatformName = 'email'
  private _g: EmailSingleton | undefined = undefined
  private readonly _append = createAppender(HEARTH_DIR, MESSAGES_FILE)

  getState(): PlatformState {
    const g = this._g
    return {
      platform: 'email',
      status:   g?.status ?? 'stopped',
      qrImage:  null,
      identity: g?.email  ?? null,
      meta:     { hasToken: !!this._loadConfig() },
      error:    g?.error  ?? null,
    }
  }

  private _loadConfig(): EmailConfig | null {
    return readEncrypted<EmailConfig>(CONFIG_FILE) ?? null
  }

  async connect(opts?: ConnectOptions): Promise<void> {
    if (this._g) {
      if (this._g.status !== 'error') return
      await this.disconnect()
    }

    const saved    = this._loadConfig()
    const email    = opts?.token  ?? saved?.email
    const password = opts?.secret ?? saved?.password
    if (!email)    throw new Error('No email address provided')
    if (!password) throw new Error('No password/app-password provided')

    const provider = detectProvider(email)
    const [imapHost, imapPort] = provider.imap
    const [smtpHost, smtpPort] = provider.smtp

    const g: EmailSingleton = { status: 'connecting', email, imapHost, imapPort, smtpHost, smtpPort, error: null }
    this._g = g

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ImapFlow } = require('imapflow') as typeof import('imapflow')
      const client = new ImapFlow({ host: imapHost, port: imapPort, secure: true, auth: { user: email, pass: password }, logger: false })
      await client.connect()
      await client.logout()
      if (opts?.token || opts?.secret) writeEncrypted(CONFIG_FILE, { email, password })
      g.status = 'connected'
    } catch (err) {
      g.status = 'error'
      g.error  = err instanceof Error ? err.message : 'IMAP authentication failed'
    }
  }

  async disconnect(): Promise<void> {
    this._g = undefined
  }

  async send(to: string, text: string): Promise<string> {
    if (!this._g || this._g.status !== 'connected') return 'Error: Email is not connected.'
    const cfg = this._loadConfig()
    if (!cfg) return 'Error: No email credentials saved.'
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require('nodemailer') as typeof import('nodemailer')
      const transporter = nodemailer.createTransport({
        host: this._g.smtpHost, port: this._g.smtpPort, secure: false,
        auth: { user: cfg.email, pass: cfg.password },
      })
      await transporter.sendMail({ from: cfg.email, to, text })
      return `Email sent to ${to}.`
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
        .map(m => ({ platform: 'email' as const, from: m.from, room: m.subject, text: m.text, timestamp: m.timestamp }))
    } catch { return [] }
  }

  async tryAutoConnect(): Promise<void> {
    if (this._loadConfig()) await this.connect().catch(() => {})
  }

  // Called externally when polling IMAP for new messages
  async fetchNewMessages(): Promise<void> {
    const cfg = this._loadConfig()
    if (!cfg || !this._g || this._g.status !== 'connected') return
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ImapFlow } = require('imapflow') as typeof import('imapflow')
      const client = new ImapFlow({ host: this._g.imapHost, port: this._g.imapPort, secure: true, auth: { user: cfg.email, pass: cfg.password }, logger: false })
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        // Fetch last 20 messages
        for await (const msg of client.fetch('1:20', { envelope: true, bodyStructure: true, bodyParts: ['TEXT'] })) {
          const from    = msg.envelope?.from?.[0]?.address ?? 'unknown'
          const subject = msg.envelope?.subject ?? '(no subject)'
          const text    = msg.bodyParts?.get('TEXT')?.toString('utf8')?.slice(0, 2000) ?? ''
          const ts      = (msg.envelope?.date ?? new Date()).toISOString()
          this._append({ from, subject, text, timestamp: ts })
        }
      } finally {
        lock.release()
      }
      await client.logout()
    } catch { /* non-critical */ }
  }

}
