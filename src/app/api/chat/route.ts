import { NextRequest } from 'next/server'
import { getModelAdapter } from '@/lib/adapters/registry'
import type { ChatMessage } from '@/lib/model-adapter'
import { getAvailableTools, toolStatusLabel } from '@/lib/tools'
import { buildTask } from '@/lib/butler/task-builder'
import { executeTask } from '@/lib/butler/executor'
import { waitForAnswers } from '@/lib/questions-store'
import { waitForConnection } from '@/lib/connection-answer-store'
import { readMemory, readMemoryTrimmed, addEntry, replaceEntry, removeEntry } from '@/lib/memory-store'
import type { MemoryTarget } from '@/lib/memory-store'
import { compile, compileRetryPrompt } from '@/lib/workflow-compiler'
import type { WorkflowTool } from '@/lib/workflow-tools'
import { appendEvent } from '@/lib/event-store'

const EVENT_SKIP = new Set(['memory', 'ask_clarification', 'create_workflow', 'query_events', 'web_search', 'request_connection'])

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
2. Call web_search to find the API documentation and required credentials.
3a. If you find enough info: call request_connection with full setup details, exact credential fields (use type "password" for secrets), and a test_url if the API has a simple endpoint to verify (like /user/info or /status).
3b. If you cannot find API access info or it requires complex OAuth: tell the user you cannot connect to that service and suggest alternatives.
4. After connection is verified: confirm the specific action with the user, then call create_workflow using http_request steps with connection: "<service name>".

http_request step params: url (full URL or path relative to connection base), method (GET/POST/etc.), body (JSON string, optional), connection (name of registered connection), headers (extra headers, optional).

You have a persistent memory system. Use the memory tool to save facts that will be useful in future sessions. Save proactively — do not wait to be asked.`

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

  const memBlock  = readMemoryTrimmed('memory', perFileBudget)
  const userBlock = readMemoryTrimmed('user', perFileBudget)
  const memorySection = [
    memBlock  ? `<memory>\n${memBlock}\n</memory>`                  : '',
    userBlock ? `<user_profile>\n${userBlock}\n</user_profile>` : '',
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
                case 'read':    return readMemory(t)
                case 'add':     return addEntry(t, content)
                case 'replace': return replaceEntry(t, old_content, content)
                case 'remove':  return removeEntry(t, old_content)
                default:        return 'Error: unknown memory action'
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

      await streamFinal(loopMessages)
    } catch (err) {
      writeLine({ error: err instanceof Error ? err.message : 'Tool loop error' })
    } finally {
      try { await writer.close() } catch {}
    }
  })()

  return new Response(readable, { headers: NDJSON_HEADERS })
}
