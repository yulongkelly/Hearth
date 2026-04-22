'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Plus, Trash2, ChevronDown, MessageSquare, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageItem } from './message-item'
import { cn, generateId, truncate, formatRelativeTime } from '@/lib/utils'
import type { Conversation, Message } from '@/lib/types'

const STORAGE_KEY = 'hearth_conversations'
const MODEL_KEY = 'hearth_default_model'

function loadConversations(): Conversation[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return parsed.map((c: Conversation) => ({
      ...c,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
      messages: c.messages.map((m: Message) => ({ ...m, createdAt: new Date(m.createdAt) })),
    }))
  } catch {
    return []
  }
}

function saveConversations(convos: Conversation[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(convos))
}

export function ChatInterface() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const activeConversation = conversations.find(c => c.id === activeId) ?? null

  useEffect(() => {
    const saved = loadConversations()
    if (saved.length > 0) {
      setConversations(saved)
      setActiveId(saved[0].id)
    }
    const savedModel = localStorage.getItem(MODEL_KEY) || ''
    if (savedModel) setSelectedModel(savedModel)
  }, [])

  const refreshModels = useCallback(() => {
    fetch('/api/ollama/tags')
      .then(r => r.json())
      .then(data => {
        if (data.error) { setOllamaError(data.error); return }
        const names: string[] = (data.models || []).map((m: { name: string }) => m.name)
        setModels(names)
        setOllamaError(null)
        if (!selectedModel && names.length > 0) {
          setSelectedModel(names[0])
          localStorage.setItem(MODEL_KEY, names[0])
        }
      })
      .catch(() => setOllamaError('Cannot connect to Ollama'))
  }, [selectedModel])

  useEffect(() => {
    refreshModels()
    const onFocus = () => refreshModels()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshModels])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeConversation?.messages])

  const createConversation = useCallback((): Conversation => {
    const now = new Date()
    return {
      id: generateId(),
      title: 'New conversation',
      model: selectedModel,
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
  }, [selectedModel])

  const newChat = useCallback(() => {
    const convo = createConversation()
    setConversations(prev => {
      const updated = [convo, ...prev]
      saveConversations(updated)
      return updated
    })
    setActiveId(convo.id)
    setInput('')
    textareaRef.current?.focus()
  }, [createConversation])

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== id)
      saveConversations(updated)
      return updated
    })
    setActiveId(prev => {
      if (prev === id) {
        return conversations.find(c => c.id !== id)?.id ?? null
      }
      return prev
    })
  }, [conversations])

  const sendMessage = useCallback(async () => {
    const content = input.trim()
    if (!content || isStreaming || !selectedModel) return

    let convoId = activeId
    let convo: Conversation

    if (!convoId) {
      convo = createConversation()
      convoId = convo.id
    } else {
      convo = conversations.find(c => c.id === convoId)!
    }

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content,
      createdAt: new Date(),
    }

    const assistantMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      createdAt: new Date(),
    }

    const title = convo.messages.length === 0 ? truncate(content, 40) : convo.title
    const ollamaMessages = [
      ...convo.messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content },
    ]

    const updatedConvo: Conversation = {
      ...convo,
      title,
      model: selectedModel,
      messages: [...convo.messages, userMsg, assistantMsg],
      updatedAt: new Date(),
    }

    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== convoId)
      const updated = [updatedConvo, ...filtered]
      saveConversations(updated)
      return updated
    })
    setActiveId(convoId)
    setInput('')
    setIsStreaming(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/ollama/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel, messages: ollamaMessages }),
        signal: ctrl.signal,
      })

      if (!res.ok || !res.body) {
        throw new Error('Stream failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter(l => l.trim())

        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            if (data.message?.content) {
              accumulated += data.message.content
              const content = accumulated
              setConversations(prev => {
                const updated = prev.map(c => {
                  if (c.id !== convoId) return c
                  const msgs = c.messages.map((m, i) =>
                    i === c.messages.length - 1 ? { ...m, content } : m
                  )
                  return { ...c, messages: msgs, updatedAt: new Date() }
                })
                saveConversations(updated)
                return updated
              })
            }
          } catch {
            // partial JSON chunk, skip
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setConversations(prev => {
          const updated = prev.map(c => {
            if (c.id !== convoId) return c
            const msgs = c.messages.map((m, i) =>
              i === c.messages.length - 1
                ? { ...m, content: '⚠️ Error: Failed to get response from Ollama.' }
                : m
            )
            return { ...c, messages: msgs }
          })
          saveConversations(updated)
          return updated
        })
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, isStreaming, selectedModel, activeId, conversations, createConversation])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const stopStreaming = () => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }

  const onModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value)
    localStorage.setItem(MODEL_KEY, e.target.value)
  }

  const activeMessages = activeConversation?.messages ?? []

  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversation sidebar */}
      <div
        className={cn(
          'flex flex-col border-r border-border bg-card transition-all duration-200',
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden',
          // On mobile: overlay instead of push
          sidebarOpen && 'absolute inset-y-0 left-0 z-20 md:relative'
        )}
      >
        <div className="flex h-14 flex-shrink-0 items-center justify-between px-3 border-b border-border">
          <span className="text-sm font-medium text-foreground">Conversations</span>
          <Button size="sm" variant="ghost" onClick={newChat} className="h-8 w-8 p-0">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No conversations yet.</p>
              <p className="text-xs text-muted-foreground">Start a new chat!</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 p-2">
              {conversations.map(convo => (
                <button
                  key={convo.id}
                  onClick={() => setActiveId(convo.id)}
                  className={cn(
                    'group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors',
                    convo.id === activeId
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{convo.title}</p>
                    <p className="truncate text-[10px] text-muted-foreground mt-0.5">
                      {formatRelativeTime(convo.updatedAt)}
                    </p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); deleteConversation(convo.id) }}
                    className="ml-1 hidden group-hover:flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <div className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-border px-4">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', sidebarOpen ? '-rotate-90' : 'rotate-90')}
            />
          </button>

          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium">
              {activeConversation?.title ?? 'New conversation'}
            </p>
          </div>

          {/* Model selector */}
          {models.length > 0 && (
            <select
              value={selectedModel}
              onChange={onModelChange}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>

        {/* Ollama error banner */}
        {ollamaError && (
          <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5">
            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
            <p className="text-xs text-destructive">{ollamaError}</p>
            <a href="/models" className="ml-auto text-xs text-primary underline">Go to Models →</a>
          </div>
        )}

        {/* Messages */}
        <ScrollArea className="flex-1">
          <div className="flex flex-col py-4">
            {activeMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-20 px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <MessageSquare className="h-8 w-8 text-primary/70" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">How can I help?</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedModel
                      ? `Using ${selectedModel} — running locally on your machine.`
                      : 'Select a model to get started.'}
                  </p>
                </div>
                {!selectedModel && models.length === 0 && !ollamaError && (
                  <p className="text-xs text-muted-foreground">
                    No models found.{' '}
                    <a href="/models" className="text-primary underline">Download a model →</a>
                  </p>
                )}
              </div>
            ) : (
              activeMessages.map((msg, i) => (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  isStreaming={isStreaming && i === activeMessages.length - 1 && msg.role === 'assistant'}
                />
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="border-t border-border p-4">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedModel ? `Message ${selectedModel}…` : 'Select a model first…'}
              disabled={!selectedModel || !!ollamaError}
              rows={1}
              className="flex-1 border-0 bg-transparent p-2 text-sm focus-visible:ring-0 resize-none min-h-[40px] max-h-[160px]"
              style={{ height: 'auto' }}
              onInput={e => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 160) + 'px'
              }}
            />
            {isStreaming ? (
              <Button
                size="icon"
                variant="ghost"
                onClick={stopStreaming}
                className="flex-shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={sendMessage}
                disabled={!input.trim() || !selectedModel || !!ollamaError}
                className="flex-shrink-0 h-9 w-9"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            All AI processing happens locally on your machine. Your data never leaves your computer.
          </p>
        </div>
      </div>
    </div>
  )
}
