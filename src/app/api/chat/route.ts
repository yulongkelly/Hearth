import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getModelAdapter } from '@/lib/adapters/registry'
import type { ChatMessage } from '@/lib/model-adapter'
import type { TaskPlan, PlanTask } from '@/lib/butler/planner'
import { validatePlan } from '@/lib/butler/plan-validator'
import { executePlan } from '@/lib/butler/plan-executor'
import type { ExecutionStep } from '@/lib/butler/plan-executor'
import { reactStep } from '@/lib/butler/react-planner'
import type { AccumulatedStep } from '@/lib/butler/react-planner'
import { resolveCapabilities } from '@/lib/butler/capability-resolver'
import { readMemory, readMemoryTrimmed, readMemoryEntries, queueMemoryWrite, flushMemoryQueue } from '@/lib/memory-store'
import type { MemoryTarget } from '@/lib/memory-store'
import { waitForApproval } from '@/lib/approval-store'
import { validateMemoryEntry } from '@/lib/memory-validator'
import { retrieveRelevantMemory } from '@/lib/memory-retrieval'
import { compile, compileRetryPrompt } from '@/lib/workflow-compiler'
import type { WorkflowTool } from '@/lib/workflow-tools'
import { appendEvent } from '@/lib/event-store'
import { OLLAMA_BASE_URL } from '@/lib/ollama'
import { extractObservations } from '@/lib/knowledge/observation-extractor'
import { appendSignal, readSignalsSince } from '@/lib/knowledge/signal-store'
import { aggregateSignals } from '@/lib/knowledge/memory-aggregator'
import { evaluateCluster, executeDecision, synthesizeCluster } from '@/lib/knowledge/memory-policy'
import { queryWikiByEntityType, listWikiPages, rankWikiPages } from '@/lib/knowledge/wiki'

// ─── hearth.md — user-editable static instructions, always loaded ─────────────

const HEARTH_MD_PATH = path.join(os.homedir(), '.hearth', 'memory', 'hearth.md')
const HEARTH_MD_TEMPLATE = `# Hearth — Standing Instructions

## Tool Usage Rules
- Always confirm before sending any email or message
- Never save raw API responses to memory — save conclusions only

## User Policies
(Add your own policies here)

## Restrictions
(Add restrictions here)
`

function ensureHearthMd(): void {
  if (!fs.existsSync(HEARTH_MD_PATH)) {
    const dir = path.dirname(HEARTH_MD_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(HEARTH_MD_PATH, HEARTH_MD_TEMPLATE, { encoding: 'utf-8', mode: 0o600 })
  }
}

function loadHearthMd(): string {
  try {
    const content = fs.readFileSync(HEARTH_MD_PATH, 'utf-8')
    if (content.length > 2000) return content.slice(0, 2000) + '\n…(hearth.md truncated — keep it concise)'
    return content
  } catch { return '' }
}

ensureHearthMd()

const EVENT_SKIP = new Set(['memory', 'ask_clarification', 'create_workflow', 'query_events', 'web_search', 'request_connection', 'query_capabilities'])

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Transfer-Encoding': 'chunked',
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
}

const MAX_TOOL_ITERATIONS = 5

