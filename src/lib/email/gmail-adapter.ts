import { getValidAccessTokenForAccount, listAccounts } from '../google-auth'
import type { EmailAdapter, EmailMessage } from './types'

function accountLabel(email: string): string {
  const acc = listAccounts().find(a => a.email === email)
  return acc?.nickname ?? email
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeGmailBody(payload: any, depth = 0): string {
  if (depth > 10) return ''
  if (payload?.body?.data) {
    try { return Buffer.from(payload.body.data, 'base64url').toString('utf-8') } catch {}
  }
  if (payload?.parts) {
    const plain = payload.parts.find((p: { mimeType: string }) => p.mimeType === 'text/plain')
    const html  = payload.parts.find((p: { mimeType: string }) => p.mimeType === 'text/html')
    for (const part of [plain, html]) {
      if (part?.body?.data) {
        try { return Buffer.from(part.body.data, 'base64url').toString('utf-8') } catch {}
      }
    }
    for (const part of payload.parts) {
      const body = decodeGmailBody(part, depth + 1)
      if (body) return body
    }
  }
  return ''
}

export class GmailAdapter implements EmailAdapter {
  readonly providerType = 'gmail' as const
  readonly accountEmail: string
  readonly accountLabel: string

  constructor(email: string, nickname?: string) {
    this.accountEmail = email
    this.accountLabel = nickname ?? email
  }

  async search(query: string, max: number): Promise<EmailMessage[]> {
    const token = await getValidAccessTokenForAccount(this.accountEmail)
    if (!token) throw new Error(`auth failed for ${this.accountEmail}`)

    const qs = query
      ? `maxResults=${max}&q=${encodeURIComponent(query)}`
      : `maxResults=${max}&labelIds=INBOX`

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!listRes.ok) throw new Error(`Gmail API ${listRes.status}`)

    const { messages = [] } = await listRes.json()
    if (!messages.length) return []

    const details = await Promise.all(
      (messages as { id: string }[]).map(m =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        ).then(r => r.json())
      )
    )

    const label = accountLabel(this.accountEmail)
    return details.map(msg => {
      const h = (name: string) =>
        msg.payload?.headers?.find((x: { name: string }) => x.name === name)?.value ?? '(unknown)'
      return {
        id: msg.id as string,
        from: h('From'),
        subject: h('Subject'),
        snippet: msg.snippet ?? '',
        date: h('Date'),
        accountEmail: this.accountEmail,
        accountLabel: label,
        webLink: `https://mail.google.com/mail/u/0/#all/${msg.id}`,
      }
    })
  }

  async get(id: string): Promise<string> {
    if (!/^[a-zA-Z0-9]+$/.test(id)) throw new Error('invalid message id')
    const token = await getValidAccessTokenForAccount(this.accountEmail)
    if (!token) throw new Error(`auth failed for ${this.accountEmail}`)

    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) throw new Error(`Gmail API ${res.status}`)

    const msg = await res.json()
    const h = (name: string) =>
      msg.payload?.headers?.find((x: { name: string }) => x.name === name)?.value ?? '(unknown)'
    const body = decodeGmailBody(msg.payload).slice(0, 8000)
    return `From: ${h('From')}\nSubject: ${h('Subject')}\nDate: ${h('Date')}\n\n${body || '(no readable body)'}`
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    const token = await getValidAccessTokenForAccount(this.accountEmail)
    if (!token) throw new Error(`auth failed for ${this.accountEmail}`)

    const message = [
      `From: ${this.accountEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n')

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(message).toString('base64url') }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const detail = (err as { error?: { message?: string } })?.error?.message
      throw new Error(`Gmail send failed (${res.status})${detail ? ': ' + detail : ''}`)
    }
  }
}
