# Hearth — System Design

## Architecture Diagram

```mermaid
graph TB
    subgraph Browser["Browser — React (Next.js App Router)"]
        direction TB
        Pages["Pages\n/ · /chat · /calendar\n/tools · /integrations\n/memory · /models · /settings"]
        LS["localStorage\nconversations · workflow tools · user tools"]
        GS["Module-level Stores\nChatStore · WorkflowRunStore\n(survive page navigation)"]
    end

    subgraph Server["Next.js API Routes (localhost:3000)"]
        direction TB
        OllamaRoute["/api/ollama/chat\nStreaming proxy + tool loop\nApproval gate · Clarification gate\nMemory injection"]
        ToolExec["/api/tools/execute\nRuns Google tools\n(get_inbox, read_email,\nsend_email, get_calendar_events)"]
        ActionExec["/api/tools/action\nRuns in-process actions\n(merge_lists, detect_conflicts,\nfilter_events, summarize→Ollama)"]
        AuthRoutes["/api/auth/*\nOAuth callback\nToken exchange"]
        MemRoute["/api/memory\nRead / write memory files"]
        ApproveRoutes["/api/tools/approve\n/api/tools/answers\nGate resolution"]
    end

    subgraph LocalMachine["Local Machine"]
        Ollama["Ollama  localhost:11434\nLlama 3.2 · Qwen 2.5\nMistral · DeepSeek R1 …"]
        FS["~/.hearth/\n├── google-credentials.json\n├── google-accounts.json\n└── memory/\n    ├── memory.txt  (agent facts)\n    └── user.txt    (user profile)"]
    end

    subgraph GoogleAPIs["Google APIs (external)"]
        Gmail["Gmail API\nread · send"]
        GCal["Calendar API\nread"]
        OAuth["OAuth 2.0\ntoken refresh"]
    end

    %% Browser ↔ Server
    Pages -->|"SSE stream\njson lines"| OllamaRoute
    Pages -->|"fetch"| ToolExec
    Pages -->|"fetch"| ActionExec
    Pages -->|"fetch"| MemRoute
    Pages -->|"localStorage R/W"| LS
    Pages <-->|"subscribe / emit"| GS

    %% Server ↔ Ollama
    OllamaRoute -->|"POST /api/chat\nstreaming"| Ollama
    ActionExec -->|"POST /api/chat\nsummarize step"| Ollama

    %% Server ↔ Google
    ToolExec -->|"REST + Bearer token"| Gmail
    ToolExec -->|"REST + Bearer token"| GCal
    AuthRoutes -->|"code exchange"| OAuth
    OllamaRoute -->|"tool calls routed to"| ToolExec

    %% Server ↔ FS
    AuthRoutes -->|"store tokens"| FS
    ToolExec -->|"read tokens"| FS
    MemRoute -->|"R/W"| FS
    OllamaRoute -->|"inject memory\ninto system prompt"| FS

    %% Tool loop detail
    OllamaRoute <-->|"approve / answers\ngating"| ApproveRoutes
```

## Key Design Principles

| Principle | How |
|---|---|
| **100% local** | Ollama runs on-device; no cloud LLM |
| **Background execution** | `ChatStore` + `WorkflowRunStore` survive React unmount; streams/steps write directly to localStorage |
| **Tool loop** | `/api/ollama/chat` drives a server-side loop: stream → detect tool call → execute → inject result → continue |
| **Approval gate** | Destructive tools (`send_email`, `create_workflow`) pause the stream and require user confirmation via `/api/tools/approve` |
| **UI schema** | LLM produces typed JSON (`card_page` / `list_page` / `text_page`); renderer is deterministic — no free-form markdown for structured data |
| **Multi-account** | All Google calls resolve accounts from `~/.hearth/google-accounts.json`; tokens auto-refresh |
| **Memory** | Agent reads `memory.txt` + `user.txt` from disk via system prompt injection; writes via `memory` tool |

## Data Flow — Chat Message

```
User types message
  → ChatInterface (browser)
  → POST /api/ollama/chat (SSE stream)
      → inject memory + system prompt
      → POST Ollama /api/chat (streaming)
      → detect tool_calls in response
          → if approval needed: emit pending_approval, wait for POST /api/tools/approve
          → execute tool via /api/tools/execute (Google API) or /api/tools/action (in-process)
          → inject tool result, continue stream
      → stream json lines to browser
  → ChatStore mirrors state (survives navigation)
  → persistStreamingContent() writes to localStorage on every token
```

## Data Flow — Workflow Execution

```
User clicks Run on a workflow tool
  → WorkflowRunPage reads tool definition from localStorage
  → WorkflowRunStore.startRun() — fire-and-forget (survives navigation)
  → executeWorkflow() iterates steps:
      → type=tool  → POST /api/tools/execute → Google API
      → type=action → POST /api/tools/action
          → summarize step → POST Ollama /api/chat → UIPage JSON
          → other actions (merge_lists, detect_conflicts, filter_events) → in-process
  → results stored in step context
  → addWorkflowRun() persists to localStorage
  → WorkflowRunStore.finishRun() → sidebar indicator clears
```

## File System Layout

```
~/.hearth/
├── google-credentials.json   OAuth client ID + secret (mode 0600)
├── google-accounts.json      Per-account tokens + nicknames (mode 0600)
└── memory/
    ├── memory.txt            Agent facts (conventions, environment)
    └── user.txt              User profile (preferences, context)

localStorage (browser)
├── hearth_conversations      Chat history
├── hearth_workflow_tools     Workflow tool definitions + run history
├── hearth_user_tools         Simple (non-workflow) tool definitions
├── hearth_default_model      Selected Ollama model name
└── hearth_settings           App settings (memory threshold, etc.)
```
