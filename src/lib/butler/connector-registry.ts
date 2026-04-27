export type SafetyLevel = 'low' | 'medium' | 'high'

export interface ConnectorAction {
  safety_level: SafetyLevel
  toolName: string  // key passed to executeTool()
}

export const CONNECTOR_REGISTRY: Record<string, Record<string, ConnectorAction>> = {
  email: {
    search:        { safety_level: 'low',  toolName: 'email_search' },
    get:           { safety_level: 'low',  toolName: 'email_get' },
    send:          { safety_level: 'high', toolName: 'email_send' },
    list_accounts: { safety_level: 'low',  toolName: 'email_list_accounts' },
  },
  // Alias: ReAct LLM sometimes emits tool:"gmail" — map to the same executors as email
  gmail: {
    get_inbox:  { safety_level: 'low',  toolName: 'email_search' },
    read_email: { safety_level: 'low',  toolName: 'email_get' },
    send_email: { safety_level: 'high', toolName: 'email_send' },
  },
  calendar: {
    get_events:   { safety_level: 'low',    toolName: 'get_calendar_events' },
    create_event: { safety_level: 'medium', toolName: 'create_event' },
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
    merge_lists:        { safety_level: 'low',  toolName: 'merge_lists' },
    detect_conflicts:   { safety_level: 'low',  toolName: 'detect_conflicts' },
    filter_events:      { safety_level: 'low',  toolName: 'filter_events' },
    summarize:          { safety_level: 'low',  toolName: 'summarize' },
    create_workflow:    { safety_level: 'low',  toolName: 'create_workflow' },
    web_search:         { safety_level: 'low',  toolName: 'web_search' },
    query_events:       { safety_level: 'low',  toolName: 'query_events' },
    generate_digest:    { safety_level: 'low',  toolName: 'generate_digest' },
    query_capabilities: { safety_level: 'low',  toolName: 'query_capabilities' },
    request_connection: { safety_level: 'high', toolName: 'request_connection' },
  },
  content: {
    parse_html:           { safety_level: 'low', toolName: 'content_parse_html' },
    extract_text:         { safety_level: 'low', toolName: 'content_extract_text' },
    detect_receipt:       { safety_level: 'low', toolName: 'content_detect_receipt' },
    detect_order:         { safety_level: 'low', toolName: 'content_detect_order' },
    detect_subscription:  { safety_level: 'low', toolName: 'content_detect_subscription' },
    classify:             { safety_level: 'low', toolName: 'content_classify' },
    extract_structured:   { safety_level: 'low', toolName: 'content_extract_structured' },
    parse_receipt:        { safety_level: 'low', toolName: 'content_parse_receipt' },
    parse_travel:         { safety_level: 'low', toolName: 'content_parse_travel' },
    parse_email_to_event: { safety_level: 'low', toolName: 'content_parse_email_to_event' },
  },
  chat: {
    ask_clarification: { safety_level: 'low', toolName: 'chat_ask_clarification' },
  },
  reminders: {
    create:   { safety_level: 'low',    toolName: 'create_reminder'   },
    list:     { safety_level: 'low',    toolName: 'list_reminders'    },
    complete: { safety_level: 'low',    toolName: 'complete_reminder' },
    delete:   { safety_level: 'medium', toolName: 'delete_reminder'   },
  },
  // Pass-through for external services whose capability is resolved at runtime
  unknown: {
    call: { safety_level: 'high', toolName: 'unknown_call' },
  },
}

export function lookupAction(tool: string, action: string): ConnectorAction | null {
  return CONNECTOR_REGISTRY[tool]?.[action] ?? null
}
