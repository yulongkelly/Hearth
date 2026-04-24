'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Plus, Trash2, ChevronDown, MessageSquare, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageItem } from './message-item'
import { cn, generateId, truncate, formatRelativeTime } from '@/lib/utils'
import type { Conversation, Message } from '@/lib/types'
import { addUserTool, type UserTool } from '@/lib/user-tools'
import { addWorkflowTool, type WorkflowTool } from '@/lib/workflow-tools'
import { QuestionsPopup, type ClarificationQuestion } from './questions-popup'
import { ConnectionSetupCard } from './connection-setup-card'
import { WorkflowPlanEditor } from '@/components/tools/workflow-plan-editor'
import type { ToolAccess } from '@/lib/tool-access'
import * as ChatStore from '@/lib/chat-store'

const STORAGE_KEY = 'hearth_conversations'
const MODEL_KEY = 'hearth_default_model'
const SETTINGS_KEY = 'hearth_settings'

function loadMemoryThreshold(): number {
  if (typeof window === 'undefined') return 0.20
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return 0.20
    const parsed = JSON.parse(raw)
    return typeof parsed.memoryThreshold === 'number' ? parsed.memoryThreshold : 0.20
  } catch { return 0.20 }
}

const MAX_CONVERSATIONS = 50
const STALE_HIDDEN_MS   = 7 * 24 * 60 * 60 * 1000  // 7 days

// Applies two policies: cap total conversations and strip hidden tool messages from
// conversations that haven't been touched in 7+ days (their findings should be in
// memory files by then; raw tool traces are no longer useful for context).
function cleanConversations(convos: Conversation[]): Conversation[] {
  const cutoff = Date.now() - STALE_HIDDEN_MS
  return convos
    .slice(0, MAX_CONVERSATIONS)
    .map(c =>
      new Date(c.updatedAt).getTime() < cutoff
        ? { ...c, messages: c.messages.filter(m => !m.hidden) }
        : c
    )
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      try {
        const existing = localStorage.getItem(key)
        if (existing) {
          const arr = JSON.parse(existing) as Conversation[]
          const half = arr.slice(0, Math.ceil(arr.length / 2))
          localStorage.setItem(key, JSON.stringify(half))
        }
      } catch {}
    }
  }
}

function loadConversations(): Conversation[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const reconstructed = parsed.map((c: Conversation) => ({
      ...c,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
      messages: c.messages.map((m: Message) => ({ ...m, createdAt: new Date(m.createdAt) })),
    }))
    return cleanConversations(reconstructed)
  } catch {
    return []
  }
}

function saveConversations(convos: Conversation[]) {
  if (typeof window === 'undefined') return
  safeSetItem(STORAGE_KEY, JSON.stringify(cleanConversations(convos)))
}

