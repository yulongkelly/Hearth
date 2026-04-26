import type { ChatMessage, ModelAdapter } from '@/lib/model-adapter'
import type { PlanTask } from './planner'

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
- Time-sensitive requests (travel, bookings, appointments, meetings): check calendar.get_events first to flag conflicts
- Named person (draft email to X, schedule with X, follow up with X): search memory for context about that person first
- Reply or follow-up to an email: fetch the relevant email thread from inbox first, then draft
- Purchase, subscription, or spending: search memory for budget or spending preferences before proceeding
- Recommendation (tool, restaurant, product, service): search memory for the user's known preferences first

Each turn, decide the ONE next action needed, or give your final response if you have enough information.

Available connectors:
- gmail: get_inbox(maxResults?, query?), read_email(id), send_email(to, subject, body)
- calendar: get_events(days?, maxResults?), create_event(title, start, end, description?)
- email: get_inbox(days?, limit?), send_email(to, subject, body)
- memory: add(content), search(query), remove(id)
- http: get(url, headers?), post(url, body, headers?), delete(url, headers?)
- system: merge_lists(lists), detect_conflicts(events), filter_events(events, criteria), summarize(data, instruction), web_search(query), query_events(query?, days?)
- content: parse_html(html), extract_text(input), classify(text, labels[]), parse_travel(text), parse_email_to_event(text)
- unknown: call(unknown_target) — for any external service not listed above

Output ONLY valid JSON in one of these two forms:

Take one action:
{"thought":"why I need this","action":{"id":"t1","type":"tool","tool":"calendar","action":"get_events","args":{"days":2},"depends_on":[],"safety_level":"low"}}

Final response (when you have enough information):
{"thought":"I have all I need","action":null,"response":"your message to the user"}

Rules:
- type: "tool" for gmail/calendar/email/http/unknown; "action" for system/memory/content
- safety_level: reads="low", calendar writes="medium", any send/post/delete="high"
- One action per turn — never output multiple tasks
- If memory.search already appears in your progress, do NOT search memory again regardless of the query — accept the result and proceed
- If calendar.get_events already appears in your progress, do NOT fetch calendar again
- Use action:null as soon as you have enough information to answer
- For pure conversation with no data needed: immediately use action:null with your response
- Output ONLY the JSON — no markdown, no explanation`

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
    const result = await adapter.chat({ model, messages: reactMessages, signal: AbortSignal.timeout(60_000) })
    const json = extractJson(result.content)
    const parsed = JSON.parse(json) as { thought?: string; action?: PlanTask | null; response?: string }

    const thought = parsed.thought ?? ''

    if (!parsed.action) {
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

    // Hard dedup: never repeat a tool.action already in accumulated
    const usedKey = `${task.tool}.${task.action}`
    if (accumulated.some(s => `${s.task.tool}.${s.task.action}` === usedKey)) {
      return { thought, action: null, response: '' }
    }

    return { thought, action: task, response: '' }
  } catch {
    return { thought: '', action: null, response: '' }
  }
}
