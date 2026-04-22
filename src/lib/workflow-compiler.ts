import { TOOL_WHITELIST, ACTION_WHITELIST, type WorkflowTool, type WorkflowStep } from './workflow-tools'
import type { ToolParameter } from './user-tools'

export interface CompileResult {
  ok: boolean
  workflow?: Omit<WorkflowTool, 'id' | 'createdAt' | 'runs'>
  error?: string
}

function parseRaw(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch {}
    try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')) } catch {}
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      try { return JSON.parse(match[0]) } catch {}
      try { return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')) } catch {}
    }
  }
  return null
}

const ALL_STEPS = [...TOOL_WHITELIST, ...ACTION_WHITELIST] as string[]

function normalizeName(name: string): string {
  const n = name.toLowerCase().replace(/[\s-]/g, '_')
  if (ALL_STEPS.includes(n)) return n
  if (n.includes('calendar'))                                    return 'get_calendar_events'
  if (n.includes('inbox') || (n.includes('get') && n.includes('email') && !n.includes('read'))) return 'get_inbox'
  if (n.includes('read') && n.includes('email'))                 return 'read_email'
  if (n.includes('merge') || n.includes('combine') || n.includes('concat')) return 'merge_lists'
  if (n.includes('conflict'))                                    return 'detect_conflicts'
  if (n.includes('filter'))                                      return 'filter_events'
  if (n.includes('summar'))                                      return 'summarize'
  return name
}

export function compile(raw: unknown): CompileResult {
  const parsed = parseRaw(raw)
  if (!parsed) return { ok: false, error: 'Could not parse workflow JSON' }

  const stepsRaw = Array.isArray(parsed.steps) ? parsed.steps : []
  if (stepsRaw.length === 0) return { ok: false, error: 'Workflow must have at least one step' }
  if (stepsRaw.length > 10)  return { ok: false, error: 'Workflow cannot have more than 10 steps' }

  const steps: WorkflowStep[] = []
  const outputVars = new Set<string>()

  for (let i = 0; i < stepsRaw.length; i++) {
    const s = stepsRaw[i]
    if (typeof s !== 'object' || s === null) return { ok: false, error: `Step ${i + 1}: invalid step object` }

    const name = normalizeName(String(s.name ?? ''))
    const isToolStep   = (TOOL_WHITELIST   as readonly string[]).includes(name)
    const isActionStep = (ACTION_WHITELIST as readonly string[]).includes(name)

    if (!isToolStep && !isActionStep) {
      return { ok: false, error: `Step ${i + 1}: unknown step "${s.name}" — use only: ${ALL_STEPS.join(', ')}` }
    }

    const outputVar = String(s.output ?? `step${i + 1}_output`)
    if (outputVars.has(outputVar)) return { ok: false, error: `Step ${i + 1}: duplicate output variable "${outputVar}"` }
    outputVars.add(outputVar)

    steps.push({
      id:     String(s.id ?? `step${i + 1}`),
      type:   isToolStep ? 'tool' : 'action',
      name,
      params: (typeof s.params === 'object' && s.params !== null) ? s.params as Record<string, unknown> : {},
      output: outputVar,
    })
  }

  const workflow: Omit<WorkflowTool, 'id' | 'createdAt' | 'runs'> = {
    name:        String(parsed.name        ?? 'Untitled Tool'),
    description: String(parsed.description ?? ''),
    icon:        String(parsed.icon        ?? 'FileText'),
    goal:        String(parsed.goal        ?? ''),
    parameters:  Array.isArray(parsed.parameters) ? parsed.parameters as ToolParameter[] : [],
    steps,
  }

  return { ok: true, workflow }
}

export function compileRetryPrompt(error: string): string {
  return `The previous workflow JSON was invalid: ${error}\n\nFix and return ONLY the corrected JSON object — no explanation, no markdown fences.`
}
