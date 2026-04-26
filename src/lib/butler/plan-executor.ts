import { lookupAction } from './connector-registry'
import type { PlanTask, TaskPlan } from './planner'
import { executeTool } from '@/lib/tools'
import { enforceSecurityPolicy } from '@/lib/security-runtime'

export interface ExecutionStep {
  taskId:  string
  tool:    string
  action:  string
  status:  'running' | 'done' | 'error' | 'blocked'
  result?: string
}

export interface PlanExecContext {
  requireApproval: (task: PlanTask) => Promise<boolean>
  emitStep:        (step: ExecutionStep) => void
  /** Optional per-action overrides keyed as "tool.action". Return a result string. */
  interceptors?:   Record<string, (task: PlanTask) => Promise<string>>
}

// ─── Topological sort (Kahn's algorithm) ──────────────────────────────────────

function topologicalSort(tasks: PlanTask[]): PlanTask[] {
  const idMap = new Map(tasks.map(t => [t.id, t]))
  const inDegree = new Map(tasks.map(t => [t.id, 0]))

  for (const t of tasks) {
    for (const dep of t.depends_on ?? []) {
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1)
    }
  }

  const queue = tasks.filter(t => (inDegree.get(t.id) ?? 0) === 0)
  const sorted: PlanTask[] = []

  while (queue.length > 0) {
    const cur = queue.shift()!
    sorted.push(cur)
    for (const t of tasks) {
      if ((t.depends_on ?? []).includes(cur.id)) {
        const deg = (inDegree.get(t.id) ?? 1) - 1
        inDegree.set(t.id, deg)
        if (deg === 0) queue.push(idMap.get(t.id)!)
      }
    }
  }

  return sorted
}

// ─── $taskId reference resolution ─────────────────────────────────────────────

function resolveArgs(
  args: Record<string, unknown>,
  results: Map<string, string>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.startsWith('$')) {
      const refId = v.slice(1)
      resolved[k] = results.get(refId) ?? v
    } else {
      resolved[k] = v
    }
  }
  return resolved
}

// ─── Main executor ────────────────────────────────────────────────────────────

export async function executePlan(
  plan: TaskPlan,
  ctx: PlanExecContext,
): Promise<Map<string, string>> {
  const taskResults = new Map<string, string>()
  const sorted = topologicalSort(plan.tasks)

  for (const task of sorted) {
    ctx.emitStep({ taskId: task.id, tool: task.tool, action: task.action, status: 'running' })

    // Policy: high safety_level requires user approval
    if (task.safety_level === 'high') {
      const approved = await ctx.requireApproval(task)
      if (!approved) {
        ctx.emitStep({ taskId: task.id, tool: task.tool, action: task.action, status: 'blocked' })
        taskResults.set(task.id, 'Action rejected by user.')
        continue
      }
    }

    const resolvedArgs = resolveArgs(task.args, taskResults)

    // memory actions need an "action" sub-field
    const toolArgs = task.tool === 'memory'
      ? { action: task.action, ...resolvedArgs }
      : resolvedArgs

    // http actions need a "method" field derived from the action name
    const finalArgs = task.tool === 'http'
      ? { method: task.action.toUpperCase(), ...toolArgs }
      : toolArgs

    // Security runtime — capability check, arg sanitization, artifact isolation
    const secCheck = enforceSecurityPolicy(task, finalArgs)
    if (!secCheck.allowed) {
      ctx.emitStep({ taskId: task.id, tool: task.tool, action: task.action, status: 'blocked', result: secCheck.reason })
      taskResults.set(task.id, `Blocked: ${secCheck.reason}`)
      continue
    }
    const approvedArgs = secCheck.task.args

    const registration = lookupAction(task.tool, task.action)
    if (!registration) {
      const err = `Unknown action: ${task.tool}.${task.action}`
      ctx.emitStep({ taskId: task.id, tool: task.tool, action: task.action, status: 'error', result: err })
      taskResults.set(task.id, err)
      continue
    }

    try {
      const interceptKey = `${task.tool}.${task.action}`
      const interceptor = ctx.interceptors?.[interceptKey]
      const resolvedTask = { ...task, args: approvedArgs }
      const raw = interceptor
        ? await interceptor(resolvedTask)
        : await executeTool(registration.toolName, approvedArgs)
      const result = String(raw)
      const trimmed = result.slice(0, 2000)
      ctx.emitStep({ taskId: task.id, tool: task.tool, action: task.action, status: 'done', result: trimmed })
      taskResults.set(task.id, trimmed)
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      ctx.emitStep({ taskId: task.id, tool: task.tool, action: task.action, status: 'error', result: err })
      taskResults.set(task.id, `Error: ${err}`)
    }
  }

  return taskResults
}
