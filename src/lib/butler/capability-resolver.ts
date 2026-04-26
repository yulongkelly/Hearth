import { executeTool } from '@/lib/tools'
import type { TaskPlan, PlanTask } from './planner'

export interface CapabilityResolution {
  status: 'needs_connection' | 'blocked'
  capabilitySpec?: string   // from query_capabilities if found
  searchSummary?: string    // from web_search if needed
  reason?: string           // for blocked
}

/**
 * For each task with tool='unknown', investigate whether the target service
 * is connectable via HTTP/API. Sets task.status and attaches resolution data
 * to task.args. All other tasks are marked 'ready'.
 *
 * This runs after the plan judge and before the executor.
 */
export async function resolveCapabilities(plan: TaskPlan): Promise<TaskPlan> {
  const resolved = await Promise.all(plan.tasks.map(resolveTask))
  return { ...plan, tasks: resolved }
}

async function resolveTask(task: PlanTask): Promise<PlanTask> {
  if (task.tool !== 'unknown') return { ...task, status: 'ready' }

  const target = task.unknown_target ?? String(task.args.target ?? '')
  if (!target) return { ...task, status: 'blocked', args: { ...task.args, reason: 'No target service specified.' } }

  // Step 1: check local capability graph
  try {
    const capResult = await executeTool('query_capabilities', { query: target })
    const notFound = capResult.startsWith('No capability found')
    if (!notFound) {
      return {
        ...task,
        status: 'needs_connection',
        args: { ...task.args, capabilitySpec: capResult },
      }
    }
  } catch { /* fall through to web search */ }

  // Step 2: web search for API documentation
  try {
    const searchResult = await executeTool('web_search', {
      query: `${target} REST API authentication endpoint`,
    })
    const hasApi = looksLikeApiInfo(searchResult)
    if (hasApi) {
      return {
        ...task,
        status: 'needs_connection',
        args: { ...task.args, searchSummary: searchResult.slice(0, 800) },
      }
    }
  } catch { /* fall through to blocked */ }

  return {
    ...task,
    status: 'blocked',
    args: {
      ...task.args,
      reason: `${target} does not appear to have a public REST API that can be connected via HTTP.`,
    },
  }
}

// Heuristic: does a web search result suggest a usable REST API exists?
function looksLikeApiInfo(text: string): boolean {
  const lower = text.toLowerCase()
  const apiSignals = ['api key', 'api_key', 'bearer token', 'authorization header', 'rest api', 'endpoint', 'base url', 'oauth']
  const noApiSignals = ['no api', 'no public api', 'cli only', 'desktop only', 'not available']
  if (noApiSignals.some(s => lower.includes(s))) return false
  return apiSignals.some(s => lower.includes(s))
}
