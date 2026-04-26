import { getValidAccessTokenForAccount } from '../microsoft-auth'
import { compileForOutlook } from './query-compiler'
import type { EmailAdapter, EmailMessage } from './types'

const GRAPH = 'https://graph.microsoft.com/v1.0'

export class OutlookAdapter implements EmailAdapter {
  readonly providerType = 'outlook' as const
  readonly accountEmail: string
  readonly accountLabel: string

  constructor(email: string, nickname?: string) {
    this.accountEmail = email
    this.accountLabel = nickname ?? email
  }

  async search(query: string, max: number): Promise<EmailMessage[]> {
    const token = await getValidAccessTokenForAccount(this.accountEmail)
    if (!token) throw new Error(`auth failed for ${this.accountEmail}`)

    const url = new URL(`${GRAPH}/me/mailFolders/inbox/messages`)
    url.searchParams.set('$top', String(max))
    url.searchParams.set('$select', 'id,from,subject,bodyPreview,receivedDateTime')
    url.searchParams.set('$orderby', 'receivedDateTime desc')

    if (query) {
      const compiled = compileForOutlook(query)
      if (compiled.search) url.searchParams.set('$search', `"${compiled.search}"`)
      if (compiled.filter) url.searchParams.set('$filter', compiled.filter)
      // $search and $orderby can't be combined
      if (compiled.search) url.searchParams.delete('$orderby')
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Microsoft Graph ${res.status}`)

    const data = await res.json()
    const items: Array<{
      id: string
      from?: { emailAddress?: { address?: string; name?: string } }
      subject?: string
      bodyPreview?: string
      receivedDateTime?: string
    }> = data.value ?? []

    return items.map(msg => ({
      id: msg.id,
      from: msg.from?.emailAddress?.address ?? '(unknown)',
      subject: msg.subject ?? '(no subject)',
      snippet: msg.bodyPreview ?? '',
      date: msg.receivedDateTime ? new Date(msg.receivedDateTime).toISOString() : '',
      accountEmail: this.accountEmail,
      accountLabel: this.accountLabel,
    }))
  }

  async get(id: string): Promise<string> {
    const token = await getValidAccessTokenForAccount(this.accountEmail)
    if (!token) throw new Error(`auth failed for ${this.accountEmail}`)

    const res = await fetch(
      `${GRAPH}/me/messages/${encodeURIComponent(id)}?$select=from,subject,receivedDateTime,body`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) throw new Error(`Microsoft Graph ${res.status}`)

    const msg = await res.json()
    const from    = msg.from?.emailAddress?.address ?? '(unknown)'
    const subject = msg.subject ?? '(no subject)'
    const date    = msg.receivedDateTime ? new Date(msg.receivedDateTime).toISOString() : ''
    // Strip HTML tags from body content
    const rawBody: string = msg.body?.content ?? ''
    const body = msg.body?.contentType === 'html'
      ? rawBody.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
      : rawBody
    return `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${body.slice(0, 8000) || '(no readable body)'}`
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    const token = await getValidAccessTokenForAccount(this.accountEmail)
    if (!token) throw new Error(`auth failed for ${this.accountEmail}`)

    const res = await fetch(`${GRAPH}/me/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: body },
          toRecipients: [{ emailAddress: { address: to } }],
        },
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const detail = (err as { error?: { message?: string } })?.error?.message
      throw new Error(`Outlook send failed (${res.status})${detail ? ': ' + detail : ''}`)
    }
  }
}
