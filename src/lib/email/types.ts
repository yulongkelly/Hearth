export interface EmailMessage {
  id: string
  from: string
  subject: string
  snippet: string
  date: string
  accountEmail: string
  accountLabel: string
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
  return msgs.map(m =>
    `Account: ${m.accountLabel}\nID: ${m.id}\nFrom: ${m.from}\nSubject: ${m.subject}\nDate: ${m.date}\nSnippet: ${m.snippet}`
  ).join('\n\n---\n\n')
}
