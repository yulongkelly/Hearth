'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mail, Calendar, FileText, Search, BarChart, List, Trash2, Play, Loader2,
  ChevronDown, ChevronRight, type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  loadUserTools, deleteUserTool, addToolRun,
  type UserTool, type ToolRun,
} from '@/lib/user-tools'

const MODEL_KEY = 'hearth_default_model'

const TOOL_ICONS: Record<string, LucideIcon> = {
  Mail, Calendar, FileText, Search, BarChart, List,
}

function ToolIcon({ name, className }: { name: string; className?: string }) {
  const Icon = TOOL_ICONS[name] ?? FileText
  return <Icon className={className} />
}

function interpolatePrompt(prompt: string, params: Record<string, string>): string {
  return prompt.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function RunHistoryItem({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-border bg-muted/30">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
        <span className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</span>
        <div className="flex flex-wrap gap-1 ml-1">
          {Object.entries(run.parameters).map(([k, v]) => (
            <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
              {k}: {v}
            </span>
          ))}
        </div>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <p className="whitespace-pre-wrap text-xs text-foreground leading-relaxed">{run.result}</p>
        </div>
      )}
    </div>
  )
}

export function ToolPage({ id }: { id: string }) {
  const router = useRouter()
  const [tool, setTool] = useState<UserTool | null>(null)
  const [params, setParams] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const found = loadUserTools().find(t => t.id === id) ?? null
    setTool(found)
    if (found) {
      const defaults: Record<string, string> = {}
      found.parameters.forEach(p => { defaults[p.name] = '' })
      setParams(defaults)
    }
  }, [id])

  async function handleRun() {
    if (!tool) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setRunning(true)
    setResult('')

    const model = localStorage.getItem(MODEL_KEY) ?? 'llama3.2:3b'
    const prompt = interpolatePrompt(tool.prompt, params)

    try {
      const res = await fetch('/api/ollama/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) { setResult('Error: failed to connect to Ollama.'); return }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n').filter(l => l.trim())) {
          try {
            const data = JSON.parse(line)
            if (data.message?.content) {
              accumulated += data.message.content
              setResult(accumulated)
            }
          } catch { /* partial chunk */ }
        }
      }

      // Save run to history
      const run: ToolRun = {
        id: crypto.randomUUID(),
        parameters: { ...params },
        result: accumulated,
        createdAt: new Date().toISOString(),
      }
      addToolRun(tool.id, run)
      setTool(loadUserTools().find(t => t.id === id) ?? tool)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setResult('Error running tool.')
    } finally {
      setRunning(false)
    }
  }

  function handleDelete() {
    setDeleting(true)
    deleteUserTool(id)
    window.dispatchEvent(new CustomEvent('hearth:tool-created'))
    router.push('/chat')
  }

  if (!tool) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Tool not found.
      </div>
    )
  }

  const canRun = !running && tool.parameters.every(p => params[p.name]?.trim())

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <ToolIcon name={tool.icon} className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">{tool.name}</h1>
            <p className="text-xs text-muted-foreground">{tool.description}</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={deleting}
          className="text-destructive hover:text-destructive"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-6">

          {/* Parameters */}
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            {tool.parameters.length > 0 ? (
              <>
                {tool.parameters.map(p => (
                  <div key={p.name} className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">{p.label}</label>
                    <Input
                      type={p.type === 'number' ? 'number' : (p.type === 'date' || /date/i.test(p.name) || /date/i.test(p.label)) ? 'date' : 'text'}
                      value={params[p.name] ?? ''}
                      onChange={e => setParams(prev => ({ ...prev, [p.name]: e.target.value }))}
                      disabled={running}
                    />
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No parameters — click Run to execute.</p>
            )}
            <Button
              size="sm"
              onClick={handleRun}
              disabled={!canRun}
              className="mt-1 w-full"
            >
              {running
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Running...</>
                : <><Play className="h-3.5 w-3.5 mr-1.5" />Run</>}
            </Button>
          </div>

          {/* Streaming result */}
          {result !== null && (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Result</p>
              <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', running && 'after:inline-block after:w-1 after:h-3.5 after:bg-foreground after:animate-pulse after:ml-0.5 after:align-middle')}>
                {result || ' '}
              </p>
            </div>
          )}

          {/* Run history */}
          {tool.runs.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">History</p>
              {tool.runs.map(run => (
                <RunHistoryItem key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
