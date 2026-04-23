import { getValidAccessTokenForAccount, isConfigured, listAccounts, loadTokens } from '@/lib/google-auth'
import { isConfigured as plaidConfigured, listItems, loadCredentials as loadPlaidCredentials, plaidBaseUrl } from '@/lib/plaid-auth'
import { listEvents, searchEvents } from '@/lib/event-store'
import type { HearthEvent } from '@/lib/event-store'
import { getBotState, sendWechatMessage } from '@/lib/wechat-bot'
import { queryMessages } from '@/lib/wechat-store'
import { getQqState, sendQqMessage } from '@/lib/qq-bot'
import { queryQqMessages } from '@/lib/qq-store'
import { getTelegramState, sendTelegramMessage } from '@/lib/telegram-bot'
import { queryTelegramMessages } from '@/lib/telegram-store'
import { getDiscordState, sendDiscordMessage } from '@/lib/discord-bot'
import { queryDiscordMessages } from '@/lib/discord-store'

// ─── Tool definitions (Ollama function-calling format) ────────────────────────

const CREATE_WORKFLOW_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'create_workflow',
    description: `Create a reusable workflow tool saved to the sidebar. Call ONLY after ask_clarification. ONLY use these exact step names — no others: get_calendar_events, get_inbox, read_email, get_transactions, merge_lists, detect_conflicts, filter_events, summarize. Output ONLY a valid JSON object. Max 8 steps.`,
    parameters: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Short tool name shown in sidebar' },
        description: { type: 'string', description: 'One sentence describing what this tool does' },
        icon:        { type: 'string', description: 'One of: Mail, Calendar, FileText, Search, BarChart, List' },
        goal:        { type: 'string', description: 'The user\'s goal in plain English' },
        parameters: {
          type: 'array',
          description: 'User inputs filled in before each run (e.g. date range, account). Omit if no user inputs needed.',
          items: {
            type: 'object',
            properties: {
              name:         { type: 'string', description: 'Key used in step params as {name}' },
              label:        { type: 'string', description: 'Human-readable label' },
              type:         { type: 'string', description: 'One of: text, date, number' },
              defaultValue: { type: 'string', description: 'Pre-filled default value' },
            },
            required: ['name', 'label', 'type'],
          },
        },
        steps: {
          type: 'array',
          description: 'Ordered list of steps. Use $outputVar to reference a previous step\'s output. Use {paramName} to reference a user parameter.',
          items: {
            type: 'object',
            properties: {
              id:     { type: 'string',  description: 'Unique step id, e.g. "step1"' },
              type:   { type: 'string',  description: '"tool" for API calls, "action" for in-process operations' },
              name:   { type: 'string',  description: 'Exact step name from the whitelist' },
              params: { type: 'object',  description: 'Step parameters. Values may be literals, $varName references, or {paramName} user inputs. For summarize steps you MUST include an "instruction" field that tells the LLM exactly how to map fields. For emails use: "For each email: headline=subject line, subtext=sender name from the From field, note=snippet, tags=account label plus 1-2 content keywords". For events use: "For each event: headline=title, subtext=date and time, tags=account label". Always include account as a tag so the source is visible.' },
              output: { type: 'string',  description: 'Variable name to store this step\'s output for downstream steps' },
            },
            required: ['id', 'type', 'name', 'params', 'output'],
          },
        },
      },
      required: ['name', 'description', 'icon', 'goal', 'steps'],
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
      name: 'send_email',
      description: 'Send an email via Gmail. ALWAYS call ask_clarification first to confirm recipient, subject, and body with the user before sending.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Recipient email address.',
          },
          subject: {
            type: 'string',
            description: 'Email subject line.',
          },
          body: {
            type: 'string',
            description: 'Email body in plain text.',
          },
          account: {
            type: 'string',
            description: 'Gmail account to send from. Omit to use the first connected account.',
          },
        },
        required: ['to', 'subject', 'body'],
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

