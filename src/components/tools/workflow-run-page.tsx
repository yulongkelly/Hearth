'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mail, Calendar, FileText, Search, BarChart, List,
  Loader2, Trash2, Play, ChevronDown, ChevronRight, Check, X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'
import {
  loadWorkflowTools, deleteWorkflowTool, addWorkflowRun,
  UI_MAP, type WorkflowTool, type WorkflowRun, type WorkflowStep,
} from '@/lib/workflow-tools'
import { executeWorkflow, type StepStatus } from '@/lib/workflow-executor'
import { validatePage, type UIPage } from '@/lib/ui-schema'
import * as RunStore from '@/lib/workflow-run-store'

const MODEL_KEY = 'hearth_default_model'

const TOOL_ICONS: Record<string, LucideIcon> = {
  Mail, Calendar, FileText, Search, BarChart, List,
}

function ToolIcon({ name, className }: { name: string; className?: string }) {
  const Icon = TOOL_ICONS[name] ?? FileText
  return <Icon className={className} />
}

type StepState = RunStore.RunStepState

function PageHeader({ title, badge }: { title?: string; badge?: UIPage extends { badge?: infer B } ? B : never }) {
  if (!title && !badge) return null
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      {title && <p className="text-sm font-semibold">{title}</p>}
      {badge && (
        <Badge variant={(badge as { variant: 'default' | 'success' | 'destructive' | 'warning' }).variant}
          className="text-xs font-semibold uppercase tracking-wide">
          {(badge as { text: string }).text}
        </Badge>
      )}
    </div>
  )
}

function TagList({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null
  return (
    <div className="flex gap-1 flex-shrink-0">
      {tags.map(tag => (
        <span key={tag} className="font-mono text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">
          {tag}
        </span>
      ))}
    </div>
  )
}

function PageRenderer({ page }: { page: UIPage }) {
  if (page.type === 'card_page') return (
    <div className="space-y-2">
      <PageHeader title={page.title} badge={page.badge as never} />
      {page.cards.map((card, i) => (
        <div key={i} className="rounded-md border border-border bg-muted/30 px-3 py-2.5 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium leading-snug">{card.headline}</p>
            <TagList tags={card.tags} />
          </div>
          {card.subtext && <p className="text-xs text-muted-foreground">{card.subtext}</p>}
          {card.note    && <p className="text-xs text-muted-foreground/60 italic">{card.note}</p>}
        </div>
      ))}
    </div>
  )

  if (page.type === 'list_page') return (
    <div className="space-y-1">
      <PageHeader title={page.title} badge={page.badge as never} />
      {page.items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <span className="h-1 w-1 rounded-full bg-muted-foreground/40 flex-shrink-0" />
          <span className="flex-1 text-sm">{item.text}</span>
          {item.detail && <span className="text-xs text-muted-foreground">{item.detail}</span>}
          <TagList tags={item.tags} />
        </div>
      ))}
    </div>
  )

  // text_page
  return (
    <div className="space-y-2">
      {page.title && <p className="text-sm font-semibold mb-1">{page.title}</p>}
      <Markdown content={page.body} />
    </div>
  )
}

function stepCategory(step: WorkflowStep): string | null {
  if (step.name === 'get_calendar_events') {
    const a = step.params.account
    return typeof a === 'string' && a ? a : 'calendar'
  }
  if (step.name === 'get_inbox' || step.name === 'read_email') return 'email'
  if (['merge_lists', 'detect_conflicts', 'filter_events', 'summarize'].includes(step.name)) return 'action'
  return null
}

function categoryVariant(cat: string): 'default' | 'secondary' | 'outline' {
  if (cat === 'action') return 'default'
  if (cat === 'work') return 'outline'
  return 'secondary'
}

function statusIcon(status: StepStatus) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
  if (status === 'done')    return <Check  className="h-3.5 w-3.5 text-green-500" />
  if (status === 'error')   return <X      className="h-3.5 w-3.5 text-destructive" />
  return <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 inline-block" />
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function RunHistoryItem({ run, steps }: { run: WorkflowRun; steps: WorkflowTool['steps'] }) {
  const [open, setOpen] = useState(false)
  const lastOutput = Object.values(run.stepOutputs).at(-1) ?? ''
  return (
    <div className="rounded-lg border border-border bg-muted/30">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
        <span className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</span>
        <div className="flex flex-wrap gap-1 ml-1">
          {Object.entries(run.parameters).map(([k, v]) => (
            <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">{k}: {v}</span>
          ))}
        </div>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-3">
          {steps.map(step => {
            const out = run.stepOutputs[step.output]
            if (!out) return null
            return (
              <div key={step.id}>
                <p className="text-[10px] font-medium text-muted-foreground mb-1">{UI_MAP[step.name] ?? step.name}</p>
                <Markdown content={out} />
              </div>
            )
          })}
          {!steps.some(s => run.stepOutputs[s.output]) && <Markdown content={lastOutput} />}
        </div>
      )}
    </div>
  )
}

