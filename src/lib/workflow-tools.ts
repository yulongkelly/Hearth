import type { ToolParameter } from './user-tools'

export interface WorkflowStep {
  id: string
  type: 'tool' | 'action'
  name: string
  params: Record<string, unknown>
  output: string
}

export interface WorkflowTool {
  id: string
  name: string
  description: string
  icon: string
  goal: string
  steps: WorkflowStep[]
  parameters: ToolParameter[]
  createdAt: string
  runs: WorkflowRun[]
}

export interface WorkflowRun {
  id: string
  parameters: Record<string, string>
  stepOutputs: Record<string, string>
  createdAt: string
}

export const TOOL_WHITELIST = ['get_calendar_events', 'get_inbox', 'read_email', 'get_transactions', 'http_request'] as const
export const ACTION_WHITELIST = ['merge_lists', 'detect_conflicts', 'filter_events', 'summarize'] as const

export const UI_MAP: Record<string, string> = {
  get_calendar_events: 'Get calendar events',
  get_inbox:           'Get emails',
  read_email:          'Read email',
  get_transactions:    'Get bank transactions',
  http_request:        'HTTP Request',
  merge_lists:         'Combine results',
  detect_conflicts:    'Detect conflicts',
  filter_events:       'Filter events',
  summarize:           'Summarize',
}

// Params that map to known enum sets — used by the plan editor to render dropdowns
export const ENUM_PARAMS: Record<string, string[]> = {
  account: [], // populated dynamically from listAccounts()
}

const STORAGE_KEY = 'hearth_workflow_tools'

export function loadWorkflowTools(): WorkflowTool[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch { return [] }
}

export function saveWorkflowTools(tools: WorkflowTool[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tools))
}

export function addWorkflowTool(tool: WorkflowTool) {
  saveWorkflowTools([...loadWorkflowTools(), tool])
}

export function addWorkflowRun(toolId: string, run: WorkflowRun) {
  saveWorkflowTools(loadWorkflowTools().map(t =>
    t.id === toolId ? { ...t, runs: [run, ...t.runs] } : t
  ))
}

export function deleteWorkflowTool(toolId: string) {
  saveWorkflowTools(loadWorkflowTools().filter(t => t.id !== toolId))
}
