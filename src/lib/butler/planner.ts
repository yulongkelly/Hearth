import type { ChatMessage, ModelAdapter } from '@/lib/model-adapter'

export type TaskStatus = 'ready' | 'needs_connection' | 'blocked'

export interface PlanTask {
  id: string
  type: 'tool' | 'action'
  tool: string
  action: string
  args: Record<string, unknown>
  depends_on?: string[]
  safety_level: 'low' | 'medium' | 'high'
  status?: TaskStatus      // set by capability-resolver, not the planner
  unknown_target?: string  // service name when tool='unknown'
}

export interface TaskPlan {
  tasks: PlanTask[]
  response: string
}

const PLANNER_SYSTEM = `You are a planning engine for a local AI assistant. Given the user's request and conversation context, output ONLY a valid JSON object — no markdown fences, no explanation, just the JSON.

Available connectors and actions:
- gmail: get_inbox(maxResults?, query?), read_email(id), send_email(to, subject, body) — send requires approval
- calendar: get_events(days?, maxResults?), create_event(title, start, end, description?) — create requires approval
- email: get_inbox(days?, limit?), send_email(to, subject, body) — IMAP/SMTP; send requires approval
- memory: add(content), search(query), remove(id)
- http: get(url, headers?), post(url, body, headers?), delete(url, headers?) — post/delete require approval
- system: merge_lists(lists), detect_conflicts(events), filter_events(events, criteria), summarize(data, instruction), web_search(query), query_events(query?, days?), create_workflow(name, description, icon, goal, steps)
- unknown: call(unknown_target) — use this for ANY external service or API you don't have a built-in connector for (smart home devices, third-party APIs, SaaS products, etc.). The system will investigate and resolve at execution time.

Output schema (strict):
{
  "tasks": [
    {
      "id": "t1",
      "type": "tool",
      "tool": "gmail",
      "action": "get_inbox",
      "args": { "maxResults": 10 },
      "depends_on": [],
      "safety_level": "low"
    }
  ],
  "response": "Your natural language reply to the user"
}

Rules:
- CAPABILITY CHECK FIRST: Only return tasks:[] for requests that are truly impossible via any HTTP/API mechanism — specifically: running local binaries, reading/writing local files, controlling OS settings, modifying system registry. For ALL other external services (even if you don't know their API), use tool:'unknown' with unknown_target:'<service name>' — the system will investigate. Never ask clarifying questions for a request you cannot fulfill.
- type="tool" for gmail/calendar/email/http; type="action" for system/memory
- safety_level: reads = "low", calendar writes = "medium", any send/post/delete = "high"
- use depends_on to express data dependencies between tasks
- reference a prior task's result in args as the string "$t1" (the task's id)
- for pure conversation with no connector actions needed: output {"tasks": [], "response": "..."}
- response must always be present and non-empty — it is shown to the user
- create_workflow requires fully specified details: name, description, goal, exact steps, schedule/trigger, and target. If the user's request is vague or any required detail is missing or ambiguous, output {"tasks":[], "response":"<one specific clarifying question>"} — do NOT plan a create_workflow until all details are confirmed. Ask about the most critical missing detail first (e.g. what exactly should be done, when/how often, which account or target).
- output ONLY the JSON object, no other text`

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const first = text.indexOf('{')
  const last  = text.lastIndexOf('}')
  if (first !== -1 && last > first) return text.slice(first, last + 1)
  return text.trim()
}

function parsePlan(raw: string): TaskPlan {
  const json = extractJson(raw)
  const parsed = JSON.parse(json) as Partial<TaskPlan>
  if (!Array.isArray(parsed.tasks)) throw new Error('tasks must be an array')
  if (typeof parsed.response !== 'string') parsed.response = ''
  for (const t of parsed.tasks) {
    if (!t.id || !t.tool || !t.action) throw new Error(`task missing id/tool/action: ${JSON.stringify(t)}`)
    if (t.type !== 'tool' && t.type !== 'action') t.type = 'tool'
    if (!['low', 'medium', 'high'].includes(t.safety_level as string)) t.safety_level = 'low'
    if (!Array.isArray(t.depends_on)) t.depends_on = []
    if (typeof t.args !== 'object' || t.args === null) t.args = {}
    // For unknown tasks, hoist unknown_target from args if not set at top level
    if (t.tool === 'unknown' && !t.unknown_target) {
      t.unknown_target = String(t.args.unknown_target ?? t.args.target ?? t.args.service ?? '')
    }
  }
  return parsed as TaskPlan
}

export async function planFromMessage(
  messages: ChatMessage[],
  systemContext: string,
  adapter: ModelAdapter,
  model: string,
): Promise<TaskPlan> {
  const plannerSystem = [PLANNER_SYSTEM, systemContext].filter(Boolean).join('\n\n')
  const plannerMessages: ChatMessage[] = [
    { role: 'system', content: plannerSystem },
    ...messages.filter(m => m.role !== 'system'),
  ]

  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const msgs: ChatMessage[] = attempt === 0
      ? plannerMessages
      : [
          ...plannerMessages,
          { role: 'assistant', content: lastError },
          { role: 'user', content: `Your previous response was not valid JSON. Fix it and output ONLY the JSON object. Error: ${lastError}` },
        ]

    try {
      const result = await adapter.chat({ model, messages: msgs, signal: AbortSignal.timeout(60_000) })
      return parsePlan(result.content)
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }

  // All retries failed — return empty plan, let the caller stream a fallback
  return { tasks: [], response: '' }
}
