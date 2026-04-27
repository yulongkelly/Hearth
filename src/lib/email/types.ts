export interface EmailMessage {
  id: string
  from: string
  subject: string
  snippet: string
  date: string
  accountEmail: string
  accountLabel: string
  webLink?: string
}

export interface EmailAdapter {
  readonly providerType: 'gmail' | 'outlook' | 'imap'
  readonly accountEmail: string
  readonly accountLabel: string
  search(query: string, max: number): Promise<EmailMessage[]>
  get(id: string): Promise<string>
  send(to: string, subject: string, body: string): Promise<void>
}

export function formatEmailMessages(msgs: EmailMessage[]): string {
  if (!msgs.length) return 'No messages found.'
  return msgs.map(m => {
    const lines = [
      `Account: ${m.accountLabel}`,
      `ID: ${m.id}`,
      ...(m.webLink ? [`Link: ${m.webLink}`] : []),
      `From: ${m.from}`,
      `Subject: ${m.subject}`,
      `Date: ${m.date}`,
      `Snippet: ${m.snippet}`,
    ]
    return lines.join('\n')
  }).join('\n\n---\n\n')
}
