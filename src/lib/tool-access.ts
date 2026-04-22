export type ToolAccess = 'read' | 'write' | 'destructive'

export const TOOL_ACCESS: Record<string, ToolAccess> = {
  get_inbox:           'read',
  read_email:          'read',
  get_calendar_events: 'read',
  ask_clarification:   'read',
  memory:              'read',
  create_tool:         'write',
}

export function getToolAccess(name: string): ToolAccess {
  return TOOL_ACCESS[name] ?? 'write'
}

export function buildPreview(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'create_tool':
      return `Create tool "${args.name ?? 'unnamed'}": ${args.description ?? ''}`
    default:
      return `Run ${name}: ${JSON.stringify(args)}`
  }
}

export function riskLabel(access: ToolAccess): string {
  if (access === 'destructive') return 'Destructive — cannot be undone'
  return 'Requires your approval'
}
