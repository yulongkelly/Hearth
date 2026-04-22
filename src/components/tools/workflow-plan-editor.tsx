'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  TOOL_WHITELIST, ACTION_WHITELIST, UI_MAP,
  type WorkflowTool, type WorkflowStep,
} from '@/lib/workflow-tools'

const ALL_STEP_NAMES = [...TOOL_WHITELIST, ...ACTION_WHITELIST] as string[]

// Params that always render as dropdowns with known options
const ACCOUNT_PARAM_KEYS = ['account']

interface Account { email: string; nickname?: string | null }

function ParamField({
  paramKey,
  value,
  accounts,
  onChange,
}: {
  paramKey: string
  value: unknown
  accounts: Account[]
  onChange: (v: string) => void
}) {
  const isRef = typeof value === 'string' && (value.startsWith('$') || /^\w+_output$/.test(value))
  const isAccount = ACCOUNT_PARAM_KEYS.includes(paramKey) && accounts.length > 0

  if (isRef) {
    return (
      <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
        ← {String(value)}
      </span>
    )
  }

  if (isAccount) {
    return (
      <select
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        className="h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">all accounts</option>
        {accounts.map(a => (
          <option key={a.email} value={a.nickname ?? a.email}>
            {a.nickname ?? a.email}
          </option>
        ))}
      </select>
    )
  }

  // Date param
  if (paramKey.toLowerCase().includes('date') || paramKey.toLowerCase().includes('min') || paramKey.toLowerCase().includes('max')) {
    return (
      <Input
        type="date"
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        className="h-7 w-40 text-xs"
      />
    )
  }

  return (
    <Input
      type="text"
      value={String(value ?? '')}
      onChange={e => onChange(e.target.value)}
      className="h-7 w-40 text-xs"
    />
  )
}

function StepCard({
  step,
  index,
  total,
  accounts,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  step: WorkflowStep
  index: number
  total: number
  accounts: Account[]
  onUpdate: (s: WorkflowStep) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [open, setOpen] = useState(true)
  const title = UI_MAP[step.name] ?? step.name

  function setParam(key: string, value: string) {
    onUpdate({ ...step, params: { ...step.params, [key]: value } })
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ChevronDown className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
          <span className="text-[10px] font-medium text-muted-foreground tabular-nums">{index + 1}</span>
          <span className="text-xs font-medium truncate">{title}</span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onMoveUp}   disabled={index === 0}         className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp   className="h-3 w-3" /></button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
          <button onClick={onRemove}                                  className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>

      {open && Object.keys(step.params).length > 0 && (
        <div className="border-t border-border px-3 pb-3 pt-2 space-y-2">
          {Object.entries(step.params).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-20 flex-shrink-0 text-[10px] text-muted-foreground font-mono">{k}</span>
              <ParamField paramKey={k} value={v} accounts={accounts} onChange={val => setParam(k, val)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function WorkflowPlanEditor({
  workflow,
  onSave,
  onCancel,
}: {
  workflow: WorkflowTool
  onSave: (w: WorkflowTool) => void
  onCancel: () => void
}) {
  const [steps, setSteps] = useState<WorkflowStep[]>(workflow.steps)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showAddStep, setShowAddStep] = useState(false)

  useEffect(() => {
    fetch('/api/gmail/account')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.accounts)) setAccounts(d.accounts) })
      .catch(() => {})
  }, [])

  function updateStep(index: number, updated: WorkflowStep) {
    setSteps(prev => prev.map((s, i) => i === index ? updated : s))
  }

  function removeStep(index: number) {
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  function moveStep(index: number, dir: -1 | 1) {
    setSteps(prev => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function addStep(name: string) {
    const isAction = (ACTION_WHITELIST as readonly string[]).includes(name)
    const id = `step${steps.length + 1}`
    const newStep: WorkflowStep = {
      id,
      type: isAction ? 'action' : 'tool',
      name,
      params: name === 'summarize'        ? { data: '' } :
              name === 'merge_lists'       ? { inputs: [] } :
              name === 'detect_conflicts'  ? { events: '' } :
              name === 'filter_events'     ? { events: '', query: '' } :
              { account: '' },
      output: `${id}_output`,
    }
    setSteps(prev => [...prev, newStep])
    setShowAddStep(false)
  }

  function handleSave() {
    onSave({ ...workflow, steps })
  }

  return (
    <div className="border-t border-border bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate">{workflow.name}</p>
          <p className="text-[10px] text-muted-foreground">{workflow.description}</p>
        </div>
        <span className="flex-shrink-0 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          Review plan
        </span>
      </div>

      {/* Steps */}
      <div className="space-y-2 px-4 pb-2 max-h-72 overflow-y-auto">
        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            index={i}
            total={steps.length}
            accounts={accounts}
            onUpdate={s => updateStep(i, s)}
            onRemove={() => removeStep(i)}
            onMoveUp={() => moveStep(i, -1)}
            onMoveDown={() => moveStep(i, 1)}
          />
        ))}

        {/* Add step */}
        {showAddStep ? (
          <div className="rounded-lg border border-dashed border-border p-2">
            <p className="mb-2 text-[10px] text-muted-foreground font-medium">Add step</p>
            <div className="flex flex-wrap gap-1">
              {ALL_STEP_NAMES.map(name => (
                <button
                  key={name}
                  onClick={() => addStep(name)}
                  className="rounded bg-muted px-2 py-1 text-[10px] hover:bg-accent transition-colors"
                >
                  {UI_MAP[name] ?? name}
                </button>
              ))}
            </div>
            <button onClick={() => setShowAddStep(false)} className="mt-2 text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddStep(true)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Add step
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={steps.length === 0}>
          Save to sidebar →
        </Button>
      </div>
    </div>
  )
}
