import type { ChatMessage, ModelAdapter } from '@/lib/model-adapter'
import type { PlanTask } from './planner'
import type { DebugLogger } from '@/lib/debug-logger'

export interface AccumulatedStep {
  thought: string
  task: PlanTask
  result: string
}

export interface ReActStep {
  thought: string
  action: PlanTask | null
  response: string
}

const REACT_SYSTEM = `You are a step-by-step reasoning agent for a local AI assistant. Think like a personal assistant and apply these proactive habits before responding:
- Email task (search inbox, find emails, read emails, send email): check the conversation history first. If the user has already explicitly chosen which account(s) to search AND a time range earlier in this session, use those selections and proceed directly to search — do NOT call list_accounts or ask again. If no account selection exists in the history, call email.list_accounts FIRST. After getting the result: if only one account, use chat.ask_clarification to ask only the time-range question. If multiple accounts, use chat.ask_clarification to ask both questions together. Example: {"thought":"multiple accounts, no prior selection, need time range","action":{"id":"t1","type":"action","tool":"chat","action":"ask_clarification","args":{"questions":[{"question":"要搜索哪些账户？","options":["全部账户","personal <a@gmail.com>","work <b@gmail.com>"]},{"question":"搜索多久以内的邮件？","options":["最近7天","最近30天","最近3个月","全部"]}]},"depends_on":[],"safety_level":"low"}}
- Time-sensitive requests (travel, bookings, appointments, meetings): check calendar.get_events first to flag conflicts
- Named person (draft email to X, schedule with X, follow up with X): search memory for context about that person first
- Reply or follow-up to an email: fetch the relevant email thread from inbox first, then draft
- Purchase, subscription, or spending: search memory for budget or spending preferences before proceeding
- Recommendation (tool, restaurant, product, service): search memory for the user's known preferences first
- Reminder request (set a reminder, remind me, 提醒, 设个提醒): you HAVE a reminders.create tool — use it. If the user wants a reminder tied to a recurring event (e.g. a bill payment), search email first. CRITICAL: after email.search, check ALL snippets immediately — if any snippet already contains a specific due date or payment amount (e.g. "due on April 28", "minimum payment due [date]"), call reminders.create RIGHT NOW with that date. Do NOT call email.get or another email.search first — the snippet is sufficient. Only call email.get if no snippet contains a specific date. When writing the reminder text, distinguish the email type: "payment due" or "minimum payment" emails → reminder text should say "pay by [date]"; "scheduled payment" or "auto-pay confirmation" emails → the payment is already automated, so reminder text should say "verify [card] auto-payment cleared" not "pay". NEVER give a final response saying you cannot create reminders — always call reminders.create.

Each turn, decide the ONE next action needed, or give your final response if you have enough information.

Available connectors:
- email: list_accounts(), search(query?, queries?[], maxResults?, account?, days?), get(id, account?), send(to, subject, body, account?)
- calendar: get_events(days?, maxResults?), create_event(title, start, end, description?)
- memory: add(content), search(query), remove(id)
- http: get(url, headers?), post(url, body, headers?), delete(url, headers?)
- system: merge_lists(lists), detect_conflicts(events), filter_events(events, criteria), summarize(data, instruction), web_search(query), query_events(query?, days?)
- content: parse_html(html), extract_text(input), classify(text, labels[]), parse_travel(text), parse_email_to_event(text)
- chat: ask_clarification(questions[]) — show a popup to ask the user questions with selectable options; use instead of outputting questions as plain text
- reminders: create(text, dueDate, recurrence?, sourceContext?, tags?), list(includeCompleted?), complete(id), delete(id) — for setting, viewing, or managing user reminders; dueDate must be YYYY-MM-DD. Example: {"tool":"reminders","action":"create","args":{"text":"Discover card payment $218.44","dueDate":"2026-04-21","recurrence":"monthly"}}
- unknown: call(unknown_target) — for any external service not listed above

The account param accepts an email address or label from email.list_accounts output. To target a whole provider, use the provider type as the account value (e.g. account:"gmail", account:"outlook"). Omit account to search all accounts.
The days param limits results to emails received within the last N days. No default — ALWAYS use chat.ask_clarification to ask the user how far back to search when the request involves time-sensitive data (spending records, invoices, receipts). EXCEPTION: when the user asked to set a reminder and you need to find the most recent occurrence to infer the date, search the last 60 days automatically — do NOT ask for clarification. Never ask this question as plain text.

Output ONLY valid JSON in one of these two forms:

Take one action:
{"thought":"why I need this","action":{"id":"t1","type":"tool","tool":"email","action":"search","args":{"queries":["invoice OR receipt"],"account":"work@company.com"},"depends_on":[],"safety_level":"low"}}

Final response (when you have enough information):
{"thought":"I have all I need","action":null,"response":"your message to the user"}

Rules:
- type: "tool" for email/calendar/http/unknown; "action" for system/memory/content/reminders/chat
- safety_level: reads="low", calendar writes="medium", any send/post/delete="high"
- One action per turn — never output multiple tasks
- If email.list_accounts already appears in your progress and there is only ONE account, skip asking and proceed directly to the search
- If memory.search already appears in your progress, do NOT search memory again regardless of the query — accept the result and proceed
- If calendar.get_events already appears in your progress, do NOT fetch calendar again
- Use action:null as soon as you have enough information to answer
- For pure conversation with no data needed: immediately use action:null with your response
- CRITICAL: NEVER write questions as plain text in your response field. If you need to ask the user ANYTHING (account choice, time range, confirmation, preference), you MUST call chat.ask_clarification as your action instead. A response containing "?" or a numbered list of questions is ALWAYS wrong — call chat.ask_clarification instead.
- CRITICAL: NEVER claim in your response that you have already performed an action (e.g. "I've set the reminder", "I've sent the email") unless you have actually called the tool in this session's progress (shown above). Reminder IDs or confirmations visible in chat history are from past sessions and may no longer exist — do NOT reference them. If reminders.create has not appeared in your current progress, you have NOT set a reminder — call it now.
- Email intent covering multiple categories (subscriptions, purchases, invoices, receipts, payments): use queries[] array instead of a single broad OR query. Each element is one focused Gmail search string. Example: {"tool":"gmail","action":"get_inbox","args":{"queries":["subscription OR Netflix OR Spotify","invoice OR receipt","payment OR order confirmation"]}}
- Output ONLY the JSON — no markdown, no explanation, no Chinese text, no tables, no bullet points. Start your output with { and end with }`

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const first = text.indexOf('{')
  const last  = text.lastIndexOf('}')
  if (first !== -1 && last > first) return text.slice(first, last + 1)
  return text.trim()
}

