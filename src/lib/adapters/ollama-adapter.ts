import { OLLAMA_BASE_URL } from '@/lib/ollama'
import type { ModelAdapter, ChatOptions, ChatResult } from '@/lib/model-adapter'

const contextLengthCache = new Map<string, number>()

export class OllamaAdapter implements ModelAdapter {
  async chat(opts: ChatOptions): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model:    opts.model,
      messages: opts.messages,
      stream:   false,
      tools:    opts.tools,
    }
    if (opts.think !== undefined) body.think = opts.think
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
    const data = await res.json()
    return {
      content:    data.message?.content ?? '',
      tool_calls: data.message?.tool_calls,
    }
  }

  async streamChat(opts: ChatOptions): Promise<ReadableStream<Uint8Array>> {
    const body: Record<string, unknown> = {
      model:    opts.model,
      messages: opts.messages,
      stream:   true,
    }
    if (opts.think !== undefined) body.think = opts.think
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok || !res.body) throw new Error('Ollama streaming error')
    return opts.think ? this.stripThinkingChunks(res.body) : res.body
  }

  // Qwen3 thinking mode: filter out thinking-only chunks, pass content chunks through
  private stripThinkingChunks(raw: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buf = ''
    return new ReadableStream({
      start(controller) {
        const reader = raw.getReader()
        ;(async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                if (buf.trim()) {
                  // flush remaining
                  try {
                    const chunk = JSON.parse(buf)
                    if (chunk.message?.content || chunk.done) {
                      controller.enqueue(encoder.encode(buf + '\n'))
                    }
                  } catch { controller.enqueue(encoder.encode(buf + '\n')) }
                }
                controller.close()
                return
              }
              buf += decoder.decode(value, { stream: true })
              const lines = buf.split('\n')
              buf = lines.pop() ?? ''
              for (const line of lines) {
                if (!line.trim()) continue
                try {
                  const chunk = JSON.parse(line)
                  // skip chunks that are thinking-only (no visible content)
                  if (chunk.message?.thinking !== undefined && !chunk.message?.content) continue
                  controller.enqueue(encoder.encode(line + '\n'))
                } catch {
                  controller.enqueue(encoder.encode(line + '\n'))
                }
              }
            }
          } catch (e) { controller.error(e) }
        })()
      },
    })
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`)
      if (!res.ok) return []
      const data = await res.json()
      return (data.models ?? []).map((m: { name: string }) => m.name)
    } catch { return [] }
  }

  async getContextLength(model: string): Promise<number> {
    if (contextLengthCache.has(model)) return contextLengthCache.get(model)!
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return 4096
      const info = await res.json()
      const len = info?.model_info?.context_length
               ?? info?.model_info?.['llama.context_length']
               ?? 4096
      contextLengthCache.set(model, len)
      return len
    } catch { return 4096 }
  }
}
