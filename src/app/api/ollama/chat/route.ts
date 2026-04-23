import { NextRequest } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'
import type { OllamaChatMessageWithTools } from '@/lib/ollama'
import { getAvailableTools, toolStatusLabel } from '@/lib/tools'
import { getToolAccess, buildPreview } from '@/lib/tool-access'
import { waitForApproval } from '@/lib/approval-store'
import { buildTask } from '@/lib/butler/task-builder'
import { executeTask } from '@/lib/butler/executor'
import { waitForAnswers } from '@/lib/questions-store'
import { readMemory, readMemoryTrimmed, addEntry, replaceEntry, removeEntry } from '@/lib/memory-store'
import type { MemoryTarget } from '@/lib/memory-store'
import { compile, compileRetryPrompt } from '@/lib/workflow-compiler'
import type { WorkflowTool } from '@/lib/workflow-tools'
import { appendEvent } from '@/lib/event-store'

const EVENT_SKIP = new Set(['memory', 'ask_clarification', 'create_workflow', 'query_events'])

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Transfer-Encoding': 'chunked',
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
}

const MAX_TOOL_ITERATIONS = 5

const SYSTEM_MESSAGE = `You have access to the user's Gmail and Google Calendar via function tools. When the user asks about their email, inbox, or calendar events, ALWAYS call the appropriate tool to fetch real data — do not say you cannot access these services.

You can create reusable workflow tools using create_workflow. Before calling create_workflow you MUST call ask_clarification — do NOT write questions as plain text in the chat. ask_clarification shows a structured popup with clickable options. Ask about: which data sources (Gmail/Calendar), which accounts, what time range, and what output the user wants. NEVER ask where to save — it is always saved to the sidebar. After clarification, call create_workflow immediately with the workflow JSON. The workflow steps MUST use ONLY these exact names: get_calendar_events, get_inbox, read_email, merge_lists, detect_conflicts, filter_events, summarize. Do NOT invent step names. Do NOT explain — just call the tools.

You have a persistent memory system. Use the memory tool to save facts that will be useful in future sessions. Save proactively — do not wait to be asked. Save when: the user states a preference or habit, corrects you, shares personal details (name, role, timezone, tech stack), or you learn a stable convention about their workflow. Do NOT save: task progress, session outcomes, completed TODOs, or transient data.`

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

  const availableTools = getAvailableTools()

  // Fetch model context window for memory budget calculation
  let contextLength = 4096
  try {
    const showRes = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5_000),
    })
    if (showRes.ok) {
      const info = await showRes.json()
      contextLength = info?.model_info?.context_length ?? info?.model_info?.['llama.context_length'] ?? 4096
    }
  } catch { /* fallback to 4096 */ }

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
    writer.write(encoder.encode(JSON.stringify(obj) + '\n'))
  }

  async function streamOllama(msgs: OllamaChatMessageWithTools[]) {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: msgs, stream: true }),
    })
    if (!res.ok || !res.body) {
      writeLine({ error: 'Ollama streaming error' })
      return
    }
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      await writer.write(value)
    }
  }

  ;(async () => {
    try {
      const hasSystem = messages.some((m: OllamaChatMessageWithTools) => m.role === 'system')
      const systemMsg: OllamaChatMessageWithTools = { role: 'system', content: fullSystemMessage }
      let loopMessages: OllamaChatMessageWithTools[] = hasSystem ? [...messages] : [systemMsg, ...messages]

      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: loopMessages, stream: false, tools: availableTools }),
          signal: AbortSignal.timeout(60_000),
        })

        if (!ollamaRes.ok) {
          await streamOllama(messages)
          return
        }

        const data = await ollamaRes.json()
        const assistantMsg: OllamaChatMessageWithTools = data.message

        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
          writeLine({ message: { role: 'assistant', content: assistantMsg.content }, done: false })
          writeLine({ message: { role: 'assistant', content: '' }, done: true })
          return
        }

        loopMessages.push(assistantMsg)

        const results = await Promise.all(
          assistantMsg.tool_calls.map(async tc => {
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
              const questions = (args.questions as Array<{ question: string; options: string[] }>) ?? []
              const id = crypto.randomUUID()
              writeLine({ pending_questions: { id, questions } })
              const answers = await waitForAnswers(id)
              return questions.map((q, i) => `Q: ${q.question}\nA: ${answers[i] ?? '(no answer)'}`).join('\n\n')
            }

            // ── create_workflow: compile → retry if invalid → emit pending_workflow ─
            if (tc.function.name === 'create_workflow') {
              writeLine({ tool_status: 'Building workflow…' })

              let compiled = compile(tc.function.arguments)

              // Retry up to 2x if the model output was invalid JSON / bad step names
              for (let retry = 0; !compiled.ok && retry < 2; retry++) {
                const retryMessages: OllamaChatMessageWithTools[] = [
                  ...loopMessages,
                  { role: 'tool', content: compileRetryPrompt(compiled.error ?? 'unknown error') },
                ]
                const retryRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ model, messages: retryMessages, stream: false, tools: availableTools }),
                  signal: AbortSignal.timeout(60_000),
                })
                if (!retryRes.ok) break
                const retryData = await retryRes.json()
                const retryMsg: OllamaChatMessageWithTools = retryData.message
                if (retryMsg?.tool_calls?.[0]?.function?.name === 'create_workflow') {
                  compiled = compile(retryMsg.tool_calls[0].function.arguments)
                } else {
                  break
                }
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
              requireApproval: async (t) => {
                const id = crypto.randomUUID()
                writeLine({
                  pending_approval: {
                    id,
                    tool:    t.toolName,
                    preview: buildPreview(t.toolName, t.args),
                    risk:    getToolAccess(t.toolName),
                  },
                })
                return waitForApproval(id)
              },
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

      await streamOllama(loopMessages)
    } catch (err) {
      writeLine({ error: err instanceof Error ? err.message : 'Tool loop error' })
    } finally {
      writer.close()
    }
  })()

  return new Response(readable, { headers: NDJSON_HEADERS })
}