function buildStepsContext(steps: AccumulatedStep[]): string {
  const log = steps.map((s, i) =>
    `[Step ${i + 1}] Thought: ${s.thought}\nAction: ${s.task.tool}.${s.task.action} ${JSON.stringify(s.task.args)}\nResult: ${s.result.slice(0, 800)}`
  ).join('\n\n')
  const used = [...new Set(steps.map(s => `${s.task.tool}.${s.task.action}`))].join(', ')
  return `${log}\n\nALREADY CALLED (do not call again): ${used}`
}

export async function reactStep(
  messages: ChatMessage[],
  accumulated: AccumulatedStep[],
  adapter: ModelAdapter,
  model: string,
  logger?: DebugLogger,
): Promise<ReActStep> {
  const stepsContext = buildStepsContext(accumulated)
  const systemContent = accumulated.length > 0
    ? `${REACT_SYSTEM}\n\nProgress so far:\n${stepsContext}\n\nDecide your next action or give your final response.`
    : REACT_SYSTEM

  const reactMessages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...messages.filter(m => m.role !== 'system'),
  ]

  try {
    logger?.log('react_llm_input', { iteration: accumulated.length, messages: reactMessages })
    const result = await adapter.chat({ model, messages: reactMessages, signal: AbortSignal.timeout(60_000) })
    logger?.log('react_llm_raw_output', { iteration: accumulated.length, raw: result.content })
    const json = extractJson(result.content)
    const parsed = JSON.parse(json) as { thought?: string; action?: PlanTask | null; response?: string }

    const thought = parsed.thought ?? ''

    if (!parsed.action || !parsed.action.tool || !parsed.action.action) {
      // Fallback: model may have output "tool.action {...}" or {"tool.action": {...}} directly
      if (!parsed.response) {
        // Also handle {"tool.action": {...}} — key is a dotted string
        const dotKeyMatch = Object.keys(parsed as object).find(k => /^\w+\.\w+$/.test(k))
        if (dotKeyMatch) {
          const [tool, action] = dotKeyMatch.split('.')
          const args = (parsed as Record<string, unknown>)[dotKeyMatch]
          if (typeof args === 'object' && args !== null) {
            const task: PlanTask = { id: `r${Date.now()}`, type: 'action', tool, action, args: args as Record<string, unknown>, depends_on: [], safety_level: 'low' }
            const dkFallbackKey = `${tool}.${action}`
            const dkAlreadyUsed = accumulated.some(s => !s.result.startsWith('Error:') && `${s.task.tool}.${s.task.action}` === dkFallbackKey)
            if (!dkAlreadyUsed) return { thought, action: task, response: '' }
          }
        }
        const m = result.content.match(/(\w+)\.(\w+)\s*\{/)
        if (m) {
          const argsStart = result.content.indexOf('{', result.content.indexOf(m[0]))
          const argsEnd = result.content.lastIndexOf('}')
          if (argsStart !== -1 && argsEnd > argsStart) {
            try {
              const args = JSON.parse(result.content.slice(argsStart, argsEnd + 1))
              const task: PlanTask = {
                id: `r${Date.now()}`,
                type: 'action',
                tool: m[1],
                action: m[2],
                args,
                depends_on: [],
                safety_level: 'low',
              }
              const usedKeyFallback = (task.tool === 'email' && task.action === 'get')
                ? `email.get:${String(task.args.id ?? '')}`
                : `${task.tool}.${task.action}`
              const alreadyUsedFallback = accumulated.some(s => {
                if (s.result.startsWith('Error:')) return false
                const sKey = (s.task.tool === 'email' && s.task.action === 'get')
                  ? `email.get:${String(s.task.args.id ?? '')}`
                  : `${s.task.tool}.${s.task.action}`
                return sKey === usedKeyFallback
              })
              if (!alreadyUsedFallback) {
                return { thought, action: task, response: '' }
              }
            } catch {}
          }
        }
      }
      return { thought, action: null, response: parsed.response ?? '' }
    }

    const task = parsed.action
    if (!task.id) task.id = `r${Date.now()}`
    if (task.type !== 'tool' && task.type !== 'action') task.type = 'tool'
    if (!['low', 'medium', 'high'].includes(task.safety_level)) task.safety_level = 'low'
    if (!Array.isArray(task.depends_on)) task.depends_on = []
    if (typeof task.args !== 'object' || task.args === null) task.args = {}
    if (task.tool === 'unknown' && !task.unknown_target) {
      task.unknown_target = String(task.args.unknown_target ?? task.args.target ?? '')
    }

    // Hard dedup: never repeat a tool.action already in accumulated.
    // For email.get, include the message id in the key — different emails can legitimately
    // be read in the same session.
    const dedupKey = (task.tool === 'email' && task.action === 'get')
      ? `email.get:${String(task.args.id ?? '')}`
      : `${task.tool}.${task.action}`
    const alreadyUsed = accumulated.some(s => {
      if (s.result.startsWith('Error:')) return false  // always allow retry after error
      const sKey = (s.task.tool === 'email' && s.task.action === 'get')
        ? `email.get:${String(s.task.args.id ?? '')}`
        : `${s.task.tool}.${s.task.action}`
      return sKey === dedupKey
    })
    if (alreadyUsed) {
      return { thought, action: null, response: '' }
    }

    return { thought, action: task, response: '' }
  } catch {
    return { thought: '', action: null, response: '' }
  }
}