const QUERY_EVENTS_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'query_events',
    description: 'Search past activity history to recall when tools were last used or what results they returned. Use for "when did I last...", "how often...", or "what was the result of..." questions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search for. Searches tool names, args, and result text.' },
        type:  { type: 'string', description: '"tool_call" or "workflow_run". Omit for both.' },
        days:  { type: 'number', description: 'How many days to look back. Default 30.' },
        limit: { type: 'number', description: 'Max events to return. Default 10, max 50.' },
      },
      required: [],
    },
  },
}

const PLAID_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_transactions',
      description: 'Get bank transaction history from any linked account. Use days=1 for "today", days=7 for "this week", etc. Supports filtering by institution name (e.g. "TD Bank", "Chase"). Returns date, amount, merchant, and category for each transaction.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'How many days back to look. Use 1 for today, 7 for this week, 30 for this month. Default 30, max 90.',
          },
          institution: {
            type: 'string',
            description: 'Bank name to filter by, e.g. "TD Bank". Omit to include all linked accounts.',
          },
        },
        required: [],
      },
    },
  },
]

const WECHAT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_wechat_messages',
      description: 'Read recent WeChat messages received while Hearth was running. Filter by contact name and/or number of days.',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: 'Contact display name to filter by. Omit to get all recent messages.' },
          days:    { type: 'number', description: 'How many days back to look. Default 7.' },
          limit:   { type: 'number', description: 'Max messages to return. Default 50.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_wechat_message',
      description: 'Send a WeChat message to a contact by their display name.',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: "The contact's WeChat display name." },
          message: { type: 'string', description: 'The message text to send.' },
        },
        required: ['contact', 'message'],
      },
    },
  },
]

const QQ_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_qq_messages',
      description: 'Read recent QQ messages received while Hearth was running. Filter by contact name or QQ number.',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: 'Contact nickname or QQ number to filter by. Omit for all recent messages.' },
          days:    { type: 'number', description: 'How many days back to look. Default 7.' },
          limit:   { type: 'number', description: 'Max messages to return. Default 50.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_qq_message',
      description: 'Send a QQ message to a contact or group by their QQ number.',
      parameters: {
        type: 'object',
        properties: {
          target:  { type: 'string', description: "The recipient's QQ number (for private) or group number." },
          message: { type: 'string', description: 'The message text to send.' },
        },
        required: ['target', 'message'],
      },
    },
  },
]

const TELEGRAM_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_telegram_messages',
      description: 'Read recent Telegram messages received by the bot while Hearth was running.',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: 'Username or name to filter by. Omit for all recent messages.' },
          days:    { type: 'number', description: 'How many days back to look. Default 7.' },
          limit:   { type: 'number', description: 'Max messages to return. Default 50.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_telegram_message',
      description: 'Send a Telegram message to a chat ID or @username.',
      parameters: {
        type: 'object',
        properties: {
          target:  { type: 'string', description: 'Chat ID (numeric) or @username of the recipient.' },
          message: { type: 'string', description: 'The message text to send.' },
        },
        required: ['target', 'message'],
      },
    },
  },
]

const DISCORD_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_discord_messages',
      description: 'Read recent Discord messages received by the bot while Hearth was running. Filter by user or channel.',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: 'Username to filter by. Omit for all recent messages.' },
          channel: { type: 'string', description: 'Channel name to filter by.' },
          days:    { type: 'number', description: 'How many days back to look. Default 7.' },
          limit:   { type: 'number', description: 'Max messages to return. Default 50.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_discord_message',
      description: 'Send a message to a Discord channel by channel ID or name.',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel ID or exact channel name.' },
          message: { type: 'string', description: 'The message text to send.' },
        },
        required: ['channel', 'message'],
      },
    },
  },
]

export const TOOL_DEFINITIONS = [...GOOGLE_TOOL_DEFINITIONS, ...PLAID_TOOL_DEFINITIONS, ...WECHAT_TOOL_DEFINITIONS, ...QQ_TOOL_DEFINITIONS, ...TELEGRAM_TOOL_DEFINITIONS, ...DISCORD_TOOL_DEFINITIONS, QUERY_EVENTS_DEFINITION, CREATE_WORKFLOW_DEFINITION, ASK_CLARIFICATION_DEFINITION, MEMORY_TOOL_DEFINITION]

