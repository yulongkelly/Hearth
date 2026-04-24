import type { ModelAdapter, ChatOptions, ChatResult, ToolCall } from '@/lib/model-adapter'

class OpenAIToOllamaNDJSON extends TransformStream<Uint8Array, Uint8Array> {
  constructor(model: string) {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let buffer = ''
    super({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue
          try {
            const parsed = JSON.parse(trimmed.slice(6))
            const content     = parsed.choices?.[0]?.delta?.content ?? ''
            const finishReason = parsed.choices?.[0]?.finish_reason
            const done        = finishReason != null && finishReason !== ''
            controller.enqueue(encoder.encode(
              JSON.stringify({ model, message: { role: 'assistant', content }, done }) + '\n'
            ))
          } catch { /* partial chunk — wait for more */ }
        }
      },
      flush(controller) {
        controller.enqueue(encoder.encode(
          JSON.stringify({ model, message: { role: 'assistant', content: '' }, done: true }) + '\n'
        ))
      },
    })
  }
}

export class OpenAIAdapter implements ModelAdapter {
  private baseUrl: string
  private apiKey: string

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey  = apiKey
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    }
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model:    opts.model,
        messages: opts.messages,
        tools:    opts.tools,
        stream:   false,
      }),
      signal: opts.signal ?? AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI API error ${res.status}: ${err}`)
    }
    const data   = await res.json()
    const choice = data.choices?.[0]
    const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls?.map(
      (tc: { function: { name: string; arguments: string } }) => ({
        function: {
          name:      tc.function.name,
          arguments: (() => { try { return JSON.parse(tc.function.arguments) } catch { return tc.function.arguments } })(),
        },
      })
    )
    return {
      content:    choice?.message?.content ?? '',
      tool_calls: toolCalls?.length ? toolCalls : undefined,
    }
  }

  async streamChat(opts: ChatOptions): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model:    opts.model,
        messages: opts.messages,
        stream:   true,
      }),
    })
    if (!res.ok || !res.body) throw new Error('OpenAI streaming error')
    return res.body.pipeThrough(new OpenAIToOllamaNDJSON(opts.model))
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3_000),
      })
      if (!res.ok) return []
      const data = await res.json()
      return (data.data ?? []).map((m: { id: string }) => m.id)
    } catch { return [] }
  }

  async getContextLength(_model: string): Promise<number> {
    const override = process.env.HEARTH_LLM_CONTEXT_LENGTH
    return override ? parseInt(override, 10) : 4096
  }
}
