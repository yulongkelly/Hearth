import path from 'path'
import os from 'os'
import { executeContentTool } from '@/lib/content-tools'
import { queryCapabilities, formatCapabilitySpec } from '@/lib/capability-layer'
import { loadConnections } from '@/lib/custom-connection-store'
import { getValidAccessTokenForAccount, isConfigured, listAccounts, loadTokens } from '@/lib/google-auth'
import { readEncrypted } from '@/lib/secure-storage'
import { listEvents, searchEvents } from '@/lib/event-store'
import type { HearthEvent } from '@/lib/event-store'
import { get as getAdapter, getConnected } from '@/lib/platform-registry'
import type { PlatformName } from '@/lib/platform-adapter'

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
WHEN NOT TO SAVE: task progress, session outcomes, completed TODOs, raw data dumps, which integrations or bots are connected (that is reflected in your available tools — if get_qq_messages is in your tool list, QQ is connected; no need to memorize it).

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
      description: 'List or search emails from Gmail. Returns sender, subject, snippet, and message id for each email. When multiple accounts are connected, omit account to check all of them.',
      parameters: {
        type: 'object',
        properties: {
          maxResults: {
            type: 'number',
            description: 'Number of emails to return per account. Default 10, max 20.',
          },
          query: {
            type: 'string',
            description: 'Gmail search query (supports full Gmail syntax: category:purchases, from:, subject:, after:, OR, etc.). When set, searches all mail instead of just the inbox.',
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

const QUERY_CAPABILITIES_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'query_capabilities',
    description: 'Query the local capability graph for a known service or device. Call this BEFORE web_search when the user wants to connect an external service. Returns auth requirements, credential fields, and available actions if the service is known.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Service name, e.g. "Spotify", "GitHub", "weather API"' },
      },
      required: ['query'],
    },
  },
}

const WEB_SEARCH_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Search the web for API documentation, developer guides, or credential setup instructions. Use this when a user wants to connect a service you need more information about.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "Roborock API developer credentials documentation"' },
      },
      required: ['query'],
    },
  },
}

const REQUEST_CONNECTION_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'request_connection',
    description: 'Show the user a credential setup form to connect a new API. Call this after web_search when you have enough info to guide the user. Include exact setup steps and a test URL to verify credentials.',
    parameters: {
      type: 'object',
      properties: {
        service:      { type: 'string', description: 'Service name shown to the user, e.g. "Roborock"' },
        instructions: { type: 'string', description: 'Step-by-step setup instructions in plain text. Where to get the credentials, what to enable, etc.' },
        links: {
          type: 'array',
          description: 'Helpful links (developer portal, docs)',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              url:   { type: 'string' },
            },
            required: ['label', 'url'],
          },
        },
        fields: {
          type: 'array',
          description: 'Credential fields the user must fill in',
          items: {
            type: 'object',
            properties: {
              name:        { type: 'string', description: 'Field key used in test_headers, e.g. "api_key"' },
              label:       { type: 'string', description: 'Human-readable label' },
              type:        { type: 'string', enum: ['text', 'password'], description: 'Use password for secrets' },
              placeholder: { type: 'string' },
            },
            required: ['name', 'label', 'type'],
          },
        },
        test_url:     { type: 'string', description: 'Endpoint to call to verify credentials. Omit if no simple test endpoint exists.' },
        test_method:  { type: 'string', description: 'HTTP method for test call, default GET' },
        test_headers: {
          type: 'object',
          description: 'Headers for test call. Use {field_name} to reference submitted credential values, e.g. {"Authorization": "Bearer {api_key}"}',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['service', 'instructions', 'fields'],
    },
  },
}

export const TOOL_DEFINITIONS = [...GOOGLE_TOOL_DEFINITIONS, QUERY_EVENTS_DEFINITION, CREATE_WORKFLOW_DEFINITION, ASK_CLARIFICATION_DEFINITION, MEMORY_TOOL_DEFINITION, QUERY_CAPABILITIES_DEFINITION, WEB_SEARCH_DEFINITION, REQUEST_CONNECTION_DEFINITION]

