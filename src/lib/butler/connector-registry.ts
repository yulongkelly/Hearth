export type SafetyLevel = 'low' | 'medium' | 'high'

export interface ConnectorAction {
  safety_level: SafetyLevel
  toolName: string  // key passed to executeTool()
}

export const CONNECTOR_REGISTRY: Record<string, Record<string, ConnectorAction>> = {
  gmail: {
    get_inbox:  { safety_level: 'low',  toolName: 'get_inbox' },
    read_email: { safety_level: 'low',  toolName: 'read_email' },
    send_email: { safety_level: 'high', toolName: 'send_email' },
  },
  calendar: {
    get_events:   { safety_level: 'low',    toolName: 'get_calendar_events' },
    create_event: { safety_level: 'medium', toolName: 'create_event' },
  },
  email: {
    get_inbox:  { safety_level: 'low',  toolName: 'get_email_inbox' },
    send_email: { safety_level: 'high', toolName: 'send_email_imap' },
  },
  memory: {
    add:    { safety_level: 'low', toolName: 'memory' },
    search: { safety_level: 'low', toolName: 'memory' },
    remove: { safety_level: 'low', toolName: 'memory' },
  },
  http: {
    get:    { safety_level: 'low',  toolName: 'http_request' },
    post:   { safety_level: 'high', toolName: 'http_request' },
    delete: { safety_level: 'high', toolName: 'http_request' },
  },
  system: {
    merge_lists:      { safety_level: 'low', toolName: 'merge_lists' },
    detect_conflicts: { safety_level: 'low', toolName: 'detect_conflicts' },
    filter_events:    { safety_level: 'low', toolName: 'filter_events' },
    summarize:        { safety_level: 'low', toolName: 'summarize' },
    create_workflow:  { safety_level: 'low', toolName: 'create_workflow' },
    web_search:       { safety_level: 'low', toolName: 'web_search' },
    query_events:     { safety_level: 'low', toolName: 'query_events' },
  },
}

export function lookupAction(tool: string, action: string): ConnectorAction | null {
  return CONNECTOR_REGISTRY[tool]?.[action] ?? null
}