export function WorkflowRunPage({ id }: { id: string }) {
  const router = useRouter()
  const [tool, setTool]         = useState<WorkflowTool | null>(null)
  const [params, setParams]     = useState<Record<string, string>>({})
  const [stepStates, setStepStates] = useState<StepState[]>([])
  const [running, setRunning]   = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Load tool from localStorage on mount
  useEffect(() => {
    const found = loadWorkflowTools().find(t => t.id === id) ?? null
    setTool(found)
    if (found) {
      const defaults: Record<string, string> = {}
      found.parameters.forEach(p => { defaults[p.name] = p.defaultValue ?? '' })
      setParams(defaults)
    }
  }, [id])

  // Sync step states from global run store (survives navigation)
  useEffect(() => {
    function sync() {
      const run = RunStore.getRun(id)
      if (run) {
        setStepStates(run.stepStates)
        setRunning(!run.finished)
        if (run.finished) setTool(loadWorkflowTools().find(t => t.id === id) ?? null)
      } else {
        const tool = loadWorkflowTools().find(t => t.id === id)
        setStepStates(tool?.steps.map(s => ({ id: s.id, status: 'pending' as StepStatus })) ?? [])
        setRunning(false)
      }
    }
    sync()
    return RunStore.subscribe(sync)
  }, [id])

  function handleRun() {
    if (!tool || running) return
    const model = localStorage.getItem(MODEL_KEY) ?? 'llama3.2:3b'
    const capturedParams = { ...params }

    RunStore.startRun(tool.id, tool.name, tool.steps.map(s => s.id))

    executeWorkflow(tool, capturedParams, model, (stepId, status, output) => {
      RunStore.updateRunStep(tool.id, stepId, status, output)
    }).then(finalContext => {
      addWorkflowRun(tool.id, {
        id: crypto.randomUUID(),
        parameters: capturedParams,
        stepOutputs: finalContext,
        createdAt: new Date().toISOString(),
      } satisfies WorkflowRun)
      RunStore.finishRun(tool.id)
    })
  }

  function handleDelete() {
    setDeleting(true)
    deleteWorkflowTool(id)
    window.dispatchEvent(new CustomEvent('hearth:tool-created'))
    router.push('/chat')
  }

  if (!tool) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Tool not found.</div>
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
            {Object.values(params).filter(Boolean).length > 0 && (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {Object.values(params).filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={handleDelete} disabled={deleting} className="text-destructive hover:text-destructive">
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-6">

          {/* Parameters */}
          {tool.parameters.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              {tool.parameters.map(p => (
                <div key={p.name} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{p.label}</label>
                  <Input
                    type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'}
                    value={params[p.name] ?? ''}
                    onChange={e => setParams(prev => ({ ...prev, [p.name]: e.target.value }))}
                    disabled={running}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Steps + Run */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-1">
            {tool.steps.map((step, i) => {
              const state = stepStates[i]
              const title = UI_MAP[step.name] ?? step.name
              const cat   = stepCategory(step)
              return (
                <div key={step.id} className="flex items-center gap-3 px-2 py-2 rounded-md">
                  <div className={cn(
                    'h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0',
                    state?.status === 'done'    && 'bg-green-500/15',
                    state?.status === 'running' && 'bg-primary/15',
                    state?.status === 'error'   && 'bg-destructive/15',
                    (!state || state.status === 'pending') && 'bg-muted/50',
                  )}>
                    {state ? statusIcon(state.status) : null}
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground w-4 flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 text-xs font-medium">{title}</span>
                  {cat && (
                    <Badge variant={categoryVariant(cat)} className="text-[10px] px-1.5 py-0 h-5 font-normal">
                      {cat}
                    </Badge>
                  )}
                  {state?.status === 'done' && <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                </div>
              )
            })}

            <Button size="sm" onClick={handleRun} disabled={!canRun} className="mt-3 w-full">
              {running
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Running...</>
                : <><Play    className="h-3.5 w-3.5 mr-1.5" />Run</>}
            </Button>
          </div>

          {/* Final output — only shown once all steps are complete */}
          {(() => {
            const allDone = stepStates.length > 0 && stepStates.every(s => s.status === 'done' || s.status === 'error')
            const lastOutput = stepStates[stepStates.length - 1]?.output
            if (!allDone || !lastOutput) return null
            const page = validatePage(lastOutput)
            return (
              <div className="rounded-lg border border-border bg-card px-5 py-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-3">Result</p>
                <PageRenderer page={page} />
              </div>
            )
          })()}

          {/* Run history */}
          {tool.runs.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">History</p>
              {tool.runs.map(run => (
                <RunHistoryItem key={run.id} run={run} steps={tool.steps} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
