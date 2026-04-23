import type { Task } from './task-builder'
import { getToolAccess } from '@/lib/tool-access'

export type PolicyDecision = 'allow' | 'confirm' | 'block'

export function enforcePolicy(task: Task): PolicyDecision {
  // All send operations require explicit user confirmation — no exceptions
  if (task.intent === 'send') return 'confirm'

  // Defer to the existing access-level table for any other write/destructive tools
  const access = getToolAccess(task.toolName)
  if (access !== 'read') return 'confirm'

  // Future rules can be inserted here:
  // - Cross-platform content forwarding (e.g., WeChat → Discord) → 'confirm'
  // - Late-night send restrictions → 'block'
  // - Per-platform rate limits → 'block'

  return 'allow'
}
