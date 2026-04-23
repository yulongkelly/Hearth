import type { WorkflowTool } from './workflow-tools'

export type StepStatus = 'pending' | 'running' | 'done' | 'error'

export async function executeWorkflow(
  tool: WorkflowTool,
  userParams: Record<string, string>,
  model: string,
  onStepUpdate: (id: string, status: StepStatus, output?: string) => void,
): Promise<Record<string, string>> {
  const context: Record<string, string> = {}

  function lastNonEmptyContextValue(): string {
    const vals = Object.values(context).filter(Boolean)
    return vals.length > 0 ? vals[vals.length - 1] : ''
  }

  function resolveParams(params: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string') {
        if (v.startsWith('$')) {
          // Resolve $var — fall back to most recent output if var is missing
          out[k] = context[v.slice(1)] || lastNonEmptyContextValue()
        } else {
          out[k] = v.replace(/\{(\w+)\}/g, (_, key) => userParams[key] ?? `{${key}}`)
        }
      } else if (Array.isArray(v)) {
        out[k] = v.map(item => {
          if (typeof item === 'string' && item.startsWith('$')) {
            return context[item.slice(1)] || lastNonEmptyContextValue()
          }
          return item
        })
      } else {
        out[k] = v
      }
    }
    return out
  }

  for (const step of tool.steps) {
    onStepUpdate(step.id, 'running')
    try {
      const resolvedParams = resolveParams(step.params)
      let result: string

      if (step.type === 'tool') {
        const res = await fetch('/api/tools/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: step.name, params: resolvedParams }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        result = String(data.result ?? '')
      } else {
        const res = await fetch('/api/tools/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: step.name, params: resolvedParams, context, model }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        result = String(data.result ?? '')
      }

      context[step.output] = result
      onStepUpdate(step.id, 'done', result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      context[step.output] = `Error: ${msg}`
      onStepUpdate(step.id, 'error', `Error: ${msg}`)
    }
  }

  return context
}