// Writes streaming content directly to localStorage without going through React state.
// This ensures content is persisted even when the component is unmounted (user navigated away).
function persistStreamingContent(convoId: string, content: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const convos = JSON.parse(raw)
    const updated = convos.map((c: Conversation) => {
      if (c.id !== convoId) return c
      const msgs = [...c.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content }
      return { ...c, messages: msgs, updatedAt: new Date().toISOString() }
    })
    safeSetItem(STORAGE_KEY, JSON.stringify(updated))
  } catch {}
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
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ id: string; tool: string; preview: string; risk: ToolAccess }>>([])
  const [pendingQuestions, setPendingQuestions] = useState<{ id: string; questions: ClarificationQuestion[] } | null>(null)
  const [pendingConnection, setPendingConnection] = useState<ChatStore.PendingConnection | null>(null)
  const [pendingTool, setPendingTool] = useState<UserTool | null>(null)
  const [pendingWorkflow, setPendingWorkflow] = useState<WorkflowTool | null>(null)

  async function handleAnswers(id: string, answers: string[]) {
    setPendingQuestions(null)
    ChatStore.setPendingQuestions(null)
    await fetch('/api/tools/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, answers }),
    })
  }

  async function handleApproval(id: string, approved: boolean) {
    setPendingApprovals(prev => prev.filter(a => a.id !== id))
    ChatStore.removePendingApproval(id)
    await fetch('/api/tools/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, approved }),
    })
  }
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const activeConversation = conversations.find(c => c.id === activeId) ?? null

  useEffect(() => {
    const saved = loadConversations()
    const stream = ChatStore.getActiveStream()
    setConversations(saved)
    if (stream) {
      // Resume display of an in-progress stream started before navigation
      setActiveId(stream.convoId)
      setIsStreaming(true)
      setToolStatus(stream.toolStatus)
      setPendingApprovals(stream.pendingApprovals)
      setPendingQuestions(stream.pendingQuestions)
      setPendingConnection(stream.pendingConnection)
      setPendingTool(stream.pendingTool)
      setPendingWorkflow(stream.pendingWorkflow)
    } else if (saved.length > 0) {
      setActiveId(saved[0].id)
    }
    const savedModel = localStorage.getItem(MODEL_KEY) || ''
    if (savedModel) setSelectedModel(savedModel)
  }, [])

  // Sync streaming state from global store (fires when stream state changes)
  useEffect(() => {
    return ChatStore.subscribe(() => {
      const stream = ChatStore.getActiveStream()
      setIsStreaming(!!stream)
      if (stream) {
        setToolStatus(stream.toolStatus)
        setPendingApprovals(stream.pendingApprovals)
        setPendingQuestions(stream.pendingQuestions)
        setPendingConnection(stream.pendingConnection)
        setPendingTool(stream.pendingTool)
        setPendingWorkflow(stream.pendingWorkflow)
      } else {
        setToolStatus(null)
        setPendingApprovals([])
        setPendingQuestions(null)
        setPendingConnection(null)
        setPendingTool(null)
        setPendingWorkflow(null)
        // Reload from localStorage to pick up content written while away
        setConversations(loadConversations())
      }
    })
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
      .catch(() => setOllamaError('Cannot connect to the AI model'))
  }, [selectedModel])

  useEffect(() => {
    refreshModels()
    const interval = setInterval(refreshModels, 10000)
    return () => clearInterval(interval)
  }, [refreshModels])

  useEffect(() => {
    fetch('/api/gmail/status')
      .then(r => r.json())
      .then(data => setGoogleConnected(!!(data.configured && data.connected)))
      .catch(() => {})
  }, [])

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

    // Only send the most recent hidden tool messages to avoid ballooning the context
    // window in long conversations. Hidden messages arrive as assistant+tool pairs, so
    // HIDDEN_KEEP must be even to never send an orphaned tool result.
    const HIDDEN_THRESHOLD = 20
    const HIDDEN_KEEP      = 10
    const hiddenMsgs = convo.messages.filter(m => m.hidden)
    const keepHiddenIds = hiddenMsgs.length > HIDDEN_THRESHOLD
      ? new Set(hiddenMsgs.slice(-HIDDEN_KEEP).map(m => m.id))
      : null

    const ollamaMessages = [
      ...convo.messages
        .filter(m => !m.hidden || keepHiddenIds === null || keepHiddenIds.has(m.id))
        .map(m => ({
          role: m.role,
          content: m.content,
          ...(m.tool_calls && m.tool_calls.length > 0 ? { tool_calls: m.tool_calls } : {}),
        })),
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
    ChatStore.startStream(convoId!, ctrl)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel, messages: ollamaMessages, memoryThreshold: loadMemoryThreshold() }),
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
            if (data.tool_status) {
              setToolStatus(data.tool_status)
              ChatStore.updateToolStatus(data.tool_status)
              continue
            }
            if (data.pending_questions) {
              setPendingQuestions(data.pending_questions)
              ChatStore.setPendingQuestions(data.pending_questions)
              continue
            }
            if (data.pending_connection) {
              setPendingConnection(data.pending_connection)
              ChatStore.setPendingConnection(data.pending_connection)
              continue
            }
            if (data.pending_approval) {
              setPendingApprovals(prev => [...prev, data.pending_approval])
              ChatStore.addPendingApproval(data.pending_approval)
              continue
            }
            if (data.tool_created) {
              addUserTool(data.tool_created)
              window.dispatchEvent(new CustomEvent('hearth:tool-created'))
              continue
            }
            if (data.pending_tool) {
              setPendingTool(data.pending_tool)
              ChatStore.setPendingTool(data.pending_tool)
              continue
            }
            if (data.pending_workflow) {
              setPendingWorkflow(data.pending_workflow)
              ChatStore.setPendingWorkflow(data.pending_workflow)
              continue
            }
            if (data.tool_history) {
              const now = new Date()
              const toolMsgs = (data.tool_history as Array<{
                role: 'assistant' | 'tool'
                content: string
                tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> | string } }>
              }>).map(tm => ({
                id: generateId(),
                role: tm.role as Message['role'],
                content: tm.content,
                createdAt: now,
                hidden: true as const,
                ...(tm.tool_calls ? { tool_calls: tm.tool_calls } : {}),
              }))

              // Write to localStorage synchronously so persistStreamingContent (which
              // runs synchronously on the next stream line) sees the correct order.
              // Do NOT call saveConversations inside setConversations — React defers
              // that callback, causing a race where persistStreamingContent runs first
              // and then saveConversations overwrites the content back to "".
              const rawConvos = localStorage.getItem(STORAGE_KEY)
              if (rawConvos) {
                try {
                  const convos = JSON.parse(rawConvos)
                  const idx = convos.findIndex((c: { id: string }) => c.id === convoId)
                  if (idx !== -1) {
                    const msgs = [...convos[idx].messages]
                    const placeholder = msgs.pop()
                    convos[idx].messages = [...msgs, ...toolMsgs, placeholder]
                    convos[idx].updatedAt = new Date().toISOString()
                    safeSetItem(STORAGE_KEY, JSON.stringify(convos))
                  }
                } catch {}
              }

              setConversations(prev => {
                const updated = prev.map(c => {
                  if (c.id !== convoId) return c
                  const msgs = [...c.messages]
                  const placeholder = msgs.pop()!
                  return { ...c, messages: [...msgs, ...toolMsgs, placeholder], updatedAt: new Date() }
                })
                return updated
              })
              continue
            }
            if (data.message?.content) {
              setToolStatus(null)
              ChatStore.updateToolStatus(null)
              accumulated += data.message.content
              const content = accumulated
              persistStreamingContent(convoId!, content)
              setConversations(prev => {
                const updated = prev.map(c => {
                  if (c.id !== convoId) return c
                  const msgs = c.messages.map((m, i) =>
                    i === c.messages.length - 1 ? { ...m, content } : m
                  )
                  return { ...c, messages: msgs, updatedAt: new Date() }
                })
                // saveConversations omitted here — persistStreamingContent handles it
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
      setToolStatus(null)
      setPendingApprovals([])
      setPendingQuestions(null)
      abortRef.current = null
      ChatStore.endStream()
    }
  }, [input, isStreaming, selectedModel, activeId, conversations, createConversation])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const stopStreaming = () => {
    ChatStore.abortStream()
    abortRef.current = null
    setIsStreaming(false)
  }

  const onModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value)
    localStorage.setItem(MODEL_KEY, e.target.value)
  }

  const activeMessages = (activeConversation?.messages ?? []).filter(m => !m.hidden)

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
                <div
                  key={convo.id}
                  onClick={() => setActiveId(convo.id)}
                  className={cn(
                    'group flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left transition-colors',
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
                </div>
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

          {/* Connected tools badge */}
          {googleConnected && (
            <div className="flex items-center gap-1.5 rounded-md bg-green-500/10 px-2 py-1 text-[10px] text-green-500 font-medium flex-shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Gmail + Calendar
            </div>
          )}

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
            {toolStatus && (
              <div className="flex items-center gap-2 px-4 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{toolStatus}</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Questions popup */}
        {pendingQuestions && pendingQuestions.questions.length > 0 && (
          <QuestionsPopup
            {...pendingQuestions}
            onSubmit={(answers) => handleAnswers(pendingQuestions.id, answers)}
          />
        )}

        {/* Connection setup card */}
        {!pendingQuestions && pendingConnection && (
          <ConnectionSetupCard
            connection={pendingConnection}
            onSuccess={() => { setPendingConnection(null); ChatStore.setPendingConnection(null) }}
            onCancel={() => { setPendingConnection(null); ChatStore.setPendingConnection(null) }}
          />
        )}


        {/* Pending tool save card */}
        {pendingTool && (
          <div className="border-t border-border bg-card px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{pendingTool.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{pendingTool.description}</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setPendingTool(null); ChatStore.setPendingTool(null) }}>
                Cancel
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => {
                addUserTool(pendingTool)
                window.dispatchEvent(new CustomEvent('hearth:tool-created'))
                setPendingTool(null)
                ChatStore.setPendingTool(null)
              }}>
                Save to sidebar
              </Button>
            </div>
          </div>
        )}

        {/* Workflow plan editor */}
        {pendingWorkflow && (
          <WorkflowPlanEditor
            workflow={pendingWorkflow}
            onSave={wf => {
              addWorkflowTool(wf)
              window.dispatchEvent(new CustomEvent('hearth:tool-created'))
              setPendingWorkflow(null)
              ChatStore.setPendingWorkflow(null)
            }}
            onCancel={() => { setPendingWorkflow(null); ChatStore.setPendingWorkflow(null) }}
          />
        )}

        {/* Input area */}
        <div className={pendingQuestions || pendingConnection || pendingApprovals.length > 0 ? 'hidden' : 'border-t border-border p-4'}>
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
