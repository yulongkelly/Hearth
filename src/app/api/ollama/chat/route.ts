import { NextRequest } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'
import type { OllamaChatMessageWithTools } from '@/lib/ollama'
import { getAvailableTools, executeTool, toolStatusLabel } from '@/lib/tools'
import type { UserTool, ToolParameter } from '@/lib/user-tools'
import { getToolAccess, buildPreview } from '@/lib/tool-access'
import { waitForApproval } from '@/lib/approval-store'

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Transfer-Encoding': 'chunked',
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
}

const MAX_TOOL_ITERATIONS = 5

const SYSTEM_MESSAGE = `You have access to the user's Gmail and Google Calendar via function tools. When the user asks about their email, inbox, or calendar events, ALWAYS call the appropriate tool to fetch real data — do not say you cannot access these services.

You can also create reusable sidebar tools using the create_tool function. Before calling create_tool you MUST:
1. Ask 1–2 clarifying questions about what the tool should do.
2. Confirm each parameter's name, label, and type with the user. For date parameters, explicitly ask whether they want a full date (YYYY-MM-DD picked from a calendar), a year only, a month/year, or a relative value like "last week". Use type "date" only for full calendar dates, "text" for relative/freeform, "number" for numeric values.
3. Show the user the planned parameter list and prompt template before saving — let them confirm or adjust.
Each tool must have ONE core functionality. If a user describes multiple goals, list them and suggest separate tools.`

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
      const systemMsg: OllamaChatMessageWithTools = { role: 'system', content: SYSTEM_MESSAGE }
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
            const access = getToolAccess(tc.function.name)

            // ── Safety gate: pause for user approval on write/destructive tools ──
            if (access !== 'read') {
              const approvalId = crypto.randomUUID()
              writeLine({
                pending_approval: {
                  id: approvalId,
                  tool: tc.function.name,
                  preview: buildPreview(tc.function.name, args),
                  risk: access,
                },
              })
              const approved = await waitForApproval(approvalId)
              if (!approved) return 'Action rejected by user.'
            }

            // ── create_tool handled inline ────────────────────────────────────
            if (tc.function.name === 'create_tool') {
              writeLine({ tool_status: toolStatusLabel('create_tool') })
              const newTool: UserTool = {
                id: crypto.randomUUID(),
                name: String(args.name ?? ''),
                description: String(args.description ?? ''),
                icon: String(args.icon ?? 'FileText'),
                parameters: (args.parameters as ToolParameter[]) ?? [],
                prompt: String(args.prompt ?? ''),
                createdAt: new Date().toISOString(),
                runs: [],
              }
              writeLine({ tool_created: newTool })
              return 'Tool created and saved to the sidebar.'
            }

            writeLine({ tool_status: toolStatusLabel(tc.function.name) })
            return executeTool(tc.function.name, tc.function.arguments)
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
