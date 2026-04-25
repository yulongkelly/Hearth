import type { PlatformName } from './platform-adapter'
import { getConnected } from './platform-registry'
import { getModelAdapter } from './adapters/registry'
import { getAvailableTools, executeTool } from './tools'
import { readMemoryTrimmed, readMemoryEntries } from './memory-store'
import { retrieveRelevantMemory } from './memory-retrieval'
import { OLLAMA_BASE_URL } from './ollama'
import { appendEvent } from './event-store'
import type { ChatMessage } from './model-adapter'

// eslint-disable-next-line no-var
declare global { var __autoResponderStarted: boolean | undefined }

const MESSAGING_PLATFORMS = new Set<PlatformName>(['email'])

// Tools that must never appear in auto-respond context
const EXCLUDED_TOOLS = new Set(['create_workflow', 'ask_clarification', 'request_connection'])

const MAX_TOOL_ITERATIONS = 3

// Per-sender rolling conversation: key is "platform:from"
const conversations = new Map<string, ChatMessage[]>()
// Last-processed timestamp per platform
const lastSeen = new Map<string, string>()

const AUTO_SYSTEM_PROMPT = `You are responding to incoming messages on behalf of the user. Keep replies concise and helpful. You have access to read tools to look up information before replying. Do NOT call any send_ tools — your text response is delivered automatically.`

function convKey(platform: string, from: string) {
  return `${platform}:${from}`
}

async function respondToMessage(
  platform: string,
  from: string,
  room: string | null,
  text: string,
): Promise<void> {
  try {
    const adapter = getConnected().find(a => a.name === platform)
    if (!adapter) return

    const modelAdapter = getModelAdapter()
    const model = process.env.HEARTH_DEFAULT_MODEL
      ?? (await modelAdapter.listModels?.())?.[0]
    if (!model) return

    // Memory context
    const userBlock = readMemoryTrimmed('user', 2000)
    const memEntries = readMemoryEntries('memory')
    const relevant = await retrieveRelevantMemory(text, memEntries, 3, OLLAMA_BASE_URL, model)
    const memBlock = relevant.join('\n')

    const systemContent = [
      AUTO_SYSTEM_PROMPT,
      userBlock ? `<user_profile>\n${userBlock}\n</user_profile>` : '',
      memBlock  ? `<memory>\n${memBlock}\n</memory>`              : '',
    ].filter(Boolean).join('\n\n')

    // Filter tools: no sends, no workflow/clarification
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = getAvailableTools().filter((t: any) => {
      const name: string = t?.function?.name ?? ''
      return !name.startsWith('send_') && !EXCLUDED_TOOLS.has(name)
    })

    const key = convKey(platform, from)
    const history = conversations.get(key) ?? []
    const userMsg: ChatMessage = { role: 'user', content: room ? `[${room}] ${text}` : text }

    let loopMessages: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...history,
      userMsg,
    ]

    let responseText = ''

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await modelAdapter.chat({ model, messages: loopMessages, tools })

      if (!result.tool_calls?.length) {
        responseText = result.content
        break
      }

      // Execute each tool call and append results
      loopMessages.push({ role: 'assistant', content: result.content ?? '', tool_calls: result.tool_calls })
      for (const tc of result.tool_calls) {
        const args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments
        const toolResult = await executeTool(tc.function.name, args)
        loopMessages.push({ role: 'tool', content: String(toolResult) })
      }
    }

    if (!responseText) return

    // Send the reply back to the originating sender (or group)
    await adapter.send(room ?? from, responseText)

    // Update rolling conversation history (cap at 20 messages = 10 turns)
    const assistantMsg: ChatMessage = { role: 'assistant', content: responseText }
    conversations.set(key, [...history, userMsg, assistantMsg].slice(-20))

    appendEvent({
      type:   'tool_call',
      tool:   'auto_respond',
      args:   { platform, from, room: room ?? undefined },
      result: responseText.slice(0, 200),
    })
  } catch { /* non-critical — never let a single message crash the poll loop */ }
}

async function poll(): Promise<void> {
  try {
    const connected = getConnected().filter(a => MESSAGING_PLATFORMS.has(a.name as PlatformName))

    for (const adapter of connected) {
      const platform = adapter.name
      const since = lastSeen.get(platform)

      // Record baseline on first encounter — don't respond to messages that arrived before boot
      lastSeen.set(platform, new Date().toISOString())
      if (!since) continue

      const msgs = adapter.queryMessages({ days: 1, limit: 50 })
      const fresh = msgs.filter(m => m.timestamp > since)

      for (const msg of fresh) {
        await respondToMessage(platform, msg.from, msg.room, msg.text)
      }
    }
  } catch { /* non-critical */ }
}

export function startAutoResponder(): void {
  if (global.__autoResponderStarted) return
  global.__autoResponderStarted = true

  // First call establishes the baseline timestamp per platform (no replies sent).
  // Subsequent ticks respond to anything newer than that baseline.
  poll()
  setInterval(() => { poll() }, 5_000)
}

// ─── Test utilities (not part of public API) ──────────────────────────────────

export function _resetForTest(): void {
  conversations.clear()
  lastSeen.clear()
  global.__autoResponderStarted = undefined
}

export { poll as _poll }
