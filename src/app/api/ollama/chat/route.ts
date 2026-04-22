import { NextRequest } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'
import type { OllamaChatMessageWithTools } from '@/lib/ollama'
import { getAvailableTools, executeTool, toolStatusLabel } from '@/lib/tools'

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Transfer-Encoding': 'chunked',
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
}

const MAX_TOOL_ITERATIONS = 5

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { model, messages } = body

  if (!model || !messages) {
    return new Response(JSON.stringify({ error: 'model and messages are required' }), { status: 400 })
  }

  const availableTools = getAvailableTools()

  // ── No tools: direct streaming proxy (unchanged behavior) ───────────────────
  if (!availableTools) {
    try {
      const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true }),
      })
      if (!ollamaRes.ok) {
        const errText = await ollamaRes.text()
        return new Response(JSON.stringify({ error: errText || 'Ollama error' }), { status: ollamaRes.status })
      }
      return new Response(ollamaRes.body, { headers: NDJSON_HEADERS })
    } catch {
      return new Response(JSON.stringify({ error: 'Cannot connect to Ollama' }), { status: 503 })
    }
  }

  // ── Tools available: tool loop with TransformStream ─────────────────────────
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

  // Run tool loop async so we can return the Response immediately
  ;(async () => {
    try {
      let loopMessages: OllamaChatMessageWithTools[] = [...messages]
      let usedTools = false

      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        // Non-streaming request with tools
        const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: loopMessages, stream: false, tools: availableTools }),
          signal: AbortSignal.timeout(60_000),
        })

        // Model doesn't support tools — fall back to plain stream
        if (!ollamaRes.ok) {
          await streamOllama(messages)
          return
        }

        const data = await ollamaRes.json()
        const assistantMsg: OllamaChatMessageWithTools = data.message

        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
          // No tool calls — write content and finish
          if (!usedTools) {
            // Model answered without tools — stream directly for better UX
            await streamOllama(loopMessages)
          } else {
            writeLine({ message: { role: 'assistant', content: assistantMsg.content }, done: false })
            writeLine({ message: { role: 'assistant', content: '' }, done: true })
          }
          return
        }

        usedTools = true
        loopMessages.push(assistantMsg)

        // Execute all tool calls in parallel
        const results = await Promise.all(
          assistantMsg.tool_calls.map(async tc => {
            writeLine({ tool_status: toolStatusLabel(tc.function.name) })
            const result = await executeTool(tc.function.name, tc.function.arguments)
            return result
          })
        )

        // Append each tool result
        for (const result of results) {
          loopMessages.push({ role: 'tool', content: result })
        }
      }

      // Max iterations reached — stream final answer with accumulated context
      await streamOllama(loopMessages)
    } catch (err) {
      writeLine({ error: err instanceof Error ? err.message : 'Tool loop error' })
    } finally {
      writer.close()
    }
  })()

  return new Response(readable, { headers: NDJSON_HEADERS })
}
