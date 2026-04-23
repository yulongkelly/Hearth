'use client'

import { useState, useEffect, useCallback } from 'react'
import { Pencil, Save, X, Brain, User, Activity, Sparkles, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface HearthEvent {
  id:          string
  type:        'tool_call' | 'workflow_run'
  timestamp:   string
  tool?:       string
  args?:       Record<string, unknown>
  result?:     string
  workflowName?: string
  durationMs?: number
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m  = Math.floor(ms / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function EventRow({ event }: { event: HearthEvent }) {
  const label  = event.type === 'tool_call' ? event.tool ?? 'tool' : event.workflowName ?? 'workflow'
  const detail = event.result?.slice(0, 80) ?? (event.workflowName ? `${event.durationMs}ms` : '')
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
      <div className="mt-0.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0 mt-2" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground/60">{timeAgo(event.timestamp)}</span>
        </div>
        {detail && <p className="text-[10px] text-muted-foreground truncate">{detail}</p>}
      </div>
    </div>
  )
}

type Panel = 'memory' | 'user'

interface PanelState {
  content: string
  editing: boolean
  draft: string
  saving: boolean
  saved: boolean
}

const EMPTY_PANEL: PanelState = { content: '', editing: false, draft: '', saving: false, saved: false }

export default function MemoryPage() {
  const [panels, setPanels] = useState<Record<Panel, PanelState>>({
    memory: EMPTY_PANEL,
    user:   EMPTY_PANEL,
  })
  const [loading, setLoading]         = useState(true)
  const [events, setEvents]           = useState<HearthEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsLimit, setEventsLimit] = useState(20)
  const [compiling, setCompiling]     = useState(false)
  const [compileMsg, setCompileMsg]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/memory')
      .then(r => r.json())
      .then(data => {
        setPanels({
          memory: { ...EMPTY_PANEL, content: data.memory ?? '', draft: data.memory ?? '' },
          user:   { ...EMPTY_PANEL, content: data.user   ?? '', draft: data.user   ?? '' },
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const loadEvents = useCallback((limit: number) => {
    setEventsLoading(true)
    fetch(`/api/memory/events?days=30&limit=${limit}`)
      .then(r => r.json())
      .then(data => setEvents(data.events ?? []))
      .finally(() => setEventsLoading(false))
  }, [])

  useEffect(() => { loadEvents(20) }, [loadEvents])

  async function handleCompile() {
    setCompiling(true)
    setCompileMsg(null)
    const model = localStorage.getItem('hearth_default_model') ?? 'llama3.2:3b'
    const res   = await fetch('/api/memory/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    })
    const data = await res.json()
    if (data.added > 0) {
      setCompileMsg(`Added ${data.added} entr${data.added === 1 ? 'y' : 'ies'} to memory.`)
      // Reload memory panel
      fetch('/api/memory').then(r => r.json()).then(d => {
        setPanels(prev => ({
          ...prev,
          memory: { ...prev.memory, content: d.memory ?? '', draft: d.memory ?? '' },
        }))
      })
    } else {
      setCompileMsg(data.message ?? 'Nothing to add.')
    }
    setCompiling(false)
    setTimeout(() => setCompileMsg(null), 4000)
  }

  function startEdit(target: Panel) {
    setPanels(prev => ({ ...prev, [target]: { ...prev[target], editing: true, draft: prev[target].content } }))
  }

  function cancelEdit(target: Panel) {
    setPanels(prev => ({ ...prev, [target]: { ...prev[target], editing: false, draft: prev[target].content } }))
  }

  async function save(target: Panel) {
    setPanels(prev => ({ ...prev, [target]: { ...prev[target], saving: true } }))
    const draft = panels[target].draft
    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, content: draft }),
    })
    setPanels(prev => ({
      ...prev,
      [target]: { ...prev[target], saving: false, saved: true, editing: false, content: draft },
    }))
    setTimeout(() => {
      setPanels(prev => ({ ...prev, [target]: { ...prev[target], saved: false } }))
    }, 2000)
  }

  const panels_config: { key: Panel; label: string; description: string; Icon: typeof Brain }[] = [
    { key: 'memory', label: 'Agent Memory', description: 'Facts, conventions, and environment details the AI has learned.', Icon: Brain },
    { key: 'user',   label: 'User Profile', description: 'Your preferences, habits, and personal details.', Icon: User },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border px-6 h-14 flex-shrink-0">
        <h1 className="text-base font-semibold">Memory</h1>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-6 overflow-auto p-6">
          {/* Memory panels */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {panels_config.map(({ key, label, description, Icon }) => {
              const p = panels[key]
              const charCount = p.content.length
              return (
                <div key={key} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                      {p.editing ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => cancelEdit(key)} className="h-7 px-2">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" onClick={() => save(key)} disabled={p.saving} className="h-7 px-3 text-xs">
                            <Save className="h-3.5 w-3.5 mr-1" />
                            {p.saving ? 'Saving…' : p.saved ? 'Saved!' : 'Save'}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => startEdit(key)} className="h-7 px-2">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Textarea
                      value={p.editing ? p.draft : p.content}
                      onChange={e => setPanels(prev => ({ ...prev, [key]: { ...prev[key], draft: e.target.value } }))}
                      readOnly={!p.editing}
                      rows={14}
                      placeholder={p.editing ? 'Write memory entries here…' : '(empty — the AI will populate this as you chat)'}
                      className={cn(
                        'resize-none font-mono text-xs leading-relaxed',
                        !p.editing && 'cursor-default opacity-80',
                      )}
                    />
                    <p className="text-[10px] text-muted-foreground text-right">{charCount} chars</p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Recent Activity + Compiler */}
          <div className="flex flex-col gap-3 max-w-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Recent Activity</p>
                  <p className="text-xs text-muted-foreground">Tool calls and workflow runs from the last 30 days.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => loadEvents(eventsLimit)}
                  disabled={eventsLoading}
                  className="h-7 px-2"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', eventsLoading && 'animate-spin')} />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCompile}
                  disabled={compiling || events.length === 0}
                  className="h-7 px-3 text-xs gap-1.5"
                >
                  {compiling
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Sparkles className="h-3.5 w-3.5" />}
                  {compiling ? 'Compiling…' : 'Compile Memory'}
                </Button>
              </div>
            </div>

            {compileMsg && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-1.5">{compileMsg}</p>
            )}

            <div className="rounded-lg border border-border bg-card px-3 py-1">
              {events.length === 0 && !eventsLoading ? (
                <p className="text-xs text-muted-foreground py-3">No activity yet. Use a tool in chat to see events here.</p>
              ) : (
                events.map(e => <EventRow key={e.id} event={e} />)
              )}
              {events.length > 0 && events.length >= eventsLimit && (
                <button
                  onClick={() => {
                    const next = eventsLimit + 20
                    setEventsLimit(next)
                    loadEvents(next)
                  }}
                  className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground py-2 transition-colors"
                >
                  Load more
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
