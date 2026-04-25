export type TaskIntent   = 'read' | 'send' | 'chat' | 'summarize' | 'workflow' | 'memory'
export type PrivacyLevel = 'high' | 'medium' | 'low'

export interface Task {
  toolName:     string
  args:         Record<string, unknown>
  intent:       TaskIntent
  privacyLevel: PrivacyLevel
  canUseCloud:  boolean
}

const HIGH_PRIVACY = new Set([
  'get_inbox', 'read_email', 'send_email',
  'get_email_inbox', 'send_email_imap',
])

const MEDIUM_PRIVACY = new Set([
  'get_calendar_events', 'create_event',
])

const SEND_TOOLS = new Set([
  'send_email',
  'send_email_imap',
])

export function buildTask(toolName: string, args: Record<string, unknown>): Task {
  const privacyLevel: PrivacyLevel =
    HIGH_PRIVACY.has(toolName)   ? 'high'   :
    MEDIUM_PRIVACY.has(toolName) ? 'medium' : 'low'

  const intent: TaskIntent =
    SEND_TOOLS.has(toolName)              ? 'send'      :
    toolName === 'memory'                  ? 'memory'    :
    toolName === 'create_workflow'         ? 'workflow'  :
    toolName === 'ask_clarification'       ? 'chat'      :
    toolName.startsWith('get_') ||
    toolName.startsWith('read_') ||
    toolName.startsWith('query_')          ? 'read'      : 'read'

  return {
    toolName,
    args,
    intent,
    privacyLevel,
    canUseCloud: privacyLevel === 'low',
  }
}
