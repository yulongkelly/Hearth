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
import { waitForAnswers } from '@/lib/questions-store'
import { validateMemoryEntry } from '@/lib/memory-validator'
import { retrieveRelevantMemory } from '@/lib/memory-retrieval'
import { compile, compileRetryPrompt } from '@/lib/workflow-compiler'
import type { WorkflowTool } from '@/lib/workflow-tools'
import { appendEvent } from '@/lib/event-store'
import { OLLAMA_BASE_URL } from '@/lib/ollama'
import { extractObservations } from '@/lib/knowledge/observation-extractor'
import { appendSignal, readSignalsSince } from '@/lib/knowledge/signal-store'
import { DebugLogger } from '@/lib/debug-logger'
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

You have a built-in reminders system. When the user asks to set a reminder, the AI will have already called reminders.create — confirm the reminder was set and what date/recurrence was used. Never say you cannot create reminders.

You can propose reusable workflow automations using create_workflow. Workflow steps MUST use ONLY these exact names: get_calendar_events, get_inbox, read_email, http_request, merge_lists, detect_conflicts, filter_events, summarize. IMPORTANT: create_workflow only shows a preview for the user to review and confirm — it does NOT save anything. After calling it, tell the user "Here's the workflow plan for your review — save it from the preview card to add it to your sidebar."

CONNECTING NEW SERVICES: When the user wants to connect or use an external API or service you don't have built-in access to (e.g. smart home devices, custom APIs):
1. Call ask_clarification to confirm they want to set up the connection (1 question, yes/no).
2. Call query_capabilities with the service name first. If it returns a capability spec, use those credential fields directly in request_connection — skip web_search entirely. Only call web_search if query_capabilities returns nothing.
3a. If you find enough info: call request_connection with full setup details, exact credential fields (use type "password" for secrets), and a test_url if the API has a simple endpoint to verify (like /user/info or /status).
3b. If you cannot find API access info or it requires complex OAuth: tell the user you cannot connect to that service and suggest alternatives.
4. After connection is verified: confirm the specific action with the user, then call create_workflow using http_request steps with connection: "<service name>".

http_request step params: url (full URL or path relative to connection base), method (GET/POST/etc.), body (JSON string, optional), connection (name of registered connection), headers (extra headers, optional).

You have a persistent memory system. Use the memory tool to save facts that will be useful in future sessions. Save proactively — do not wait to be asked. Do NOT save which integrations are connected — you can tell what's connected by which tools are available to you. Store user preferences and personal details, not system state.

After any turn where you used web_search, http_request, or other research tools to discover facts about an external service or API, immediately call the memory tool (action: 'add') to save a concise conclusion. Format: '<Service>: <finding>' (e.g. 'Tapo API: only Google Home integration available — no direct REST API'). One entry per distinct finding. Distill to the conclusion — do not save raw tool output. This persists research across sessions so it never needs to be re-fetched.

When presenting email search results, list each matched email with its subject line and a direct link. Group results naturally by topic if there are multiple categories, but do not mention search keywords or query strings — just present the emails.

