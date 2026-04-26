import { lookupAction, CONNECTOR_REGISTRY } from './connector-registry'
import type { PlanTask, TaskPlan } from './planner'

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string }

export function validatePlan(plan: TaskPlan): ValidationResult {
  const ids = new Set(plan.tasks.map(t => t.id))

  for (const task of plan.tasks) {
    // 0. Forbidden fields — reject LLM output injection patterns
    const forbidden = ['artifact', 'actions'] as const
    for (const field of forbidden) {
      if (field in (task as object)) {
        return { ok: false, error: `Task "${task.id}" contains forbidden field "${field}"` }
      }
    }

    // 1. connector.action must exist in registry
    const action = lookupAction(task.tool, task.action)
    if (!action) {
      const available = Object.keys(CONNECTOR_REGISTRY[task.tool] ?? {}).join(', ') || 'none'
      return {
        ok: false,
        error: `Unknown action "${task.tool}.${task.action}". Available for "${task.tool}": ${available}`,
      }
    }

    // 2. depends_on IDs must exist in the same plan
    for (const dep of task.depends_on ?? []) {
      if (!ids.has(dep)) {
        return { ok: false, error: `Task "${task.id}" depends_on unknown task "${dep}"` }
      }
    }
  }

  // 3. No cycles (DFS)
  const cycle = detectCycle(plan.tasks)
  if (cycle) return { ok: false, error: `Circular dependency: ${cycle}` }

  return { ok: true }
}

function detectCycle(tasks: PlanTask[]): string | null {
  const adj = new Map<string, string[]>()
  for (const t of tasks) adj.set(t.id, t.depends_on ?? [])

  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  for (const t of tasks) color.set(t.id, WHITE)

  function dfs(id: string, path: string[]): string | null {
    color.set(id, GRAY)
    for (const dep of adj.get(id) ?? []) {
      if (color.get(dep) === GRAY) return [...path, id, dep].join(' → ')
      if (color.get(dep) === WHITE) {
        const found = dfs(dep, [...path, id])
        if (found) return found
      }
    }
    color.set(id, BLACK)
    return null
  }

  for (const t of tasks) {
    if (color.get(t.id) === WHITE) {
      const found = dfs(t.id, [])
      if (found) return found
    }
  }
  return null
}