// ─── Tool exposure ────────────────────────────────────────────────────────────

export function getAvailableTools() {
  const always  = [MEMORY_TOOL_DEFINITION, QUERY_EVENTS_DEFINITION, CREATE_WORKFLOW_DEFINITION, ASK_CLARIFICATION_DEFINITION, QUERY_CAPABILITIES_DEFINITION, WEB_SEARCH_DEFINITION, REQUEST_CONNECTION_DEFINITION]
  const google  = (isConfigured() && loadTokens()) ? GOOGLE_TOOL_DEFINITIONS : []
  return [...always, ...google]
}

// ─── Status labels ────────────────────────────────────────────────────────────

export function toolStatusLabel(name: string): string {
  const labels: Record<string, string> = {
    get_inbox:           'Checking Gmail...',
    read_email:          'Reading email...',
    send_email:          'Sending email...',
    get_calendar_events: 'Checking Calendar...',
    query_events:          'Searching activity history...',
    create_workflow:       'Creating workflow...',
    memory:                'Updating memory…',
    query_capabilities:    'Looking up capability…',
    web_search:            'Searching the web…',
    request_connection:    'Setting up connection…',
    http_request:          'Calling API…',
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

async function fetchInboxForAccount(email: string, max: number, multiAccount: boolean, query?: string): Promise<string> {
  const token = await getValidAccessTokenForAccount(email)
  if (!token) return `Error: could not authenticate ${email}`

  const qs = query
    ? `maxResults=${max}&q=${encodeURIComponent(query)}`
    : `maxResults=${max}&labelIds=INBOX`
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`,
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
  const query = args.query ? String(args.query) : undefined
  const multiAccount = emails.length > 1
  const results = await Promise.all(emails.map(e => fetchInboxForAccount(e, max, multiAccount, query)))
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

// ─── Messaging executors ──────────────────────────────────────────────────────

function execGetMessages(platform: PlatformName, args: Record<string, unknown>): string {
  const adapter = getAdapter(platform)
  if (!adapter || adapter.getState().status !== 'connected') return `Error: ${platform} is not connected.`
  const contact = args.contact ? String(args.contact) : undefined
  const channel = args.channel ? String(args.channel) : undefined
  const days    = Math.min(Number(args.days)  || 7,  90)
  const limit   = Math.min(Number(args.limit) || 50, 200)
  const messages = adapter.queryMessages({ contact, channel, days, limit })
  if (!messages.length) return `No ${platform} messages found for the specified filters.`
  return messages.map(m => [
    `From: ${m.from}`,
    m.room ? `Group/Channel: ${m.room}` : null,
    `Time: ${m.timestamp}`,
    `Message: ${m.text}`,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n')
}

async function execSendMessage(platform: PlatformName, targetKey: string, args: Record<string, unknown>): Promise<string> {
  const target  = String(args[targetKey] ?? '')
  const message = String(args.message    ?? '')
  if (!target || !message) return `Error: ${targetKey} and message are required.`
  const adapter = getAdapter(platform)
  if (!adapter || adapter.getState().status !== 'connected') return `Error: ${platform} is not connected.`
  return adapter.send(target, message)
}

// ─── Capability layer ─────────────────────────────────────────────────────────

function execQueryCapabilities(args: Record<string, unknown>): string {
  const query = String(args.query ?? '').trim()
  if (!query) return 'Error: query is required'
  const spec = queryCapabilities(query)
  if (!spec) return `No capability found for "${query}". Use web_search to look up API documentation.`
  return formatCapabilitySpec(spec)
}

// ─── Web search ───────────────────────────────────────────────────────────────

async function execWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) return 'Error: query is required'
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const res = await fetch(url, { headers: { 'User-Agent': 'Hearth/1.0' } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any
  const parts: string[] = []
  if (data.AbstractText) parts.push(`Summary: ${data.AbstractText}\nSource: ${data.AbstractURL}`)
  const topics = (data.RelatedTopics ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((t: any) => t.Text && t.FirstURL)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .slice(0, 6).map((t: any) => `- ${t.Text}\n  URL: ${t.FirstURL}`)
  if (topics.length) parts.push('Related:\n' + topics.join('\n'))
  return parts.length > 0 ? parts.join('\n\n') : 'No results found. Try a more specific query.'
}

// ─── HTTP request (custom connections) ────────────────────────────────────────

async function execHttpRequest(args: Record<string, unknown>): Promise<string> {
  const urlArg     = String(args.url ?? '')
  const method     = String(args.method ?? 'GET').toUpperCase()
  const connection = args.connection ? String(args.connection) : undefined
  const bodyArg    = args.body ? String(args.body) : undefined
  const extraHdrs  = (typeof args.headers === 'object' && args.headers !== null)
    ? args.headers as Record<string, string> : {}

  let finalUrl = urlArg
  const headers: Record<string, string> = { ...extraHdrs }

  if (connection) {
    const conn = loadConnections().find(
      c => c.service.toLowerCase() === connection.toLowerCase()
    )
    if (!conn) return `Error: No connection named "${connection}" found. Add it via chat first.`
    if (!finalUrl.startsWith('http')) {
      const base = (conn.testUrl ?? '').replace(/\/[^/]*$/, '')
      finalUrl = base ? base + '/' + finalUrl.replace(/^\//, '') : finalUrl
    }
    if (conn.authTemplate) {
      headers['Authorization'] = conn.authTemplate.replace(
        /\{(\w+)\}/g, (_, k) => String(conn.credentials[k] ?? '')
      )
    }
  }

  if (!finalUrl.startsWith('http')) return `Error: url must be a full URL or use connection: "<name>"`

  const fetchOpts: RequestInit = { method, headers }
  if (bodyArg && method !== 'GET') {
    fetchOpts.body = bodyArg
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(finalUrl, fetchOpts)
  const text = await res.text()
  return text.length > 4000 ? text.slice(0, 4000) + '\n…(truncated)' : text
}

// ─── IMAP get_email_inbox ─────────────────────────────────────────────────────

// Compile a Gmail-style query string to an ImapFlow SearchObject.
// Handles: category:purchases expansion, from:/after:/before: operators,
// subject:(...) flattening, OR terms, and strips unsupported Gmail operators.
export function compileQueryToImap(query: string): object {
  let q = query
    // Expand Gmail purchase category to universal keywords
    .replace(/\bcategory:purchases?\b/gi, 'receipt OR invoice OR order')
    // Strip unsupported Gmail-only operators (has:, label:, is:, in:, category:)
    .replace(/\b(?:has|label|is|in|category):\S+/gi, '')

  const fromMatch = q.match(/\bfrom:(\S+)/i)
  const fromVal   = fromMatch?.[1]
  if (fromMatch) q = q.replace(fromMatch[0], '')

  const afterMatch = q.match(/\bafter:(\d{4}\/\d{2}\/\d{2})/i)
  const afterVal   = afterMatch?.[1]
  if (afterMatch) q = q.replace(afterMatch[0], '')

  const beforeMatch = q.match(/\bbefore:(\d{4}\/\d{2}\/\d{2})/i)
  const beforeVal   = beforeMatch?.[1]
  if (beforeMatch) q = q.replace(beforeMatch[0], '')

  // Unwrap subject:(...) and subject:word to plain terms
  q = q.replace(/\bsubject:\(([^)]+)\)/gi, '$1').replace(/\bsubject:(\S+)/gi, '$1')

  const terms = q.split(/ OR /i).map(t => t.trim().replace(/[()'"]/g, '')).filter(Boolean)

  const base: Record<string, unknown> = {}
  if (fromVal)  base.from   = fromVal
  if (afterVal) base.since  = new Date(afterVal.replace(/\//g, '-'))
  if (beforeVal) base.before = new Date(beforeVal.replace(/\//g, '-'))

  if (terms.length === 0) return base
  if (terms.length === 1) return { ...base, text: terms[0] }
  return { ...base, or: terms.map(t => ({ text: t })) as [object, object, ...object[]] }
}

async function execGetEmailInbox(args: Record<string, unknown>): Promise<string> {
  const HEARTH_DIR = path.join(os.homedir(), '.hearth')
  const cfg = readEncrypted<{ email: string; password: string }>(path.join(HEARTH_DIR, 'email-config.json'))
  if (!cfg) return 'Error: IMAP email not configured. Connect an email account on the integrations page.'

  const max = Math.min(Number(args.maxResults) || 10, 20)
  const queryStr = args.query ? String(args.query) : undefined

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImapFlow } = require('imapflow') as typeof import('imapflow')
  const provider = (() => {
    const domain = cfg.email.split('@')[1]?.toLowerCase() ?? ''
    const MAP: Record<string, [string, number]> = {
      'gmail.com': ['imap.gmail.com', 993], 'googlemail.com': ['imap.gmail.com', 993],
      'outlook.com': ['outlook.office365.com', 993], 'hotmail.com': ['outlook.office365.com', 993],
      'live.com': ['outlook.office365.com', 993], 'yahoo.com': ['imap.mail.yahoo.com', 993],
      'icloud.com': ['imap.mail.me.com', 993], 'me.com': ['imap.mail.me.com', 993],
    }
    return MAP[domain] ?? [`imap.${domain}`, 993] as [string, number]
  })()

  const client = new ImapFlow({
    host: provider[0], port: provider[1], secure: true,
    auth: { user: cfg.email, pass: cfg.password }, logger: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    const msgs: string[] = []
    try {
      let fetchRange = `1:${max}`
      if (queryStr) {
        const criteria = compileQueryToImap(queryStr)
        const found = await client.search(criteria as Parameters<typeof client.search>[0])
        const foundList = Array.isArray(found) ? found : []
        if (!foundList.length) { lock.release(); await client.logout(); return 'No matching emails found.' }
        fetchRange = foundList.slice(-max).join(',')
      }
      for await (const msg of client.fetch(fetchRange, { envelope: true })) {
        const from    = msg.envelope?.from?.[0]?.address ?? 'unknown'
        const subject = msg.envelope?.subject ?? '(no subject)'
        const date    = (msg.envelope?.date ?? new Date()).toISOString().slice(0, 10)
        msgs.push(`Account: ${cfg.email}\nID: ${msg.uid}\nFrom: ${from}\nSubject: ${subject}\nDate: ${date}`)
        if (msgs.length >= max) break
      }
    } finally {
      lock.release()
    }
    await client.logout()
    return msgs.length ? msgs.join('\n\n---\n\n') : 'No messages found in inbox.'
  } catch (err) {
    return `Error: IMAP fetch failed — ${err instanceof Error ? err.message : 'unknown error'}`
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function executeTool(name: string, rawArgs: unknown): Promise<string> {
  const args = parseArgs(rawArgs)
  try {
    switch (name) {
      case 'get_inbox':             return await execGetInbox(args)
      case 'get_email_inbox':       return await execGetEmailInbox(args)
      case 'read_email':            return await execReadEmail(args)
      case 'send_email':            return await execSendEmail(args)
      case 'get_calendar_events':   return await execGetCalendarEvents(args)
      case 'query_events':          return execQueryEvents(args)
      case 'query_capabilities':    return execQueryCapabilities(args)
      case 'web_search':            return await execWebSearch(args)
      case 'http_request':          return await execHttpRequest(args)
      case 'content_parse_html':
      case 'content_extract_text':
      case 'content_detect_receipt':
      case 'content_detect_order':
      case 'content_detect_subscription':
      case 'content_classify':
      case 'content_extract_structured':
      case 'content_parse_receipt':
      case 'content_parse_travel':
      case 'content_parse_email_to_event': return await executeContentTool(name, args)
      default:                      return `Error: unknown tool "${name}"`
    }
  } catch {
    return `Error: tool "${name}" failed. Please try again.`
  }
}
