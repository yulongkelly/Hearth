import { getValidAccessTokenForAccount, isConfigured, listAccounts, loadTokens } from '@/lib/google-auth'

// ─── Tool definitions (Ollama function-calling format) ────────────────────────

const CREATE_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'create_tool',
    description: 'Save a reusable tool to the user sidebar. Call ONLY after asking 1-2 clarifying questions to understand the exact requirement. Each tool must have exactly ONE core functionality. If the user asks for something that serves multiple goals, list those goals, explain the single-responsibility rule, and suggest creating separate tools.',
    parameters: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Short tool name shown in sidebar (e.g. "Summarize emails by date")' },
        description: { type: 'string', description: 'One sentence describing what this tool does' },
        icon:        { type: 'string', description: 'One of: Mail, Calendar, FileText, Search, BarChart, List' },
        parameters: {
          type: 'array',
          description: 'Input parameters the user fills in before each run',
          items: {
            type: 'object',
            properties: {
              name:  { type: 'string', description: 'Parameter key used in prompt template (no spaces)' },
              label: { type: 'string', description: 'Human-readable label shown in the form' },
              type:  { type: 'string', description: 'One of: text, date, number' },
            },
          },
        },
        prompt: { type: 'string', description: 'Prompt template with {paramName} placeholders that will be sent to the AI when the tool runs' },
      },
      required: ['name', 'description', 'icon', 'parameters', 'prompt'],
    },
  },
}

const MEMORY_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'memory',
    description: `Manage your persistent memory across sessions. Use this to remember facts about the user and your environment.

WHEN TO SAVE: user states a preference or habit, corrects you, shares personal details (name, role, timezone, tech stack), you learn a project convention or API quirk.
WHEN NOT TO SAVE: task progress, session outcomes, completed TODOs, raw data dumps.

Proactively save useful facts — do not wait to be asked.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'replace', 'remove', 'read'],
          description: 'add: append new entry. replace: update existing entry. remove: delete entry. read: view current memory.',
        },
        target: {
          type: 'string',
          enum: ['memory', 'user'],
          description: 'memory = agent facts, conventions, environment. user = personal profile, preferences, communication style.',
        },
        content: {
          type: 'string',
          description: 'New entry to add, or replacement text for replace action.',
        },
        old_content: {
          type: 'string',
          description: 'For replace/remove: the existing text to match (substring match).',
        },
      },
      required: ['action', 'target'],
    },
  },
}

const ASK_CLARIFICATION_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'ask_clarification',
    description: 'Ask the user clarifying questions using a structured popup UI with clickable options. ALWAYS use this instead of writing questions as plain text in the chat. Max 3 questions, each with 2–4 options the user can pick from.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '1–3 questions to show the user, each with selectable options',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question to ask' },
              options:  { type: 'array', items: { type: 'string' }, description: '2–4 answer options to choose from' },
            },
            required: ['question', 'options'],
          },
        },
      },
      required: ['questions'],
    },
  },
}

const GOOGLE_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_inbox',
      description: 'List recent emails from the Gmail inbox. Returns sender, subject, snippet, and message id for each email. When multiple accounts are connected, omit account to check all of them.',
      parameters: {
        type: 'object',
        properties: {
          maxResults: {
            type: 'number',
            description: 'Number of emails to return per account. Default 10, max 20.',
          },
          account: {
            type: 'string',
            description: 'Email address or nickname of the account to check (e.g. "work" or "me@gmail.com"). Omit to check all connected accounts.',
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
          account: {
            type: 'string',
            description: 'Email address or nickname of the account the message belongs to. Pass the same account value shown in get_inbox results.',
          },
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
            description: 'Number of events to return per account. Default 10.',
          },
          account: {
            type: 'string',
            description: 'Email address or nickname of the account to check. Omit to check all connected accounts.',
          },
        },
        required: [],
      },
    },
  },
]

export const TOOL_DEFINITIONS = [...GOOGLE_TOOL_DEFINITIONS, CREATE_TOOL_DEFINITION, ASK_CLARIFICATION_DEFINITION, MEMORY_TOOL_DEFINITION]

// ─── Tool exposure — memory + create_tool + ask_clarification always; Google tools when connected ─

export function getAvailableTools() {
  const always = [MEMORY_TOOL_DEFINITION, CREATE_TOOL_DEFINITION, ASK_CLARIFICATION_DEFINITION] as const
  if (isConfigured() && loadTokens()) return TOOL_DEFINITIONS
  return always
}

// ─── Status labels ────────────────────────────────────────────────────────────

export function toolStatusLabel(name: string): string {
  const labels: Record<string, string> = {
    get_inbox: 'Checking Gmail...',
    read_email: 'Reading email...',
    get_calendar_events: 'Checking Calendar...',
    create_tool: 'Creating tool...',
    memory: 'Updating memory…',
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
    // Recurse into nested multipart
    for (const part of payload.parts) {
      const body = decodeGmailBody(part, depth + 1)
      if (body) return body
    }
  }
  return ''
}

// ─── Account resolution ───────────────────────────────────────────────────────

function resolveAccount(accountArg: unknown): string[] {
  const accounts = listAccounts()
  if (!accounts.length) return []
  if (!accountArg) return accounts.map(a => a.email)
  const query = String(accountArg).toLowerCase().trim()
  const match = accounts.find(
    a => a.email.toLowerCase() === query || (a.nickname ?? '').toLowerCase() === query
  )
  return match ? [match.email] : []
}

function accountLabel(email: string): string {
  const accounts = listAccounts()
  const acc = accounts.find(a => a.email === email)
  return acc?.nickname ? acc.nickname : email
}

// ─── Executors ────────────────────────────────────────────────────────────────

async function fetchInboxForAccount(email: string, max: number, multiAccount: boolean): Promise<string> {
  const token = await getValidAccessTokenForAccount(email)
  if (!token) return `Error: could not authenticate ${email}`

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&labelIds=INBOX`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!listRes.ok) return `Error: Gmail API returned ${listRes.status} for ${email}`

  const { messages = [] } = await listRes.json()
  if (messages.length === 0) return multiAccount ? `No messages in ${accountLabel(email)}.` : 'No messages found in inbox.'

  const details = await Promise.all(
    (messages as { id: string }[]).map(m =>
      fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then(r => r.json())
    )
  )

  const label = accountLabel(email)
  return details.map(msg => {
    const h = (name: string) =>
      msg.payload?.headers?.find((x: { name: string }) => x.name === name)?.value ?? '(unknown)'
    const accountLine = multiAccount ? `Account: ${label}\n` : ''
    return `${accountLine}ID: ${msg.id}\nFrom: ${h('From')}\nSubject: ${h('Subject')}\nDate: ${h('Date')}\nSnippet: ${msg.snippet ?? ''}`
  }).join('\n\n---\n\n')
}

