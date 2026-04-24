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
  if (n === 'http' || n === 'request' || n === 'fetch' || n.includes('api_call') || n.includes('rest') || n.includes('http_req')) return 'http_request'
  return name
}

// After parsing, fix any $varName references that don't match a real previous output.
// Small models often use wrong or inconsistent var names — this rewires them automatically.
function rewireRefs(steps: WorkflowStep[]): void {
  for (let i = 0; i < steps.length; i++) {
    const available = steps.slice(0, i).map(s => s.output) // outputs available at this step
    if (available.length === 0) continue

    const fixRef = (v: unknown): unknown => {
      if (typeof v !== 'string') return v
      // Normalise: treat bare var names (no $) that match available outputs as $refs
      const bare = v.startsWith('$') ? v.slice(1) : v
      if (available.includes(bare)) return `$${bare}` // already correct or just missing $
      if (v.startsWith('$') && !available.includes(bare)) {
        // Broken $ref — point to the most recent available output
        return `$${available[available.length - 1]}`
      }
      return v
    }

    const params = steps[i].params
    for (const key of Object.keys(params)) {
      const val = params[key]
      if (typeof val === 'string') {
        params[key] = fixRef(val)
      } else if (Array.isArray(val)) {
        params[key] = val.map(item => fixRef(item))
        // If merge_lists inputs is empty or all non-refs, wire all previous outputs
        if (steps[i].name === 'merge_lists') {
          const fixed = (params[key] as unknown[]).filter(
            v => typeof v === 'string' && v.startsWith('$')
          )
          if (fixed.length === 0) params[key] = available.map(o => `$${o}`)
        }
      }
    }

    // merge_lists with no inputs key at all — auto-wire from all previous outputs
    if (steps[i].name === 'merge_lists' && !('inputs' in params)) {
      params['inputs'] = available.map(o => `$${o}`)
    }

    // detect_conflicts / filter_events / summarize with missing primary input key — wire from previous
    const primaryKey: Record<string, string> = {
      detect_conflicts: 'events',
      filter_events:    'events',
      summarize:        'data',
    }
    const pk = primaryKey[steps[i].name]
    if (pk && (!(pk in params) || params[pk] === '' || params[pk] === undefined)) {
      params[pk] = `$${available[available.length - 1]}`
    }
  }
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

  // Fix broken variable references produced by imprecise small models
  rewireRefs(steps)

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
