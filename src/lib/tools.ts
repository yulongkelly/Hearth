import { getValidAccessToken, isConfigured, loadTokens } from '@/lib/google-auth'

// ─── Tool definitions (Ollama function-calling format) ────────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_inbox',
      description: 'List recent emails from the Gmail inbox. Returns sender, subject, snippet, and message id for each email.',
      parameters: {
        type: 'object',
        properties: {
          maxResults: {
            type: 'number',
            description: 'Number of emails to return. Default 10, max 20.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_email',
      description: 'Read the full body of a Gmail message by its id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The Gmail message id from get_inbox' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_calendar_events',
      description: 'List upcoming Google Calendar events starting from now.',
      parameters: {
        type: 'object',
        properties: {
          maxResults: {
            type: 'number',
            description: 'Number of events to return. Default 10.',
          },
        },
        required: [],
      },
    },
  },
]

// ─── Lazy tool exposure ───────────────────────────────────────────────────────

export function getAvailableTools(): typeof TOOL_DEFINITIONS | null {
  if (isConfigured() && loadTokens()) return TOOL_DEFINITIONS
  return null
}

// ─── Status labels ────────────────────────────────────────────────────────────

export function toolStatusLabel(name: string): string {
  const labels: Record<string, string> = {
    get_inbox: 'Checking Gmail...',
    read_email: 'Reading email...',
    get_calendar_events: 'Checking Calendar...',
  }
  return labels[name] ?? 'Using a tool...'
}

// ─── Argument repair ──────────────────────────────────────────────────────────

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch {}
    // Last resort: extract key:value pairs
    const out: Record<string, unknown> = {}
    const re = /"?(\w+)"?\s*:\s*"?([^",}]+)"?/g
    let match: RegExpExecArray | null
    while ((match = re.exec(raw)) !== null) {
      out[match[1]] = match[2].trim()
    }
    return out
  }
  return {}
}

// ─── Gmail body decoder ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeGmailBody(payload: any): string {
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
    // Recurse into nested multipart
    for (const part of payload.parts) {
      const body = decodeGmailBody(part)
      if (body) return body
    }
  }
  return ''
}

// ─── Executors ────────────────────────────────────────────────────────────────

async function execGetInbox(args: Record<string, unknown>): Promise<string> {
  const token = await getValidAccessToken()
  if (!token) return 'Error: Gmail not authenticated. Ask the user to reconnect on the integrations page.'

  const max = Math.min(Number(args.maxResults) || 10, 20)
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&labelIds=INBOX`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!listRes.ok) return `Error: Gmail API returned ${listRes.status}`

  const { messages = [] } = await listRes.json()
  if (messages.length === 0) return 'No messages found in inbox.'

  const details = await Promise.all(
    (messages as { id: string }[]).map(m =>
      fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then(r => r.json())
    )
  )

  return details.map(msg => {
    const h = (name: string) =>
      msg.payload?.headers?.find((x: { name: string }) => x.name === name)?.value ?? '(unknown)'
    return `ID: ${msg.id}\nFrom: ${h('From')}\nSubject: ${h('Subject')}\nDate: ${h('Date')}\nSnippet: ${msg.snippet ?? ''}`
  }).join('\n\n---\n\n')
}

async function execReadEmail(args: Record<string, unknown>): Promise<string> {
  const token = await getValidAccessToken()
  if (!token) return 'Error: Gmail not authenticated.'

  const id = String(args.id ?? '')
  if (!id) return 'Error: message id is required.'

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return `Error: Gmail API returned ${res.status}`

  const msg = await res.json()
  const h = (name: string) =>
    msg.payload?.headers?.find((x: { name: string }) => x.name === name)?.value ?? '(unknown)'

  const body = decodeGmailBody(msg.payload).slice(0, 8000)

  return `From: ${h('From')}\nSubject: ${h('Subject')}\nDate: ${h('Date')}\n\n${body || '(no readable body)'}`
}

async function execGetCalendarEvents(args: Record<string, unknown>): Promise<string> {
  const token = await getValidAccessToken()
  if (!token) return 'Error: Calendar not authenticated. Ask the user to reconnect on the integrations page.'

  const max = Math.min(Number(args.maxResults) || 10, 20)
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
  url.searchParams.set('timeMin', new Date().toISOString())
  url.searchParams.set('maxResults', String(max))
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return `Error: Calendar API returned ${res.status}`

  const { items = [] } = await res.json()
  if (items.length === 0) return 'No upcoming events found.'

  return items.map((evt: {
    summary?: string
    start?: { dateTime?: string; date?: string }
    end?: { dateTime?: string; date?: string }
    description?: string
  }) => {
    const start = evt.start?.dateTime ?? evt.start?.date ?? '(unknown)'
    const end   = evt.end?.dateTime   ?? evt.end?.date   ?? '(unknown)'
    const lines = [`Title: ${evt.summary ?? '(no title)'}`, `Start: ${start}`, `End: ${end}`]
    if (evt.description) lines.push(`Description: ${evt.description.slice(0, 200)}`)
    return lines.join('\n')
  }).join('\n\n---\n\n')
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function executeTool(name: string, rawArgs: unknown): Promise<string> {
  const args = parseArgs(rawArgs)
  try {
    switch (name) {
      case 'get_inbox':           return await execGetInbox(args)
      case 'read_email':          return await execReadEmail(args)
      case 'get_calendar_events': return await execGetCalendarEvents(args)
      default:                    return `Error: unknown tool "${name}"`
    }
  } catch (err) {
    return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`
  }
}
