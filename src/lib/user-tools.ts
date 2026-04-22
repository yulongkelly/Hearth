export interface ToolParameter {
  name: string
  label: string
  type: 'text' | 'date' | 'number'
}

export interface ToolRun {
  id: string
  parameters: Record<string, string>
  result: string
  createdAt: string
}

export interface UserTool {
  id: string
  name: string
  description: string
  icon: string
  parameters: ToolParameter[]
  prompt: string
  createdAt: string
  runs: ToolRun[]
}

const STORAGE_KEY = 'hearth_user_tools'

export function loadUserTools(): UserTool[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch { return [] }
}

export function saveUserTools(tools: UserTool[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tools))
}

export function addUserTool(tool: UserTool) {
  const tools = loadUserTools()
  saveUserTools([...tools, tool])
}

export function addToolRun(toolId: string, run: ToolRun) {
  const tools = loadUserTools()
  saveUserTools(tools.map(t =>
    t.id === toolId ? { ...t, runs: [run, ...t.runs] } : t
  ))
}

export function deleteUserTool(toolId: string) {
  saveUserTools(loadUserTools().filter(t => t.id !== toolId))
}
