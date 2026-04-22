'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mail, Calendar, FileText, Search, BarChart, List,
  Loader2, Trash2, Play, ChevronDown, ChevronRight, Check, X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'
import {
  loadWorkflowTools, deleteWorkflowTool, addWorkflowRun,
  UI_MAP, type WorkflowTool, type WorkflowRun,
} from '@/lib/workflow-tools'
import { executeWorkflow, type StepStatus } from '@/lib/workflow-executor'

const MODEL_KEY = 'hearth_default_model'

const TOOL_ICONS: Record<string, LucideIcon> = {
  Mail, Calendar, FileText, Search, BarChart, List,
}

function ToolIcon({ name, className }: { name: string; className?: string }) {
  const Icon = TOOL_ICONS[name] ?? FileText
  return <Icon className={className} />
}

interface StepState {
  id:      string
  status:  StepStatus
  output?: string
  open:    boolean
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
  const [tool, setTool]       = useState<WorkflowTool | null>(null)
  const [params, setParams]   = useState<Record<string, string>>({})
  const [stepStates, setStepStates] = useState<StepState[]>([])
  const [running, setRunning] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const found = loadWorkflowTools().find(t => t.id === id) ?? null
    setTool(found)
    if (found) {
      const defaults: Record<string, string> = {}
      found.parameters.forEach(p => { defaults[p.name] = p.defaultValue ?? '' })
      setParams(defaults)
      setStepStates(found.steps.map(s => ({ id: s.id, status: 'pending', open: false })))
    }
  }, [id])

  function updateStep(stepId: string, status: StepStatus, output?: string) {
    setStepStates(prev => prev.map(s =>
      s.id === stepId ? { ...s, status, output, open: status === 'done' || status === 'error' } : s
    ))
  }

  async function handleRun() {
    if (!tool || running) return
    const model = localStorage.getItem(MODEL_KEY) ?? 'llama3.2:3b'
    setRunning(true)
    setStepStates(tool.steps.map(s => ({ id: s.id, status: 'pending', open: false })))

    const finalContext = await executeWorkflow(tool, params, model, updateStep)

    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      parameters: { ...params },
      stepOutputs: finalContext,
      createdAt: new Date().toISOString(),
    }
    addWorkflowRun(tool.id, run)
    setTool(loadWorkflowTools().find(t => t.id === id) ?? tool)
    setRunning(false)
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
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            {tool.steps.map((step, i) => {
              const state = stepStates[i]
              const title = UI_MAP[step.name] ?? step.name
              return (
                <div key={step.id} className="rounded-md border border-border">
                  <button
                    onClick={() => setStepStates(prev => prev.map((s, idx) => idx === i ? { ...s, open: !s.open } : s))}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
                  >
                    {state ? statusIcon(state.status) : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 inline-block" />}
                    <span className="text-[10px] text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="flex-1 text-xs">{title}</span>
                    {state?.status === 'done' && (
                      state.open
                        ? <ChevronDown  className="h-3 w-3 text-muted-foreground" />
                        : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                  {state?.open && state.output && (
                    <div className="border-t border-border px-3 py-2">
                      <Markdown content={state.output} />
                    </div>
                  )}
                </div>
              )
            })}

            <Button size="sm" onClick={handleRun} disabled={!canRun} className={cn('mt-2 w-full', tool.parameters.length === 0 && 'mt-0')}>
              {running
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Running...</>
                : <><Play    className="h-3.5 w-3.5 mr-1.5" />Run</>}
            </Button>
          </div>

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