async function execGetInbox(args: Record<string, unknown>): Promise<string> {
  const emails = resolveAccount(args.account)
  if (!emails.length) {
    if (args.account) return `Error: no account matching "${args.account}". Check /integrations to see connected accounts.`
    return 'Error: Gmail not authenticated. Ask the user to connect an account on the integrations page.'
  }

  const max = Math.min(Number(args.maxResults) || 10, 20)
  const multiAccount = emails.length > 1
  const results = await Promise.all(emails.map(e => fetchInboxForAccount(e, max, multiAccount)))
  return results.join('\n\n===\n\n')
}

async function execReadEmail(args: Record<string, unknown>): Promise<string> {
  const id = String(args.id ?? '')
  if (!id) return 'Error: message id is required.'
  if (!/^[a-zA-Z0-9]+$/.test(id)) return 'Error: invalid message id.'

  const emails = resolveAccount(args.account)
  if (!emails.length) {
    if (args.account) return `Error: no account matching "${args.account}".`
    return 'Error: Gmail not authenticated.'
  }

  for (const email of emails) {
    const token = await getValidAccessTokenForAccount(email)
    if (!token) continue

    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) continue

    const msg = await res.json()
    const h = (name: string) =>
      msg.payload?.headers?.find((x: { name: string }) => x.name === name)?.value ?? '(unknown)'
    const body = decodeGmailBody(msg.payload).slice(0, 8000)
    return `From: ${h('From')}\nSubject: ${h('Subject')}\nDate: ${h('Date')}\n\n${body || '(no readable body)'}`
  }

  return 'Error: message not found.'
}

async function execGetCalendarEvents(args: Record<string, unknown>): Promise<string> {
  const emails = resolveAccount(args.account)
  if (!emails.length) {
    if (args.account) return `Error: no account matching "${args.account}".`
    return 'Error: Calendar not authenticated. Ask the user to reconnect on the integrations page.'
  }

  const max = Math.min(Number(args.maxResults) || 10, 20)
  const multiAccount = emails.length > 1

  const fetchForAccount = async (email: string): Promise<string> => {
    const token = await getValidAccessTokenForAccount(email)
    if (!token) return `Error: could not authenticate ${email}`

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    url.searchParams.set('timeMin', new Date().toISOString())
    url.searchParams.set('maxResults', String(max))
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return `Error: Calendar API returned ${res.status}`

    const { items = [] } = await res.json()
    if (items.length === 0) return multiAccount ? `No upcoming events for ${accountLabel(email)}.` : 'No upcoming events found.'

    const label = accountLabel(email)
    return items.map((evt: {
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      description?: string
    }) => {
      const start = evt.start?.dateTime ?? evt.start?.date ?? '(unknown)'
      const end   = evt.end?.dateTime   ?? evt.end?.date   ?? '(unknown)'
      const lines = [
        ...(multiAccount ? [`Account: ${label}`] : []),
        `Title: ${evt.summary ?? '(no title)'}`,
        `Start: ${start}`,
        `End: ${end}`,
      ]
      if (evt.description) lines.push(`Description: ${evt.description.slice(0, 200)}`)
      return lines.join('\n')
    }).join('\n\n---\n\n')
  }

  const results = await Promise.all(emails.map(fetchForAccount))
  return results.join('\n\n===\n\n')
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
  } catch {
    return `Error: tool "${name}" failed. Please try again.`
  }
}
