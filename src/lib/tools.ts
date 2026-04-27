import { executeContentTool } from '@/lib/content-tools'
import { queryCapabilities, formatCapabilitySpec } from '@/lib/capability-layer'
import { loadConnections } from '@/lib/custom-connection-store'
import { getValidAccessTokenForAccount, isConfigured, listAccounts, loadTokens } from '@/lib/google-auth'
import { listEvents, searchEvents } from '@/lib/event-store'
import { EmailRouter } from '@/lib/email/router'
import { formatEmailMessages } from '@/lib/email/types'
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

const REMINDER_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'create_reminder',
      description: 'Create a new reminder with an optional recurrence. Use this when the user wants to be reminded about something on a specific date. For recurring tasks like bill payments, use recurrence:"monthly". Always populate sourceContext when the date was inferred from an email or other source.',
      parameters: {
        type: 'object',
        properties: {
          text:          { type: 'string', description: 'What to remind the user about' },
          dueDate:       { type: 'string', description: 'Due date in YYYY-MM-DD format' },
          recurrence:    { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'], description: 'How often to repeat after completion' },
          sourceContext: { type: 'string', description: 'Where this date came from, e.g. "found Discover payment on the 15th from email"' },
          tags:          { type: 'array', items: { type: 'string' }, description: 'Optional labels like ["finance","bills"]' },
        },
        required: ['text', 'dueDate'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_reminders',
      description: 'List the user\'s reminders. Use this when the user asks what reminders exist or what is coming up.',
      parameters: {
        type: 'object',
        properties: {
          includeCompleted: { type: 'boolean', description: 'Include completed reminders. Default false.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'complete_reminder',
      description: 'Mark a reminder as done. For recurring reminders, automatically schedules the next occurrence.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The reminder id from list_reminders' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_reminder',
      description: 'Permanently delete a reminder.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The reminder id from list_reminders' },
        },
        required: ['id'],
      },
    },
  },
]

export const TOOL_DEFINITIONS = [...GOOGLE_TOOL_DEFINITIONS, QUERY_EVENTS_DEFINITION, CREATE_WORKFLOW_DEFINITION, ASK_CLARIFICATION_DEFINITION, MEMORY_TOOL_DEFINITION, QUERY_CAPABILITIES_DEFINITION, WEB_SEARCH_DEFINITION, REQUEST_CONNECTION_DEFINITION, ...REMINDER_TOOL_DEFINITIONS]

// ─── Tool exposure ────────────────────────────────────────────────────────────

export function getAvailableTools() {
  const always  = [MEMORY_TOOL_DEFINITION, QUERY_EVENTS_DEFINITION, CREATE_WORKFLOW_DEFINITION, ASK_CLARIFICATION_DEFINITION, QUERY_CAPABILITIES_DEFINITION, WEB_SEARCH_DEFINITION, REQUEST_CONNECTION_DEFINITION, ...REMINDER_TOOL_DEFINITIONS]
  const google  = (isConfigured() && loadTokens()) ? GOOGLE_TOOL_DEFINITIONS : []
  return [...always, ...google]
}

// ─── Status labels ────────────────────────────────────────────────────────────

