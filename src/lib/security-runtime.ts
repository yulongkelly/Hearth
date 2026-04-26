import { CONNECTOR_REGISTRY } from '@/lib/butler/connector-registry'
import type { PlanTask } from '@/lib/butler/planner'

// ─── Injection / exfiltration patterns (source of truth for the whole system) ─

export const INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /act\s+as\s+if/i,
  /disregard\s+(all|your|the)/i,
  /curl[^|]*Authorization/i,
  /wget[^|]*token/i,
]

export const INVISIBLE_UNICODE = /[\u200b-\u200f\u202a-\u202e\ufeff]/g

export const OUTBOUND_ACTIONS = new Set([
  'gmail.send_email',
  'email.send_email',
  'http.post',
  'http.delete',
])

// ─── Capability map (derived from connector registry) ─────────────────────────

const CAPABILITY_MAP = new Map<string, Set<string>>(
  Object.entries(CONNECTOR_REGISTRY).map(([connector, actions]) => [
    connector,
    new Set(Object.keys(actions)),
  ])
)

// ─── Decision type ────────────────────────────────────────────────────────────

export type SecurityDecision =
  | { allowed: true;  task: PlanTask }
  | { allowed: false; reason: string }

function reject(reason: string): SecurityDecision {
  return { allowed: false, reason }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripInvisible(s: string): string {
  return s.replace(INVISIBLE_UNICODE, '')
}

function containsInjection(s: string): boolean {
  return INJECTION_PATTERNS.some(re => re.test(s))
}

function sanitizeStringArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === 'string' ? stripInvisible(v) : v
  }
  return out
}

// ─── Main enforcement function ────────────────────────────────────────────────

export function enforceSecurityPolicy(
  task: PlanTask,
  resolvedArgs: Record<string, unknown>,
): SecurityDecision {
  // 1. Capability check — connector must be in the registry
  const allowedActions = CAPABILITY_MAP.get(task.tool)
  if (!allowedActions) {
    return reject(`Connector "${task.tool}" is not in the capability map`)
  }
  if (!allowedActions.has(task.action)) {
    return reject(`Action "${task.action}" is not allowed for connector "${task.tool}"`)
  }

  // 2. Universal guards on all string arg values
  for (const [key, val] of Object.entries(resolvedArgs)) {
    if (typeof val !== 'string') continue

    // Path traversal — blocked for every connector
    if (val.includes('../') || val.includes('..\\')) {
      return reject(`Argument "${key}" contains a path traversal sequence`)
    }

    // Artifact injection — blocked for every connector
    // (catches LLM summarize output sneaking an "actions" array into a string arg)
    if (/"\s*actions"\s*:/.test(val)) {
      return reject(`Argument "${key}" contains a forbidden "actions" field`)
    }
  }

  // 3. Connector-specific checks

  // memory — strip injection patterns from content
  if (task.tool === 'memory' && task.action === 'add') {
    const content = typeof resolvedArgs.content === 'string' ? resolvedArgs.content : ''
    if (containsInjection(content)) {
      return reject('Memory content contains disallowed injection pattern')
    }
  }

  // http — must use a named connection; bare URLs from LLM are not allowed
  if (task.tool === 'http') {
    const connection = resolvedArgs.connection
    if (!connection || typeof connection !== 'string' || connection.trim() === '') {
      return reject(
        'http tasks must specify a "connection" name — bare LLM-supplied URLs are not permitted'
      )
    }
  }

  // outbound actions — check all string args for injection patterns
  if (OUTBOUND_ACTIONS.has(`${task.tool}.${task.action}`)) {
    for (const [key, val] of Object.entries(resolvedArgs)) {
      if (typeof val !== 'string') continue
      if (containsInjection(val)) {
        return reject(`Outbound arg "${key}" contains a disallowed injection pattern`)
      }
    }
  }

  // 4. Sanitize invisible unicode from all string args
  const sanitizedArgs = sanitizeStringArgs(resolvedArgs)

  return { allowed: true, task: { ...task, args: sanitizedArgs } }
}