CRITICAL for email results: Report ONLY emails that are explicitly present in the tool results provided to you. Do NOT invent, estimate, or include any email, service, subscription amount, or transaction that does not appear verbatim in the tool results. If an email's subject line suggests it is a promotional or marketing message (e.g. "We've been missing you", "Special offer", "Don't miss out", re-engagement campaigns), classify it as a promotion — do NOT present it as a purchase, order, or subscription charge.`

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

  const sessionId = crypto.randomUUID()
  const debugLogger = new DebugLogger(sessionId)
  debugLogger.log('request', { model, messages })
  debugLogger.log('context_assembly', {
    hearthMd:  hearthMd  || null,
    userBlock: userBlock || null,
    goalsBlock: goalsBlock || null,
    memBlock:  memBlock  || null,
    fullSystemMessage,
  })

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  function writeLine(obj: object) {
    try { writer.write(encoder.encode(JSON.stringify(obj) + '\n')) } catch {}
  }

  async function streamFinal(msgs: ChatMessage[]) {
    try {
      debugLogger.log('synthesis_input', { messages: msgs })
      const stream = await adapter.streamChat({ model, messages: msgs, think: true })
      const [clientStream, logStream] = stream.tee()

      // Capture synthesis output for debug log (fire-and-forget)
      ;(async () => {
        const decoder = new TextDecoder()
        const logReader = logStream.getReader()
        const chunks: string[] = []
        try {
          while (true) {
            const { done, value } = await logReader.read()
            if (done) break
            chunks.push(decoder.decode(value, { stream: true }))
          }
        } finally {
          debugLogger.log('synthesis_output', { raw: chunks.join('') })
        }
      })()

      const reader = clientStream.getReader()
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
        'chat.ask_clarification': async (task) => {
          const { questions } = task.args as { questions: Array<{ question: string; options: string[] }> }
          if (!Array.isArray(questions) || questions.length === 0) return 'No questions to ask.'
          const id = crypto.randomUUID()
          writeLine({ pending_questions: { id, questions } })
          const answers = await waitForAnswers(id)
          writeLine({ pending_questions: null })
          return answers.length > 0
            ? `User answered: ${questions.map((q, i) => `${q.question} → ${answers[i] ?? '(skipped)'}`).join('; ')}`
            : 'User did not answer (timed out).'
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

      function looksLikePlainTextQuestions(text: string): boolean {
        if (!text) return false
        // Already used the popup path — don't re-trigger
        const alreadyClarifying = accumulated.some(
          s => s.task.tool === 'chat' && s.task.action === 'ask_clarification'
        )
        if (alreadyClarifying) return false
        const trimmed = text.trim()
        // Ends with a question mark → single question directed at the user
        if (trimmed.endsWith('?') || trimmed.endsWith('？')) return true
        // Two or more question marks anywhere → multiple questions in the response
        const questionMarks = (trimmed.match(/[?？]/g) ?? []).length
        return questionMarks >= 2
      }

      let reactFinalResponse = ''
      let lastReactWasParseFailure = false
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const reactResult = await reactStep(baseMessages, accumulated, adapter, model, debugLogger)
        if (reactResult.action === null) {
          debugLogger.log('react_decided_no_action', { iteration, thought: reactResult.thought })
          // Detect parse failure: model output non-JSON (thought and response both empty)
          lastReactWasParseFailure = reactResult.thought === '' && reactResult.response === ''

          // Guard: model output questions as plain text — force one corrective iteration
          if (looksLikePlainTextQuestions(reactResult.response)) {
            debugLogger.log('react_plain_text_questions_detected', { iteration, response: reactResult.response.slice(0, 200) })
            const correctionMessages: ChatMessage[] = [
              ...baseMessages.filter(m => m.role !== 'system'),
              {
                role: 'user',
                content: `[SYSTEM CORRECTION] You just output questions as plain text in your response. This is NOT allowed. You MUST call chat.ask_clarification now with those questions formatted as selectable options. Do not produce a plain text response — output the JSON action to call chat.ask_clarification.`,
              },
            ]
            const corrected = await reactStep(correctionMessages, accumulated, adapter, model, debugLogger)
            if (corrected.action !== null) {
              // Execute the ask_clarification call from the correction
              writeLine({ react_step: { iteration, phase: 'acting', thought: corrected.thought, tool: corrected.action.tool, action: corrected.action.action } })
              const singleTask = { ...corrected.action, depends_on: [] }
              const singlePlan: TaskPlan = { tasks: [singleTask], response: '' }
              const validation = validatePlan(singlePlan)
              if (validation.ok) {
                const resolvedPlan = await resolveCapabilities(singlePlan)
                const taskResults = await executePlan(resolvedPlan, { requireApproval, emitStep, interceptors })
                const result = taskResults.get(corrected.action.id) ?? '(no result)'
                accumulated.push({ thought: corrected.thought, task: corrected.action, result })
                allTaskResults.set(`${corrected.action.tool}.${corrected.action.action}`, result)
                writeLine({ react_step: { iteration, phase: 'done', result: result.slice(0, 200) } })
                continue  // re-enter loop to get final response with answers
              }
            }
          }

          reactFinalResponse = reactResult.response
          break
        }

        writeLine({ react_step: { iteration, phase: 'acting', thought: reactResult.thought, tool: reactResult.action.tool, action: reactResult.action.action } })

        // Each ReAct iteration executes independently — strip cross-iteration depends_on
        // so validatePlan doesn't reject references to tasks from prior iterations.
        const singleTask = { ...reactResult.action, depends_on: [] }
        const singlePlan: TaskPlan = { tasks: [singleTask], response: '' }
        const validation = validatePlan(singlePlan)
        if (!validation.ok) {
          debugLogger.log('react_validate_failed', { iteration, reason: validation.error })
          break
        }

        const resolvedPlan = await resolveCapabilities(singlePlan)
        debugLogger.log('react_resolved_plan', { iteration, tasks: resolvedPlan.tasks.map(t => ({ id: t.id, tool: t.tool, action: t.action, args: t.args })) })
        const taskResults = await executePlan(resolvedPlan, { requireApproval, emitStep, interceptors })

        const result = taskResults.get(reactResult.action.id) ?? '(no result)'
        accumulated.push({ thought: reactResult.thought, task: reactResult.action, result })
        allTaskResults.set(`${reactResult.action.tool}.${reactResult.action.action}`, result)
        debugLogger.log('tool_result', { iteration, tool: reactResult.action.tool, action: reactResult.action.action, args: reactResult.action.args, result })

        writeLine({ react_step: { iteration, phase: 'done', result: result.slice(0, 200) } })
      }

      // Guard: if no response was set and the last iteration was a parse failure (model output
      // non-JSON), run one corrective iteration to extract the intended action before synthesis.
      if (!reactFinalResponse && lastReactWasParseFailure) {
        const correctionMessages: ChatMessage[] = [
          ...baseMessages.filter(m => m.role !== 'system'),
          {
            role: 'user' as const,
            content: `[SYSTEM] Your previous response could not be parsed as valid JSON. You MUST now output valid JSON: either call an action (e.g. chat.ask_clarification, reminders.create) or give a final response with action:null and a response field. Do NOT output plain text.`,
          },
        ]
        const corrected = await reactStep(correctionMessages, accumulated, adapter, model, debugLogger)
        if (corrected.action !== null) {
          writeLine({ react_step: { iteration: MAX_TOOL_ITERATIONS, phase: 'acting', thought: corrected.thought, tool: corrected.action.tool, action: corrected.action.action } })
          const singleTask = { ...corrected.action, depends_on: [] }
          const singlePlan: TaskPlan = { tasks: [singleTask], response: '' }
          const validation = validatePlan(singlePlan)
          if (validation.ok) {
            const resolvedPlan = await resolveCapabilities(singlePlan)
            const taskResults = await executePlan(resolvedPlan, { requireApproval, emitStep, interceptors })
            const result = taskResults.get(corrected.action.id) ?? '(no result)'
            accumulated.push({ thought: corrected.thought, task: corrected.action, result })
            allTaskResults.set(`${corrected.action.tool}.${corrected.action.action}`, result)
            writeLine({ react_step: { iteration: MAX_TOOL_ITERATIONS, phase: 'done', result: result.slice(0, 200) } })
            // Continue for up to 2 more steps so chains like email.get → reminders.create can complete
            for (let postStep = 0; postStep < 2; postStep++) {
              const nextStep = await reactStep(baseMessages, accumulated, adapter, model, debugLogger)
              if (nextStep.action === null) {
                reactFinalResponse = nextStep.response
                break
              }
              writeLine({ react_step: { iteration: MAX_TOOL_ITERATIONS + 1 + postStep, phase: 'acting', thought: nextStep.thought, tool: nextStep.action.tool, action: nextStep.action.action } })
              const nextTask = { ...nextStep.action, depends_on: [] }
              const nextPlan: TaskPlan = { tasks: [nextTask], response: '' }
              if (!validatePlan(nextPlan).ok) break
              const nextResolved = await resolveCapabilities(nextPlan)
              const nextResults = await executePlan(nextResolved, { requireApproval, emitStep, interceptors })
              const nextResult = nextResults.get(nextStep.action.id) ?? '(no result)'
              accumulated.push({ thought: nextStep.thought, task: nextStep.action, result: nextResult })
              allTaskResults.set(`${nextStep.action.tool}.${nextStep.action.action}`, nextResult)
              writeLine({ react_step: { iteration: MAX_TOOL_ITERATIONS + 1 + postStep, phase: 'done', result: nextResult.slice(0, 200) } })
            }
          }
        } else if (corrected.response) {
          reactFinalResponse = corrected.response
        }
      }

      // toolHistoryMsgs: kept in original alternating format for the hidden chat history
      const toolHistoryMsgs: ChatMessage[] = accumulated.flatMap(s => [
        { role: 'assistant', content: `[Reasoning: ${s.thought}]\n${s.task.tool}.${s.task.action} ${JSON.stringify(s.task.args)}` },
        { role: 'user',      content: s.result.slice(0, 2000) },
      ])
      if (toolHistoryMsgs.length > 0) writeLine({ tool_history: toolHistoryMsgs })

      // ── Knowledge pipeline (fire-and-forget — does not block synthesis) ───────
      runKnowledgePipeline(messages as ChatMessage[], allTaskResults)

      // ── Wiki context injection — only when tools ran; never inject when accumulated is empty
      // to prevent the model from treating memory entries as live data.
      const goalPageIds  = new Set(goalPages.map(p => p.frontmatter.id))
      const nonGoalPages = listWikiPages().filter(p => !goalPageIds.has(p.frontmatter.id))
      const hasRealResults = accumulated.some(s =>
        s.task.action !== 'list_accounts' &&
        !s.result.startsWith('Error:') &&
        s.result !== '(no result)'
      )
      const rankedPages  = hasRealResults
        ? await rankWikiPages(String(lastUserMsg).slice(0, 500), nonGoalPages, ollamaUrl, model, 5)
        : []
      const wikiBlock    = rankedPages.length > 0
        ? `<user_preferences>\n${rankedPages.map(p =>
            `[${p.frontmatter.title}] (confidence: ${p.frontmatter.confidence})\n${p.body}`
          ).join('\n\n')}\n</user_preferences>`
        : ''

      // For synthesis: collapse tool results into a single context block so the model
      // doesn't confuse the alternating assistant/user tool-call format with its own output.
      // If no tools ran, inject an explicit "no data" notice so the model doesn't hallucinate.
      const toolResultsBlock = accumulated.length > 0
        ? `Here are the results from the tools I ran:\n\n${accumulated.map(s =>
            `[${s.task.tool}.${s.task.action}]\n${s.result.slice(0, 3000)}`
          ).join('\n\n---\n\n')}`
        : null

      const toolContextMsgs: ChatMessage[] = (() => {
        if (reactFinalResponse) {
          // ReAct decided to ask the user something (e.g. which accounts to search).
          // Pass that response as a hard directive — synthesis must deliver it verbatim.
          const base = toolResultsBlock ? `${toolResultsBlock}\n\n---\n\n` : ''
          return [{
            role: 'user' as const,
            content: `${base}Your response to the user MUST be exactly the following — do not rephrase, do not add searches, do not add commentary:\n\n${reactFinalResponse}`,
          }]
        }
        if (toolResultsBlock) {
          const hasErrors = accumulated.some(s => s.result.startsWith('Error:'))
          const errorNote = hasErrors
            ? ' CRITICAL: one or more tool calls returned an Error — do NOT claim those actions succeeded. Report what failed honestly.'
            : ''
          return [{
            role: 'user' as const,
            content: `${toolResultsBlock}\n\nNow answer the original question using ONLY the data above. Do NOT mention, infer, or invent any email, service, amount, or transaction that does not appear explicitly in the tool results above. IMPORTANT: Do NOT ask the user numbered questions or bullet-point option lists in your response — present findings as statements only.${errorNote}`,
          }]
        }
        return [{
          role: 'user' as const,
          content: `No tool results are available for this request — the data fetch did not complete. Do NOT invent, assume, or infer any data. Tell the user plainly that you were unable to retrieve the information and ask them to try again.`,
        }]
      })()

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
      debugLogger.close()
      try { await writer.close() } catch {}
    }
  })()

  return new Response(readable, { headers: NDJSON_HEADERS })
}