export function toolStatusLabel(name: string): string {
  const labels: Record<string, string> = {
    email_search:        'Checking email...',
    email_get:           'Reading email...',
    email_send:          'Sending email...',
    get_inbox:           'Checking email...',
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
    create_reminder:       'Setting reminder…',
    list_reminders:        'Fetching reminders…',
    complete_reminder:     'Completing reminder…',
    delete_reminder:       'Deleting reminder…',
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

function execEmailListAccounts(): string {
  const adapters = EmailRouter.getAdapters()
  if (!adapters.length) return 'No email accounts connected.'

  // Group by provider
  const byProvider = new Map<string, typeof adapters>()
  for (const a of adapters) {
    const list = byProvider.get(a.providerType) ?? []
    list.push(a)
    byProvider.set(a.providerType, list)
  }

  const lines: string[] = []
  for (const [provider, accs] of byProvider) {
    lines.push(`[${provider}]`)
    for (const a of accs) {
      const label = a.accountLabel !== a.accountEmail ? `${a.accountLabel} <${a.accountEmail}>` : a.accountEmail
      lines.push(`  - ${label}`)
    }
  }
  return lines.join('\n')
}

async function execEmailSearch(args: Record<string, unknown>): Promise<string> {
  const rawAccount = args.account ? String(args.account) : undefined
  const account = rawAccount === 'null' || rawAccount === 'undefined' ? undefined : rawAccount
  const adapters = EmailRouter.getAdapters(account)
  if (!adapters.length) {
    if (account) return `Error: no account matching "${account}". Check /integrations to see connected accounts.`
    return 'Error: No email accounts configured. Connect an account on the integrations page.'
  }
  const max = Math.min(Number(args.maxResults) || 10, 20)

  // Date filter: inject after:YYYY/MM/DD into every query when days is specified
  const days = args.days ? Math.min(Math.max(Number(args.days), 1), 3650) : null
  const afterClause = days
    ? (() => {
        const d = new Date(Date.now() - days * 86_400_000)
        return `after:${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
      })()
    : null

  // Support queries[] (fan-out) with fallback to single query
  const rawQueries: string[] = Array.isArray(args.queries) && args.queries.length > 0
    ? args.queries.map(String).filter(Boolean)
    : args.query ? [String(args.query)] : ['']
  const queries = afterClause
    ? rawQueries.map(q => q ? `${q} ${afterClause}` : afterClause)
    : rawQueries

  if (queries.length === 1) {
    const msgs = await EmailRouter.search(queries[0], max, account)
    return formatEmailMessages(msgs)
  }

  // Fan-out: run all queries in parallel, group results by bucket
  const settled = await Promise.allSettled(
    queries.map(q => EmailRouter.search(q, Math.min(max, 10), account))
  )

  const seen = new Set<string>()
  const sections: string[] = []
  for (let i = 0; i < queries.length; i++) {
    const r = settled[i]
    if (r.status === 'rejected') continue
    const unique = r.value.filter(m => !seen.has(m.id))
    unique.forEach(m => seen.add(m.id))
    if (unique.length > 0) sections.push(formatEmailMessages(unique))
  }
  return sections.join('\n\n---\n\n')
}

async function execEmailGet(args: Record<string, unknown>): Promise<string> {
  const id = String(args.id ?? '')
  if (!id) return 'Error: message id is required.'
  const account = args.account ? String(args.account) : undefined
  try {
    return await EmailRouter.get(id, account)
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : 'message not found'}`
  }
}

async function execEmailSend(args: Record<string, unknown>): Promise<string> {
  const to      = String(args.to      ?? '').trim()
  const subject = String(args.subject ?? '').replace(/[\r\n]/g, ' ').trim()
  const body    = String(args.body    ?? '')
  if (!to)      return 'Error: recipient address is required.'
  if (!subject) return 'Error: subject is required.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return 'Error: invalid recipient address.'
  const account  = args.account ? String(args.account) : undefined
  const adapters = EmailRouter.getAdapters(account)
  if (!adapters.length) {
    if (account) return `Error: no account matching "${account}".`
    return 'Error: No email accounts configured.'
  }
  try {
    await EmailRouter.send(to, subject, body, account)
    return `Email sent to ${to}.`
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : 'failed to send email'}`
  }
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

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function executeTool(name: string, rawArgs: unknown): Promise<string> {
  const args = parseArgs(rawArgs)
  try {
    switch (name) {
      case 'email_list_accounts':   return execEmailListAccounts()
      case 'email_search':          return await execEmailSearch(args)
      case 'email_get':             return await execEmailGet(args)
      case 'email_send':            return await execEmailSend(args)
      // backward compat for existing workflows
      case 'get_inbox':             return await execEmailSearch(args)
      case 'get_email_inbox':       return await execEmailSearch(args)
      case 'read_email':            return await execEmailGet(args)
      case 'send_email':
      case 'send_email_imap':       return await execEmailSend(args)
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
      case 'create_reminder': {
        const { createReminder } = await import('@/lib/reminder-store')
        const text = String(args.text ?? args.title ?? args.name ?? '').trim()
        if (!text) return 'Error: text is required'

        // Normalize date to YYYY-MM-DD — accept ISO timestamps, slash-separated, or partial dates
        const rawDate = String(args.dueDate ?? args.date ?? args.due_date ?? args.due ?? '').trim()
        let dueDate = ''
        if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
          dueDate = rawDate.slice(0, 10)  // strip time if present
        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(rawDate)) {
          const [y, m, d] = rawDate.split('/')
          dueDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
        } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) {
          const [m, d, y] = rawDate.split('/')
          dueDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
        } else {
          // Last resort: let Date parse it (handles "April 21, 2026" etc.)
          const parsed = new Date(rawDate)
          if (!isNaN(parsed.getTime())) {
            dueDate = parsed.toISOString().slice(0, 10)
          }
        }
        if (!dueDate) return `Error: could not parse dueDate "${rawDate}" — use YYYY-MM-DD`

        const r = createReminder({
          text,
          dueDate,
          recurrence: args.recurrence as import('@/lib/reminder-store').Reminder['recurrence'],
          sourceContext: args.sourceContext ? String(args.sourceContext) : undefined,
          tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        })
        return `Reminder created: "${r.text}" due ${r.dueDate}${r.recurrence ? `, repeating ${r.recurrence}` : ''}. ID: ${r.id}`
      }
      case 'list_reminders': {
        const { listReminders } = await import('@/lib/reminder-store')
        const reminders = listReminders({ includeCompleted: Boolean(args.includeCompleted) })
        if (!reminders.length) return 'No reminders found.'
        return reminders.map(r =>
          `[${r.id.slice(0, 8)}] ${r.text} — due ${r.dueDate}${r.recurrence ? ` (${r.recurrence})` : ''}${r.completedAt ? ' ✓' : ''}`
        ).join('\n')
      }
      case 'complete_reminder': {
        const { completeReminder } = await import('@/lib/reminder-store')
        const { updated, next } = completeReminder(String(args.id ?? ''))
        let msg = `Reminder "${updated.text}" marked complete.`
        if (next) msg += ` Next occurrence created for ${next.dueDate}.`
        return msg
      }
      case 'delete_reminder': {
        const { deleteReminder } = await import('@/lib/reminder-store')
        const ok = deleteReminder(String(args.id ?? ''))
        return ok ? 'Reminder deleted.' : 'Reminder not found.'
      }
      default:                      return `Error: unknown tool "${name}"`
    }
  } catch {
    return `Error: tool "${name}" failed. Please try again.`
  }
}
