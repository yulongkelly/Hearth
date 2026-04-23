import type { Task } from './task-builder'
import { enforcePolicy } from './policy'
import { executeTool, toolStatusLabel } from '@/lib/tools'

export interface ExecContext {
  requireApproval: (task: Task) => Promise<boolean>
  emitStatus:      (msg: string) => void
  logEvent:        (task: Task, result: string) => void
}

export async function executeTask(task: Task, ctx: ExecContext): Promise<string> {
  const decision = enforcePolicy(task)

  if (decision === 'block') {
    return `Action blocked by policy: ${task.toolName}`
  }

  if (decision === 'confirm') {
    const approved = await ctx.requireApproval(task)
    if (!approved) return 'Action rejected by user.'
  }

  ctx.emitStatus(toolStatusLabel(task.toolName))

  const result = await executeTool(task.toolName, task.args)

  ctx.logEvent(task, String(result))

  return result
}
