import { GmailAdapter } from './gmail-adapter'
import { OutlookAdapter } from './outlook-adapter'
import { ImapAdapter } from './imap-adapter'
import type { EmailAdapter, EmailMessage } from './types'
import { isConfigured as gmailConfigured, listAccounts as gmailListAccounts, loadTokens } from '../google-auth'
import { isConfigured as outlookConfigured, listAccounts as outlookListAccounts } from '../microsoft-auth'

function buildAdapters(): EmailAdapter[] {
  const adapters: EmailAdapter[] = []

  if (gmailConfigured() && loadTokens()) {
    for (const acc of gmailListAccounts()) {
      adapters.push(new GmailAdapter(acc.email, acc.nickname ?? undefined))
    }
  }

  if (outlookConfigured()) {
    for (const acc of outlookListAccounts()) {
      adapters.push(new OutlookAdapter(acc.email, acc.nickname ?? undefined))
    }
  }

  for (const adapter of ImapAdapter.loadConfigured()) {
    adapters.push(adapter)
  }

  return adapters
}

function matchAdapters(adapters: EmailAdapter[], hint: string): EmailAdapter[] {
  const lower = hint.toLowerCase()
  return adapters.filter(a => {
    const email = a.accountEmail.toLowerCase()
    const label = a.accountLabel.toLowerCase()
    if (email.includes(lower) || lower.includes(email)) return true
    if (label.includes(lower) || lower.includes(label)) return true
    if (a.providerType === lower) return true
    // Allow matching by email domain keyword: "qq" matches *@qq.com, "icloud" matches *@icloud.com
    const domain = a.accountEmail.split('@')[1]?.toLowerCase() ?? ''
    if (domain.includes(lower)) return true
    return false
  })
}

export class EmailRouter {
  static getAdapters(accountHint?: string): EmailAdapter[] {
    const all = buildAdapters()
    if (!accountHint) return all
    return matchAdapters(all, accountHint)
  }

  static async search(query: string, max: number, account?: string): Promise<EmailMessage[]> {
    const adapters = EmailRouter.getAdapters(account)
    if (!adapters.length) return []

    const results = await Promise.allSettled(adapters.map(a => a.search(query, max)))
    const msgs: EmailMessage[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') msgs.push(...r.value)
    }
    msgs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return msgs.slice(0, max)
  }

  static async get(id: string, account?: string): Promise<string> {
    const adapters = EmailRouter.getAdapters(account)
    for (const adapter of adapters) {
      try {
        const result = await adapter.get(id)
        if (result) return result
      } catch {}
    }
    throw new Error('message not found in any configured account')
  }

  static async send(to: string, subject: string, body: string, account?: string): Promise<void> {
    const adapters = EmailRouter.getAdapters(account)
    if (!adapters.length) throw new Error('no email account configured')
    await adapters[0].send(to, subject, body)
  }
}
