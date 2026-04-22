export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: Date
}

export interface Conversation {
  id: string
  title: string
  model: string
  messages: Message[]
  createdAt: Date
  updatedAt: Date
}

export interface AppSettings {
  ollamaUrl: string
  defaultModel: string
  theme: 'dark' | 'light' | 'system'
  fontSize: 'sm' | 'md' | 'lg'
  streamingEnabled: boolean
  systemPrompt: string
}

export interface GmailStatus {
  configured: boolean
  connected: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  ollamaUrl: 'http://localhost:11434',
  defaultModel: '',
  theme: 'dark',
  fontSize: 'md',
  streamingEnabled: true,
  systemPrompt: 'You are a helpful, harmless, and honest AI assistant.',
}
