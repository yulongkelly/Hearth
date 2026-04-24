export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> | string }
}

export interface ChatOptions {
  model: string
  messages: ChatMessage[]
  tools?: object[]
  signal?: AbortSignal
}

export interface ChatResult {
  content: string
  tool_calls?: ToolCall[]
}

export interface ModelAdapter {
  chat(opts: ChatOptions): Promise<ChatResult>
  streamChat(opts: ChatOptions): Promise<ReadableStream<Uint8Array>>
  listModels?(): Promise<string[]>
  getContextLength?(model: string): Promise<number>
}
