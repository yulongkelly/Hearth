import { OLLAMA_BASE_URL } from '@/lib/ollama'
import type { ModelAdapter, ChatOptions, ChatResult } from '@/lib/model-adapter'

export class OllamaAdapter implements ModelAdapter {
  async chat(opts: ChatOptions): Promise<ChatResult> {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    opts.model,
        messages: opts.messages,
        stream:   false,
        tools:    opts.tools,
      }),
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
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    opts.model,
        messages: opts.messages,
        stream:   true,
      }),
    })
    if (!res.ok || !res.body) throw new Error('Ollama streaming error')
    return res.body
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
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return 4096
      const info = await res.json()
      return info?.model_info?.context_length
          ?? info?.model_info?.['llama.context_length']
          ?? 4096
    } catch { return 4096 }
  }
}