const SYSTEM_MESSAGE = `You are a knowledgeable, direct assistant. Think through problems yourself first — reason from your own knowledge and give concrete, opinionated answers like a senior engineer would. Do NOT frame your answer around what tools you have or don't have. Do NOT open with "I cannot" or list options mechanically. Just answer the question directly, then mention tools or integrations only if they genuinely add value. Never mention tool names, tool execution errors, or internal details — if a fetch succeeded, present the result; if something couldn't be retrieved, say what's unavailable in plain terms.

IMPORTANT: Your tools (Gmail, Calendar, workflows) are for fetching live data or automating tasks — not for answering conceptual or advisory questions. If the user asks "how do I do X", answer from knowledge. Only reach for tools when the user needs real-time data (e.g. "what's in my inbox") or wants to automate something specific.

You have access to the user's Gmail and Google Calendar. When the user asks about their actual email or calendar events, call the appropriate tool to fetch real data. When presenting email search results, always include each email's subject line and (for Gmail) a direct link https://mail.google.com/mail/u/0/#all/<message_id> so the user can open and verify the email. Message IDs are provided in tool results — never omit subjects or links for email summaries.

You can propose reusable workflow automations using create_workflow. Workflow steps MUST use ONLY these exact names: get_calendar_events, get_inbox, read_email, http_request, merge_lists, detect_conflicts, filter_events, summarize. IMPORTANT: create_workflow only shows a preview for the user to review and confirm — it does NOT save anything. After calling it, tell the user "Here's the workflow plan for your review — save it from the preview card to add it to your sidebar."

CONNECTING NEW SERVICES: When the user wants to connect or use an external API or service you don't have built-in access to (e.g. smart home devices, custom APIs):
1. Call ask_clarification to confirm they want to set up the connection (1 question, yes/no).
2. Call query_capabilities with the service name first. If it returns a capability spec, use those credential fields directly in request_connection — skip web_search entirely. Only call web_search if query_capabilities returns nothing.
3a. If you find enough info: call request_connection with full setup details, exact credential fields (use type "password" for secrets), and a test_url if the API has a simple endpoint to verify (like /user/info or /status).
3b. If you cannot find API access info or it requires complex OAuth: tell the user you cannot connect to that service and suggest alternatives.
4. After connection is verified: confirm the specific action with the user, then call create_workflow using http_request steps with connection: "<service name>".

http_request step params: url (full URL or path relative to connection base), method (GET/POST/etc.), body (JSON string, optional), connection (name of registered connection), headers (extra headers, optional).

You have a persistent memory system. Use the memory tool to save facts that will be useful in future sessions. Save proactively — do not wait to be asked. Do NOT save which integrations are connected — you can tell what's connected by which tools are available to you. Store user preferences and personal details, not system state.

After any turn where you used web_search, http_request, or other research tools to discover facts about an external service or API, immediately call the memory tool (action: 'add') to save a concise conclusion. Format: '<Service>: <finding>' (e.g. 'Tapo API: only Google Home integration available — no direct REST API'). One entry per distinct finding. Distill to the conclusion — do not save raw tool output. This persists research across sessions so it never needs to be re-fetched.`

