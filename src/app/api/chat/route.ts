import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getModelAdapter } from '@/lib/adapters/registry'
import type { ChatMessage } from '@/lib/model-adapter'
import { getAvailableTools, toolStatusLabel } from '@/lib/tools'
import { buildTask } from '@/lib/butler/task-builder'
import { executeTask } from '@/lib/butler/executor'
import { waitForAnswers } from '@/lib/questions-store'
import { waitForConnection } from '@/lib/connection-answer-store'
import { readMemory, readMemoryTrimmed, readMemoryEntries, queueMemoryWrite, flushMemoryQueue, replaceEntry, removeEntry } from '@/lib/memory-store'
import type { MemoryTarget } from '@/lib/memory-store'
import { validateMemoryEntry } from '@/lib/memory-validator'
import { retrieveRelevantMemory } from '@/lib/memory-retrieval'
import { compile, compileRetryPrompt } from '@/lib/workflow-compiler'
import type { WorkflowTool } from '@/lib/workflow-tools'
import { appendEvent } from '@/lib/event-store'
import { OLLAMA_BASE_URL } from '@/lib/ollama'

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

const SYSTEM_MESSAGE = `You have access to the user's Gmail and Google Calendar via function tools. When the user asks about their email, inbox, or calendar events, ALWAYS call the appropriate tool to fetch real data — do not say you cannot access these services.

You can create reusable workflow tools using create_workflow. Before calling create_workflow you MUST call ask_clarification — do NOT write questions as plain text in the chat. ask_clarification shows a structured popup with clickable options. Ask about: which data sources (Gmail/Calendar), which accounts, what time range, and what output the user wants. NEVER ask where to save — it is always saved to the sidebar. After clarification, call create_workflow immediately with the workflow JSON. The workflow steps MUST use ONLY these exact names: get_calendar_events, get_inbox, read_email, get_transactions, http_request, merge_lists, detect_conflicts, filter_events, summarize. Do NOT invent step names. Do NOT explain — just call the tools.

CONNECTING NEW SERVICES: When the user wants to connect or use an external API or service you don't have built-in access to (e.g. smart home devices, custom APIs):
1. Call ask_clarification to confirm they want to set up the connection (1 question, yes/no).
2. Call query_capabilities with the service name first. If it returns a capability spec, use those credential fields directly in request_connection — skip web_search entirely. Only call web_search if query_capabilities returns nothing.
3a. If you find enough info: call request_connection with full setup details, exact credential fields (use type "password" for secrets), and a test_url if the API has a simple endpoint to verify (like /user/info or /status).
3b. If you cannot find API access info or it requires complex OAuth: tell the user you cannot connect to that service and suggest alternatives.
4. After connection is verified: confirm the specific action with the user, then call create_workflow using http_request steps with connection: "<service name>".

http_request step params: url (full URL or path relative to connection base), method (GET/POST/etc.), body (JSON string, optional), connection (name of registered connection), headers (extra headers, optional).

You have a persistent memory system. Use the memory tool to save facts that will be useful in future sessions. Save proactively — do not wait to be asked. Do NOT save which integrations or bots are connected — you can tell what's connected by which tools are available to you (e.g. if get_qq_messages is in your tool list, QQ is connected). Store user preferences and personal details, not system state.

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

  const adapter        = getModelAdapter()
  const availableTools = getAvailableTools()

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

  const memorySection = [
    hearthMd  ? `<hearth>\n${hearthMd}\n</hearth>`              : '',
    userBlock ? `<user_profile>\n${userBlock}\n</user_profile>` : '',
    memBlock  ? `<memory>\n${memBlock}\n</memory>`              : '',
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
      const stream = await adapter.streamChat({ model, messages: msgs })
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
      let loopMessages: ChatMessage[] = hasSystem ? [...messages] : [systemMsg, ...messages]
      let clarificationDone = false

      function emitToolHistory() {
        const toolMessages = loopMessages
          .filter(m => m.role === 'tool' || (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0))
          .map(m => ({
            role: m.role,
            content: m.content.length > 2000 ? m.content.slice(0, 2000) + '\n[trimmed]' : m.content,
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          }))
        if (toolMessages.length > 0) writeLine({ tool_history: toolMessages })
      }

      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        let result
        try {
          result = await adapter.chat({
            model,
            messages: loopMessages,
            tools: availableTools,
            signal: AbortSignal.timeout(60_000),
          })
        } catch {
          await streamFinal(messages)
          return
        }

        const assistantMsg: ChatMessage = {
          role:       'assistant',
          content:    result.content,
          tool_calls: result.tool_calls,
        }

        if (!result.tool_calls || result.tool_calls.length === 0) {
          // If the model wrote clarification questions as text instead of calling ask_clarification,
          // intercept them, show the popup, then continue the loop with the answers.
          if (!clarificationDone && result.content) {
            const parsed = parseQuestionsFromText(result.content)
            if (parsed) {
              clarificationDone = true
              const id = crypto.randomUUID()
              writeLine({ pending_questions: { id, questions: parsed } })
              const answers = await waitForAnswers(id)
              const answersText = parsed.map((q, j) => `Q: ${q.question}\nA: ${answers[j] ?? '(no answer)'}`).join('\n\n')
              loopMessages.push({ role: 'assistant', content: result.content })
              loopMessages.push({ role: 'user', content: `Here are my answers:\n\n${answersText}\n\nNow call create_workflow immediately.` })
              continue
            }
          }
          emitToolHistory()
          writeLine({ message: { role: 'assistant', content: assistantMsg.content }, done: false })
          writeLine({ message: { role: 'assistant', content: '' }, done: true })
          return
        }

        loopMessages.push(assistantMsg)

        const results = await Promise.all(
          result.tool_calls.map(async tc => {
            const args = parseArgs(tc.function.arguments)

            // ── memory: read/write persistent memory files ────────────────────
            if (tc.function.name === 'memory') {
              writeLine({ tool_status: toolStatusLabel('memory') })
              const { action, target, content = '', old_content = '' } = args as Record<string, string>
              const t = (target === 'memory' || target === 'user') ? target as MemoryTarget : 'memory'
              switch (action) {
                case 'read': return readMemory(t)
                case 'add': {
                  const v = validateMemoryEntry(content)
                  if (!v.valid) return `Rejected: ${v.reason}. Rewrite as a concise stable fact.`
                  queueMemoryWrite(t, 'add', content, ollamaUrl, model)
                  return 'Queued.'
                }
                case 'replace': {
                  queueMemoryWrite(t, 'replace', content, ollamaUrl, model, old_content)
                  return 'Queued.'
                }
                case 'remove': {
                  queueMemoryWrite(t, 'remove', old_content, ollamaUrl, model)
                  return 'Queued.'
                }
                default: return 'Error: unknown memory action'
              }
            }

            // ── ask_clarification: show question popup, wait for answers ─────
            if (tc.function.name === 'ask_clarification') {
              if (clarificationDone) return 'Clarification already collected. Proceed with create_workflow now.'
              clarificationDone = true
              const rawQ = args.questions
              const questions: Array<{ question: string; options: string[] }> = Array.isArray(rawQ) ? rawQ.filter((q: unknown) => q && typeof (q as { question?: unknown }).question === 'string' && Array.isArray((q as { options?: unknown }).options) && (q as { options: unknown[] }).options.length > 0) : []
              if (questions.length === 0) {
                clarificationDone = false
                return 'Error: ask_clarification called with no valid questions. Call it again with at least one question and 2–4 options.'
              }
              const id = crypto.randomUUID()
              writeLine({ pending_questions: { id, questions } })
              const answers = await waitForAnswers(id)
              return questions.map((q, i) => `Q: ${q.question}\nA: ${answers[i] ?? '(no answer)'}`).join('\n\n')
            }

            // ── request_connection: show connection setup form, wait for result ────
            if (tc.function.name === 'request_connection') {
              const id = crypto.randomUUID()
              writeLine({ pending_connection: { id, ...args } })
              const result = await waitForConnection(id)
              if (!result.ok) {
                return `Connection setup failed or was cancelled: ${result.error ?? 'unknown reason'}. Ask the user if they want to try again.`
              }
              return `Connection to ${args.service} verified successfully (id: ${result.connectionId}). Now confirm the specific workflow action with the user, then call create_workflow.`
            }

            // ── create_workflow: compile → retry if invalid → emit pending_workflow ─
            if (tc.function.name === 'create_workflow') {
              writeLine({ tool_status: 'Building workflow…' })

              let compiled = compile(tc.function.arguments)

              for (let retry = 0; !compiled.ok && retry < 2; retry++) {
                const retryMessages: ChatMessage[] = [
                  ...loopMessages,
                  { role: 'tool', content: compileRetryPrompt(compiled.error ?? 'unknown error') },
                ]
                try {
                  const retryResult = await adapter.chat({
                    model,
                    messages: retryMessages,
                    tools: availableTools,
                    signal: AbortSignal.timeout(60_000),
                  })
                  if (retryResult.tool_calls?.[0]?.function?.name === 'create_workflow') {
                    compiled = compile(retryResult.tool_calls[0].function.arguments)
                  } else {
                    break
                  }
                } catch { break }
              }

              if (!compiled.ok) {
                return `Error building workflow: ${compiled.error}. Please try again with a simpler description.`
              }

              const pendingWorkflow: WorkflowTool = {
                ...compiled.workflow!,
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                runs: [],
              }
              writeLine({ pending_workflow: pendingWorkflow })
              return `Workflow plan shown to user for review. They can edit the steps and save it to the sidebar.`
            }

            const task = buildTask(tc.function.name, args)
            return executeTask(task, {
              requireApproval: async () => true,
              emitStatus: (msg) => writeLine({ tool_status: msg }),
              logEvent:   (t, res) => {
                if (!EVENT_SKIP.has(t.toolName))
                  appendEvent({ type: 'tool_call', tool: t.toolName, args: t.args, result: res.slice(0, 500) })
              },
            })
          })
        )

        for (const result of results) {
          loopMessages.push({ role: 'tool', content: result })
        }
      }

      emitToolHistory()
      await streamFinal(loopMessages)
    } catch (err) {
      writeLine({ error: err instanceof Error ? err.message : 'Tool loop error' })
    } finally {
      await flushMemoryQueue(ollamaUrl, model).catch(() => {})
      try { await writer.close() } catch {}
    }
  })()

  return new Response(readable, { headers: NDJSON_HEADERS })
}
