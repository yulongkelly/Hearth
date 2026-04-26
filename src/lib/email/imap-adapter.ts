import path from 'path'
import os from 'os'
import { readEncrypted } from '../secure-storage'
import { compileQueryToImap } from './query-compiler'
import type { EmailAdapter, EmailMessage } from './types'

const HEARTH_DIR = path.join(os.homedir(), '.hearth')

interface ImapConfig { email: string; password: string; nickname?: string }

const IMAP_MAP: Record<string, { imap: [string, number]; smtp: [string, number] }> = {
  'gmail.com':    { imap: ['imap.gmail.com', 993],        smtp: ['smtp.gmail.com', 587] },
  'googlemail.com': { imap: ['imap.gmail.com', 993],      smtp: ['smtp.gmail.com', 587] },
  'outlook.com':  { imap: ['outlook.office365.com', 993], smtp: ['smtp.office365.com', 587] },
  'hotmail.com':  { imap: ['outlook.office365.com', 993], smtp: ['smtp.office365.com', 587] },
  'live.com':     { imap: ['outlook.office365.com', 993], smtp: ['smtp.office365.com', 587] },
  'yahoo.com':    { imap: ['imap.mail.yahoo.com', 993],   smtp: ['smtp.mail.yahoo.com', 587] },
  'icloud.com':   { imap: ['imap.mail.me.com', 993],      smtp: ['smtp.mail.me.com', 587] },
  'me.com':       { imap: ['imap.mail.me.com', 993],      smtp: ['smtp.mail.me.com', 587] },
  'qq.com':       { imap: ['imap.qq.com', 993],           smtp: ['smtp.qq.com', 587] },
}

function detectProvider(email: string): { imap: [string, number]; smtp: [string, number] } {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return IMAP_MAP[domain] ?? { imap: [`imap.${domain}`, 993], smtp: [`smtp.${domain}`, 587] }
}

export class ImapAdapter implements EmailAdapter {
  readonly providerType = 'imap' as const
  readonly accountEmail: string
  readonly accountLabel: string
  private readonly password: string

  constructor(cfg: ImapConfig) {
    this.accountEmail = cfg.email
    this.accountLabel = cfg.nickname ?? cfg.email
    this.password = cfg.password
  }

  static loadConfigured(): ImapAdapter[] {
    // Support array format (email-configs.json) and legacy single object (email-config.json)
    const multi = readEncrypted<ImapConfig[]>(path.join(HEARTH_DIR, 'email-configs.json'))
    if (Array.isArray(multi) && multi.length) return multi.map(c => new ImapAdapter(c))

    const single = readEncrypted<ImapConfig>(path.join(HEARTH_DIR, 'email-config.json'))
    if (single?.email && single?.password) return [new ImapAdapter(single)]

    return []
  }

  async search(query: string, max: number): Promise<EmailMessage[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImapFlow } = require('imapflow') as typeof import('imapflow')
    const { imap } = detectProvider(this.accountEmail)

    const client = new ImapFlow({
      host: imap[0], port: imap[1], secure: true,
      auth: { user: this.accountEmail, pass: this.password },
      logger: false,
    })

    const msgs: EmailMessage[] = []
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      let fetchRange = `1:${max}`
      if (query) {
        const criteria = compileQueryToImap(query)
        const found = await client.search(criteria as Parameters<typeof client.search>[0])
        const foundList = Array.isArray(found) ? found : []
        if (!foundList.length) return []
        fetchRange = foundList.slice(-max).join(',')
      }
      for await (const msg of client.fetch(fetchRange, { envelope: true })) {
        msgs.push({
          id: String(msg.uid),
          from: msg.envelope?.from?.[0]?.address ?? 'unknown',
          subject: msg.envelope?.subject ?? '(no subject)',
          snippet: '',
          date: (msg.envelope?.date ?? new Date()).toISOString().slice(0, 10),
          accountEmail: this.accountEmail,
          accountLabel: this.accountLabel,
        })
        if (msgs.length >= max) break
      }
    } finally {
      lock.release()
      await client.logout()
    }
    return msgs
  }

  async get(id: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImapFlow } = require('imapflow') as typeof import('imapflow')
    const { imap } = detectProvider(this.accountEmail)

    const client = new ImapFlow({
      host: imap[0], port: imap[1], secure: true,
      auth: { user: this.accountEmail, pass: this.password },
      logger: false,
    })

    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const msg = await client.fetchOne(id, { envelope: true, source: true }, { uid: true })
      if (!msg) throw new Error('message not found')

      const envelope = msg.envelope
      const from    = envelope?.from?.[0]?.address ?? 'unknown'
      const subject = envelope?.subject ?? '(no subject)'
      const date    = (envelope?.date ?? new Date()).toISOString()

      // Extract text from raw source (strip MIME headers/boundaries, keep readable text)
      const raw = msg.source ? (msg.source as Buffer).toString('utf-8') : ''
      const bodyStart = raw.indexOf('\r\n\r\n')
      const body = bodyStart !== -1 ? raw.slice(bodyStart + 4) : raw
      // Strip MIME boundary lines and headers from body
      const text = body
        .split('\n')
        .filter(l => !l.startsWith('--') && !l.match(/^[A-Za-z-]+:/))
        .join('\n')
        .slice(0, 8000)

      return `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${text || '(no readable body)'}`
    } finally {
      lock.release()
      await client.logout()
    }
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    const { smtp } = detectProvider(this.accountEmail)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require('nodemailer') as typeof import('nodemailer')

    const transporter = nodemailer.createTransport({
      host: smtp[0],
      port: smtp[1],
      secure: false,
      auth: { user: this.accountEmail, pass: this.password },
    })

    await transporter.sendMail({
      from: this.accountEmail,
      to,
      subject,
      text: body,
    })
  }
}