// ─── Tool exposure ────────────────────────────────────────────────────────────

export function getAvailableTools() {
  const always  = [MEMORY_TOOL_DEFINITION, QUERY_EVENTS_DEFINITION, CREATE_WORKFLOW_DEFINITION, ASK_CLARIFICATION_DEFINITION]
  const google  = (isConfigured() && loadTokens()) ? GOOGLE_TOOL_DEFINITIONS : []
  const plaid   = (plaidConfigured() && listItems().length > 0) ? PLAID_TOOL_DEFINITIONS : []
  const wechat   = getBotState().status === 'connected'    ? WECHAT_TOOL_DEFINITIONS    : []
  const qq       = getQqState().status === 'connected'      ? QQ_TOOL_DEFINITIONS        : []
  const telegram = getTelegramState().status === 'connected' ? TELEGRAM_TOOL_DEFINITIONS : []
  const discord  = getDiscordState().status === 'connected'  ? DISCORD_TOOL_DEFINITIONS  : []
  return [...always, ...google, ...plaid, ...wechat, ...qq, ...telegram, ...discord]
}

// ─── Status labels ────────────────────────────────────────────────────────────

export function toolStatusLabel(name: string): string {
  const labels: Record<string, string> = {
    get_inbox:           'Checking Gmail...',
    read_email:          'Reading email...',
    send_email:          'Sending email...',
    get_calendar_events: 'Checking Calendar...',
    get_transactions:      'Fetching transactions...',
    query_events:          'Searching activity history...',
    get_wechat_messages:   'Reading WeChat messages...',
    send_wechat_message:   'Sending WeChat message...',
    get_qq_messages:       'Reading QQ messages...',
    send_qq_message:       'Sending QQ message...',
    get_telegram_messages: 'Reading Telegram messages...',
    send_telegram_message: 'Sending Telegram message...',
    get_discord_messages:  'Reading Discord messages...',
    send_discord_message:  'Sending Discord message...',
    create_workflow:       'Creating workflow...',
    memory:                'Updating memory…',
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
    return `Account: ${label}\nID: ${msg.id}\nFrom: ${h('From')}\nSubject: ${h('Subject')}\nDate: ${h('Date')}\nSnippet: ${msg.snippet ?? ''}`
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
        `Account: ${label}`,
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

async function execSendEmail(args: Record<string, unknown>): Promise<string> {
  const to      = String(args.to      ?? '').trim()
  const subject = String(args.subject ?? '').replace(/[\r\n]/g, ' ').trim()
  const body    = String(args.body    ?? '')

  if (!to)      return 'Error: recipient address is required.'
  if (!subject) return 'Error: subject is required.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return 'Error: invalid recipient address.'

  const emails = resolveAccount(args.account)
  if (!emails.length) {
    if (args.account) return `Error: no account matching "${args.account}".`
    return 'Error: Gmail not authenticated.'
  }

  const senderEmail = emails[0]
  const token = await getValidAccessTokenForAccount(senderEmail)
  if (!token) return `Error: could not authenticate ${senderEmail}.`

  const message = [
    `From: ${senderEmail}`,
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
    const detail = err?.error?.message ? `: ${err.error.message}` : ''
    return `Error: failed to send (${res.status}${detail}).`
  }

  return `Email sent to ${to}.`
}

function formatEvent(e: HearthEvent): string {
  const lines = [`Time: ${e.timestamp}`, `Type: ${e.type}`]
  if (e.tool)         lines.push(`Tool: ${e.tool}`)
  if (e.args)         lines.push(`Args: ${JSON.stringify(e.args)}`)
  if (e.result)       lines.push(`Result: ${e.result}`)
  if (e.workflowName) lines.push(`Workflow: ${e.workflowName}`)
  if (e.durationMs)   lines.push(`Duration: ${e.durationMs}ms`)
  return lines.join('\n')
}

function execQueryEvents(args: Record<string, unknown>): string {
  const query = args.query ? String(args.query) : null
  const type  = args.type  ? String(args.type)  : undefined
  const days  = Math.min(Number(args.days)  || 30, 90)
  const limit = Math.min(Number(args.limit) || 10, 50)

  const events = query
    ? searchEvents(query, { type, days, limit })
    : listEvents({ type, days, limit })

  if (!events.length) return 'No matching events found.'
  return events.map(formatEvent).join('\n\n---\n\n')
}

async function execGetTransactions(args: Record<string, unknown>): Promise<string> {
  const creds = loadPlaidCredentials()
  if (!creds) return 'Error: Plaid not configured. Ask the user to set up Plaid on the integrations page.'

  const days        = Math.min(Number(args.days) || 30, 90)
  const institution = args.institution ? String(args.institution).toLowerCase() : null
  let items         = listItems()
  if (!items.length) return 'Error: no bank accounts linked. Ask the user to connect an account on the integrations page.'
  if (institution) {
    items = items.filter(i => i.institutionName.toLowerCase().includes(institution))
    if (!items.length) return `Error: no linked institution matching "${args.institution}".`
  }

  const endDate   = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().split('T')[0]
  const base      = plaidBaseUrl(creds.env)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTransactions: any[] = []

  await Promise.all(items.map(async item => {
    const res = await fetch(`${base}/transactions/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    creds.clientId,
        secret:       creds.secret,
        access_token: item.accessToken,
        start_date:   startDate,
        end_date:     endDate,
        options:      { count: 100 },
      }),
    })
    if (!res.ok) return
    const data = await res.json()
    const accountMap = Object.fromEntries(item.accounts.map(a => [a.id, a]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const tx of (data.transactions ?? []) as any[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acct = accountMap[tx.account_id] as any
      allTransactions.push({
        institution:  item.institutionName,
        account:      acct ? `${acct.name} ****${acct.mask}` : tx.account_id,
        date:         tx.date,
        amount:       -tx.amount,
        name:         tx.name,
        merchantName: tx.merchant_name ?? null,
        category:     tx.category?.[0] ?? null,
        pending:      tx.pending,
      })
    }
  }))

  if (!allTransactions.length) return 'No transactions found for the specified period.'

  allTransactions.sort((a, b) => b.date.localeCompare(a.date))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return allTransactions.map((t: any) => [
    `Institution: ${t.institution}`,
    `Account: ${t.account}`,
    `Date: ${t.date}`,
    `Amount: ${t.amount >= 0 ? '+' : ''}${Number(t.amount).toFixed(2)}`,
    `Name: ${t.name}`,
    t.merchantName ? `Merchant: ${t.merchantName}` : null,
    t.category     ? `Category: ${t.category}`     : null,
    `Pending: ${t.pending}`,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n')
}

// ─── WeChat executors ─────────────────────────────────────────────────────────

function execGetWechatMessages(args: Record<string, unknown>): string {
  const contact = args.contact ? String(args.contact) : undefined
  const days    = Math.min(Number(args.days)  || 7,  90)
  const limit   = Math.min(Number(args.limit) || 50, 200)
  const messages = queryMessages({ contact, days, limit })
  if (!messages.length) return 'No WeChat messages found for the specified filters.'
  return messages.map(m => [
    `From: ${m.from}`,
    m.room ? `Group: ${m.room}` : null,
    `Time: ${m.timestamp}`,
    `Message: ${m.text}`,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n')
}

async function execSendWechatMessage(args: Record<string, unknown>): Promise<string> {
  const contact = String(args.contact ?? '')
  const message = String(args.message ?? '')
  if (!contact || !message) return 'Error: contact and message are required.'
  return sendWechatMessage(contact, message)
}

// ─── QQ executors ────────────────────────────────────────────────────────────

function execGetQqMessages(args: Record<string, unknown>): string {
  const contact = args.contact ? String(args.contact) : undefined
  const days    = Math.min(Number(args.days)  || 7,  90)
  const limit   = Math.min(Number(args.limit) || 50, 200)
  const messages = queryQqMessages({ contact, days, limit })
  if (!messages.length) return 'No QQ messages found for the specified filters.'
  return messages.map(m => [
    `From: ${m.from} (${m.uin})`,
    m.room ? `Group: ${m.room}` : null,
    `Time: ${m.timestamp}`,
    `Message: ${m.text}`,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n')
}

async function execSendQqMessage(args: Record<string, unknown>): Promise<string> {
  const target  = String(args.target  ?? '')
  const message = String(args.message ?? '')
  if (!target || !message) return 'Error: target and message are required.'
  return sendQqMessage(target, message)
}

// ─── Telegram executors ───────────────────────────────────────────────────────

function execGetTelegramMessages(args: Record<string, unknown>): string {
  const contact = args.contact ? String(args.contact) : undefined
  const days    = Math.min(Number(args.days)  || 7,  90)
  const limit   = Math.min(Number(args.limit) || 50, 200)
  const messages = queryTelegramMessages({ contact, days, limit })
  if (!messages.length) return 'No Telegram messages found for the specified filters.'
  return messages.map(m => [
    `From: ${m.from}`,
    m.chatTitle ? `Chat: ${m.chatTitle}` : `Chat ID: ${m.chatId}`,
    `Time: ${m.timestamp}`,
    `Message: ${m.text}`,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n')
}

async function execSendTelegramMessage(args: Record<string, unknown>): Promise<string> {
  const target  = String(args.target  ?? '')
  const message = String(args.message ?? '')
  if (!target || !message) return 'Error: target and message are required.'
  return sendTelegramMessage(target, message)
}

// ─── Discord executors ────────────────────────────────────────────────────────

function execGetDiscordMessages(args: Record<string, unknown>): string {
  const contact = args.contact ? String(args.contact) : undefined
  const channel = args.channel ? String(args.channel) : undefined
  const days    = Math.min(Number(args.days)  || 7,  90)
  const limit   = Math.min(Number(args.limit) || 50, 200)
  const messages = queryDiscordMessages({ contact, channel, days, limit })
  if (!messages.length) return 'No Discord messages found for the specified filters.'
  return messages.map(m => [
    `From: ${m.from}`,
    m.guild   ? `Server: ${m.guild}`   : null,
    m.channel ? `Channel: #${m.channel}` : null,
    `Time: ${m.timestamp}`,
    `Message: ${m.text}`,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n')
}

async function execSendDiscordMessage(args: Record<string, unknown>): Promise<string> {
  const channel = String(args.channel ?? '')
  const message = String(args.message ?? '')
  if (!channel || !message) return 'Error: channel and message are required.'
  return sendDiscordMessage(channel, message)
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function executeTool(name: string, rawArgs: unknown): Promise<string> {
  const args = parseArgs(rawArgs)
  try {
    switch (name) {
      case 'get_inbox':             return await execGetInbox(args)
      case 'read_email':            return await execReadEmail(args)
      case 'send_email':            return await execSendEmail(args)
      case 'get_calendar_events':   return await execGetCalendarEvents(args)
      case 'get_transactions':      return await execGetTransactions(args)
      case 'query_events':          return execQueryEvents(args)
      case 'get_wechat_messages':   return execGetWechatMessages(args)
      case 'send_wechat_message':   return await execSendWechatMessage(args)
      case 'get_qq_messages':       return execGetQqMessages(args)
      case 'send_qq_message':       return await execSendQqMessage(args)
      case 'get_telegram_messages': return execGetTelegramMessages(args)
      case 'send_telegram_message': return await execSendTelegramMessage(args)
      case 'get_discord_messages':  return execGetDiscordMessages(args)
      case 'send_discord_message':  return await execSendDiscordMessage(args)
      default:                      return `Error: unknown tool "${name}"`
    }
  } catch {
    return `Error: tool "${name}" failed. Please try again.`
  }
}
