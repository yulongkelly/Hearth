import type { StepStatus } from './workflow-executor'

export interface RunStepState {
  id:      string
  status:  StepStatus
  output?: string
}

export interface ActiveRun {
  toolId:     string
  toolName:   string
  stepStates: RunStepState[]
  finished:   boolean
}

const runs = new Map<string, ActiveRun>()
const EVENT = 'hearth:workflow-run-update'

function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

export function startRun(toolId: string, toolName: string, stepIds: string[]) {
  runs.set(toolId, {
    toolId,
    toolName,
    stepStates: stepIds.map(id => ({ id, status: 'pending' })),
    finished: false,
  })
  emit()
}

export function updateRunStep(toolId: string, stepId: string, status: StepStatus, output?: string) {
  const run = runs.get(toolId)
  if (!run) return
  run.stepStates = run.stepStates.map(s => s.id === stepId ? { ...s, status, output } : s)
  emit()
}

export function finishRun(toolId: string) {
  const run = runs.get(toolId)
  if (!run) return
  run.finished = true
  emit()
}

export function getRun(toolId: string): ActiveRun | undefined {
  return runs.get(toolId)
}

export function getActiveRuns(): ActiveRun[] {
  return Array.from(runs.values()).filter(r => !r.finished)
}

export function subscribe(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
