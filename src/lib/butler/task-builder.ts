export type TaskIntent   = 'read' | 'send' | 'chat' | 'summarize' | 'workflow' | 'memory'
export type PrivacyLevel = 'high' | 'medium' | 'low'

export interface Task {
  toolName:     string
  args:         Record<string, unknown>
  intent:       TaskIntent
  privacyLevel: PrivacyLevel
  // false = must stay on-device; true = may route to cloud model (no real data attached)
  canUseCloud:  boolean
}

// High-privacy tools: contain real user data that must never leave the device
const HIGH_PRIVACY = new Set([
  'get_inbox', 'read_email', 'send_email',
  'get_transactions',
  'get_wechat_messages',  'send_wechat_message',
  'get_qq_messages',      'send_qq_message',
  'get_telegram_messages','send_telegram_message',
  'get_discord_messages', 'send_discord_message',
])

// Medium-privacy tools: non-sensitive personal data (calendar titles, schedules)
const MEDIUM_PRIVACY = new Set([
  'get_calendar_events',
])

// Send-intent tools: any tool that pushes data to an external service
const SEND_TOOLS = new Set([
  'send_email',
  'send_wechat_message',
  'send_qq_message',
  'send_telegram_message',
  'send_discord_message',
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