function parseQuestionsFromText(text: string): Array<{ question: string; options: string[] }> | null {
  // Split on lines that start a new numbered question
  const sections = text.split(/\n(?=\d+[\.\)]\s)/)
  if (sections.length < 2) return null
  const questions: Array<{ question: string; options: string[] }> = []
  for (const section of sections) {
    const lines = section.trim().split('\n')
    const qMatch = lines[0].match(/^\d+[\.\)]\s+\*{0,2}(.+?)\*{0,2}:?\s*$/)
    if (!qMatch) continue
    const question = qMatch[1].trim()
    const options = lines.slice(1)
      .map(l => l.replace(/^[\s\-•*]+/, '').trim())
      .filter(l => l.length > 0 && !/^please/i.test(l) && !/^click/i.test(l))
    if (options.length >= 2) questions.push({ question, options })
  }
  return questions.length >= 2 ? questions : null
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch {}
  }
  return {}
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { model, messages } = body

  if (!model || !messages) {
    return new Response(JSON.stringify({ error: 'model and messages are required' }), { status: 400 })
  }

  const adapter = getModelAdapter()

  const contextLength = (await adapter.getContextLength?.(model)) ?? 4096

  const memoryThreshold: number = typeof body.memoryThreshold === 'number' ? body.memoryThreshold : 0.20
  const AVG_CHARS_PER_TOKEN = 4
  const totalCharBudget = Math.floor(contextLength * memoryThreshold * AVG_CHARS_PER_TOKEN)
  const perFileBudget = Math.floor(totalCharBudget / 2)

  // Static context: always loaded in full
  const hearthMd  = loadHearthMd()
  const userBlock = readMemoryTrimmed('user', perFileBudget)

  // Dynamic context: embed the last user message, retrieve top-5 relevant memory entries
  const lastUserMsg = [...(messages as ChatMessage[])].reverse()
    .find(m => m.role === 'user')?.content ?? ''
  const ollamaUrl = OLLAMA_BASE_URL
  const memoryEntries = readMemoryEntries('memory')
  const relevantEntries = await retrieveRelevantMemory(lastUserMsg, memoryEntries, 5, ollamaUrl, model)
  const memBlock = relevantEntries.join('\n§\n')

  // Always-inject goal pages — declared goals are relevant in every session
  const goalPages = queryWikiByEntityType('goal')
  const goalsBlock = goalPages.length > 0
    ? `<user_goals>\n${goalPages.map(p =>
        `[${p.frontmatter.title}] (confidence: ${p.frontmatter.confidence})\n${p.body}`
      ).join('\n\n')}\n</user_goals>`
    : ''

  const memorySection = [
    hearthMd   ? `<hearth>\n${hearthMd}\n</hearth>`              : '',
    userBlock  ? `<user_profile>\n${userBlock}\n</user_profile>` : '',
    goalsBlock ? goalsBlock                                       : '',
    memBlock   ? `<memory>\n${memBlock}\n</memory>`              : '',
  ].filter(Boolean).join('\n\n')

  const todayLine = `Today's date is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. Use this when computing date ranges or referencing days of the week.`
  const fullSystemMessage = [SYSTEM_MESSAGE, todayLine, memorySection || ''].filter(Boolean).join('\n\n')

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  function writeLine(obj: object) {
    try { writer.write(encoder.encode(JSON.stringify(obj) + '\n')) } catch {}
  }

  async function streamFinal(msgs: ChatMessage[]) {
    try {
      const stream = await adapter.streamChat({ model, messages: msgs, think: true })
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await writer.write(value)
      }
    } catch {
      writeLine({ error: 'Streaming error' })
    }
  }

  ;(async () => {
    try {
      const hasSystem = messages.some((m: ChatMessage) => m.role === 'system')
      const systemMsg: ChatMessage = { role: 'system', content: fullSystemMessage }
      const baseMessages: ChatMessage[] = hasSystem ? [...messages] : [systemMsg, ...messages]

      function runKnowledgePipeline(msgs: ChatMessage[], results: Map<string, string>): void {
        const sessionId = crypto.randomUUID()
        ;(async () => {
          try {
            const userMsgs = msgs.filter(m => m.role === 'user' || m.role === 'assistant')
            const signals  = await extractObservations(userMsgs, results, sessionId, adapter, model)
            for (const sig of signals) appendSignal(sig)
            if (signals.length > 0) {
              const cutoff   = new Date(Date.now() - 90 * 86_400_000).toISOString()
              const clusters = aggregateSignals(readSignalsSince(cutoff))
              for (const cluster of clusters) {
                const decision = evaluateCluster(cluster)
                if (decision.action !== 'ignore') {
                  const synthesis = await synthesizeCluster(cluster, adapter, model)
                  executeDecision(decision, synthesis)
                }
              }
            }
          } catch { /* non-critical */ }
        })()
      }

      // ── ReAct Loop: reason → act → observe, repeat ──────────────────────────
      const interceptors: Record<string, (task: PlanTask) => Promise<string>> = {
        'memory.add': async (task) => {
          const { content = '' } = task.args as Record<string, string>
          const v = validateMemoryEntry(content)
          if (!v.valid) return `Rejected: ${v.reason}`
          queueMemoryWrite('memory', 'add', content, ollamaUrl, model)
          return 'Saved.'
        },
        'memory.search': async (task) => {
          const { query = '' } = task.args as Record<string, string>
          return readMemory('memory') + (query ? ` (query: ${query})` : '')
        },
        'memory.remove': async (task) => {
          const { id: memId = '' } = task.args as Record<string, string>
          queueMemoryWrite('memory', 'remove', memId, ollamaUrl, model)
          return 'Removed.'
        },
        'system.generate_digest': async () => {
          const { generateWeeklyDigest, writePendingDigest } = await import('@/lib/knowledge/weekly-digest')
          const digest = await generateWeeklyDigest(adapter, model)
          writePendingDigest(digest)
          return 'Weekly digest generated.'
        },
        'unknown.call': async (task) => {
          const target = task.unknown_target ?? String(task.args.target ?? 'unknown service')
          if (task.status === 'blocked') {
            writeLine({ blocked_step: { taskId: task.id, target, reason: task.args.reason } })
            return `Cannot connect to ${target}: ${task.args.reason}`
          }
          if (task.status === 'needs_connection') {
            writeLine({ pending_connection: {
              id: task.id,
              target,
              capabilitySpec: task.args.capabilitySpec,
              searchSummary:  task.args.searchSummary,
            }})
            return `Connection setup required for ${target}.`
          }
          return `Unknown status for ${target}.`
        },
        'system.create_workflow': async (task) => {
          writeLine({ tool_status: 'Building workflow…' })
          const compiled = compile(task.args)
          if (!compiled.ok) return `Error building workflow: ${compiled.error}`
          const pendingWorkflow: WorkflowTool = {
            ...compiled.workflow!,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            runs: [],
          }
          writeLine({ pending_workflow: pendingWorkflow })
          return 'Workflow plan shown to user for review.'
        },
      }

      const requireApproval = async (task: PlanTask) => {
        const id = crypto.randomUUID()
        writeLine({ pending_approval: { id, tool: `${task.tool}.${task.action}`, args: task.args } })
        return waitForApproval(id)
      }

      const emitStep = (step: ExecutionStep) => {
        writeLine({ execution_step: step })
        if (step.status === 'done') {
          appendEvent({ type: 'tool_call', tool: `${step.tool}.${step.action}`, args: {}, result: (step.result ?? '').slice(0, 500) })
        }
      }

      const accumulated: AccumulatedStep[] = []
      const allTaskResults = new Map<string, string>()

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const reactResult = await reactStep(baseMessages, accumulated, adapter, model)
        if (reactResult.action === null) break

        writeLine({ react_step: { iteration, phase: 'acting', thought: reactResult.thought, tool: reactResult.action.tool, action: reactResult.action.action } })

        const singlePlan: TaskPlan = { tasks: [reactResult.action], response: '' }
        const validation = validatePlan(singlePlan)
        if (!validation.ok) break

        const resolvedPlan = await resolveCapabilities(singlePlan)
        const taskResults = await executePlan(resolvedPlan, { requireApproval, emitStep, interceptors })

        const result = taskResults.get(reactResult.action.id) ?? '(no result)'
        accumulated.push({ thought: reactResult.thought, task: reactResult.action, result })
        allTaskResults.set(`${reactResult.action.tool}.${reactResult.action.action}`, result)

        writeLine({ react_step: { iteration, phase: 'done', result: result.slice(0, 200) } })
      }

      // toolHistoryMsgs: kept in original alternating format for the hidden chat history
      const toolHistoryMsgs: ChatMessage[] = accumulated.flatMap(s => [
        { role: 'assistant', content: `[Reasoning: ${s.thought}]\n${s.task.tool}.${s.task.action} ${JSON.stringify(s.task.args)}` },
        { role: 'user',      content: s.result.slice(0, 2000) },
      ])
      if (toolHistoryMsgs.length > 0) writeLine({ tool_history: toolHistoryMsgs })

      // ── Knowledge pipeline (fire-and-forget — does not block synthesis) ───────
      runKnowledgePipeline(messages as ChatMessage[], allTaskResults)

      // ── Wiki context injection (semantic ranking: relevance×0.6 + frequency×0.25 + recency×0.15) ──
      const goalPageIds  = new Set(goalPages.map(p => p.frontmatter.id))
      const nonGoalPages = listWikiPages().filter(p => !goalPageIds.has(p.frontmatter.id))
      const rankedPages  = await rankWikiPages(String(lastUserMsg).slice(0, 500), nonGoalPages, ollamaUrl, model, 5)
      const wikiBlock    = rankedPages.length > 0
        ? `<user_preferences>\n${rankedPages.map(p =>
            `[${p.frontmatter.title}] (confidence: ${p.frontmatter.confidence})\n${p.body}`
          ).join('\n\n')}\n</user_preferences>`
        : ''

      // For synthesis: collapse tool results into a single context block so the model
      // doesn't confuse the alternating assistant/user tool-call format with its own output.
      const toolContextMsgs: ChatMessage[] = accumulated.length > 0 ? [
        {
          role: 'user',
          content: `Here are the results from the tools I ran:\n\n${accumulated.map(s =>
            `[${s.task.tool}.${s.task.action}]\n${s.result.slice(0, 1500)}`
          ).join('\n\n---\n\n')}\n\nNow answer the original question using these results.`,
        },
      ] : []

      const synthMessages: ChatMessage[] = [
        ...baseMessages,
        ...toolContextMsgs,
        ...(wikiBlock ? [{ role: 'user' as const, content: wikiBlock }] : []),
      ]
      await streamFinal(synthMessages)

    } catch (err) {
      writeLine({ error: err instanceof Error ? err.message : 'Tool loop error' })
    } finally {
      await flushMemoryQueue(ollamaUrl, model).catch(() => {})
      try { await writer.close() } catch {}
    }
  })()

  return new Response(readable, { headers: NDJSON_HEADERS })
}
