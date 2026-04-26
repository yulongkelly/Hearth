import type { ChatMessage } from '@/lib/model-adapter'
import type { ModelAdapter } from '@/lib/model-adapter'
import type { PreferenceSignal } from './types'
import { getLocaleForText } from './locale'

const VALID_TYPES = new Set([
  'preference', 'fact', 'pattern',
  'relationship', 'concern', 'identity', 'learning', 'goal', 'progress',
])

const EXTRACTOR_SYSTEM = `You are an observation extractor for a personal AI assistant.
Analyze the conversation and extract user signals. Return ONLY a valid JSON array — no markdown, no explanation.

Each element:
{"type":"<type>","domain":"<domain>","value":"<concise description>","tags":["<tag1>","<tag2>"],"metadata":{...}}

Signal types and when to use them:
- preference: communication style, format choices, tool preferences
- fact: objective facts about the user (job, location, name)
- pattern: recurring behavior across multiple interactions
- relationship: person the user mentions, emails, or asks about
  → domain="people", metadata={"person":"<Full Name>","sentiment":"positive|neutral|negative"}
  → Extract from: "I need to email Alice", "what did Bob say?", sender names in inbox results
- concern: worry, stress, anxiety signal ("I'm worried about X", "this is stressful", "I'm behind on Y")
  → domain="wellbeing"
- identity: value, self-perception, priority ("I care about privacy", "I want to be more disciplined")
  → domain="values"
- learning: topic being studied or practiced ("I'm learning Rust", "trying to get better at X")
  → domain="learning"
- goal: explicit target or intention ("I want to finish X by May", "my goal is Y")
  → domain="goals", metadata={"declared":true}
- progress: completion event, milestone ("I finished X", "finally got Y working", "done with Z")
  → domain="progress"

Rules:
- Only extract clear, explicit, or strongly implied signals. If nothing warrants extraction, return [].
- For relationship signals: extract sender names from email tool results (not body content).
- metadata is optional; only include relevant fields.
- Max 5 tags per signal, max 200 chars for value, domain max 50 chars lowercase.`

function buildExtractionPrompt(
  messages:    ChatMessage[],
  toolResults: Map<string, string>,
): string {
  const userLines = messages
    .filter(m => m.role === 'user')
    .map(m => `- "${String(m.content).slice(0, 200)}"`)
    .join('\n')

  const toolNames = Array.from(toolResults.keys()).slice(0, 10).join(', ')

  // Include a snippet of email inbox results for relationship extraction
  // Only sender names and subjects — cap at 500 chars total, never full bodies
  const emailSnippets: string[] = []
  for (const [key, val] of toolResults) {
    if (key.includes('inbox') || key.includes('email')) {
      // Extract sender-like lines (From:, sender, name fields) only
      const senderLines = val
        .split('\n')
        .filter(l => /from:|sender:|"name":|"from":/i.test(l))
        .slice(0, 10)
        .join('\n')
        .slice(0, 500)
      if (senderLines) emailSnippets.push(`Email senders:\n${senderLines}`)
    }
  }

  const parts: string[] = []
  if (userLines) parts.push(`User messages:\n${userLines}`)
  if (toolNames) parts.push(`Tool calls made: ${toolNames}`)
  if (emailSnippets.length > 0) parts.push(emailSnippets.join('\n'))
  return parts.join('\n\n')
}

function parseSignals(raw: string, sessionId: string): PreferenceSignal[] {
  try {
    const start = raw.indexOf('[')
    const end   = raw.lastIndexOf(']')
    if (start < 0 || end <= start) return []
    const arr = JSON.parse(raw.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    return arr
      .filter(item =>
        item && typeof item === 'object' &&
        typeof item.domain === 'string' &&
        typeof item.value  === 'string'
      )
      .map(item => {
        const sig: PreferenceSignal = {
          id:        crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type:      (VALID_TYPES.has(item.type) ? item.type : 'preference') as PreferenceSignal['type'],
          domain:    String(item.domain).toLowerCase().slice(0, 50),
          value:     String(item.value).slice(0, 200),
          tags:      Array.isArray(item.tags) ? item.tags.map(String).slice(0, 5) : [String(item.domain).toLowerCase()],
          sessionId,
        }
        if (item.metadata && typeof item.metadata === 'object') {
          const md: PreferenceSignal['metadata'] = {}
          if (typeof item.metadata.person === 'string') md.person = item.metadata.person.slice(0, 100)
          if (['positive', 'neutral', 'negative'].includes(item.metadata.sentiment)) md.sentiment = item.metadata.sentiment
          if (typeof item.metadata.week === 'string') md.week = item.metadata.week
          if (typeof item.metadata.declared === 'boolean') md.declared = item.metadata.declared
          if (Object.keys(md).length > 0) sig.metadata = md
        }
        if (sig.type === 'relationship' && !sig.metadata?.person) {
          const locale = getLocaleForText(sig.value)
          const extracted = locale.extractPersonName(sig.value)
          if (extracted) sig.metadata = { ...sig.metadata, person: extracted }
        }
        return sig
      })
  } catch { return [] }
}

export async function extractObservations(
  messages:    ChatMessage[],
  toolResults: Map<string, string>,
  sessionId:   string,
  adapter:     ModelAdapter,
  model:       string,
): Promise<PreferenceSignal[]> {
  const userMessages = messages.filter(m => m.role === 'user')
  if (userMessages.length === 0) return []

  try {
    const result = await adapter.chat({
      model,
      messages: [
        { role: 'system', content: EXTRACTOR_SYSTEM },
        { role: 'user',   content: buildExtractionPrompt(messages, toolResults) },
      ],
      signal: AbortSignal.timeout(15_000),
    })
    return parseSignals(result.content.trim(), sessionId)
  } catch { return [] }
}
