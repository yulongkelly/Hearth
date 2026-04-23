import { OLLAMA_BASE_URL } from './ollama'
import { validatePage, type CardPage, type TextPage } from './ui-schema'

export async function executeAction(
  name: string,
  params: Record<string, unknown>,
  context: Record<string, string>,
  model?: string,
): Promise<string> {
  switch (name) {
    case 'merge_lists':      return execMergeLists(params, context)
    case 'detect_conflicts': return execDetectConflicts(params, context)
    case 'filter_events':    return execFilterEvents(params, context)
    case 'summarize':        return execSummarize(params, context, model)
    default:                 return `Error: unknown action "${name}"`
  }
}

function resolveVar(value: unknown, context: Record<string, string>): string {
  const s = String(value ?? '')
  if (s.startsWith('$')) return context[s.slice(1)] ?? ''
  return context[s] ?? s
}

function execMergeLists(params: Record<string, unknown>, context: Record<string, string>): string {
  const inputs = Array.isArray(params.inputs) ? params.inputs : (params.inputs ? [params.inputs] : [])
  const resolved = inputs.map(v => resolveVar(v, context)).filter(Boolean)
  if (resolved.length > 0) return resolved.join('\n\n---\n\n')
  return Object.values(context).filter(Boolean).join('\n\n---\n\n')
}

interface ParsedEvent {
  title:    string
  start:    Date
  end:      Date
  account?: string
}

function parseEvents(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = []
  for (const block of text.split(/\n---\n/)) {
    const titleM   = block.match(/Title:\s*(.+)/i)
    const startM   = block.match(/Start:\s*(.+)/i)
    const endM     = block.match(/End:\s*(.+)/i)
    const accountM = block.match(/Account:\s*(.+)/i)
    if (!startM || !endM) continue
    const start = new Date(startM[1].trim())
    const end   = new Date(endM[1].trim())
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue
    events.push({
      title:   titleM   ? titleM[1].trim()   : '(untitled)',
      start, end,
      account: accountM ? accountM[1].trim() : undefined,
    })
  }
  return events
}

function execDetectConflicts(params: Record<string, unknown>, context: Record<string, string>): string {
  const data   = resolveVar(params.events ?? params.inputs ?? '', context)
  const events = parseEvents(data)
  const conflicts: string[] = []
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j]
      if (a.start < b.end && b.start < a.end) {
        const fmt = (d: Date) =>
          d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        conflicts.push(
          `**Conflict:** "${a.title}"${a.account ? ` [${a.account}]` : ''} (${fmt(a.start)}–${fmt(a.end)}) overlaps with "${b.title}"${b.account ? ` [${b.account}]` : ''} (${fmt(b.start)}–${fmt(b.end)})`
        )
      }
    }
  }
  if (conflicts.length === 0) return 'No conflicts found.'
  return `Found ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}:\n\n${conflicts.join('\n\n')}`
}

function execFilterEvents(params: Record<string, unknown>, context: Record<string, string>): string {
  const data  = resolveVar(params.events ?? '', context)
  const query = String(params.query ?? '').toLowerCase()
  if (!query) return data
  const filtered = data.split(/\n---\n/).filter(b => b.toLowerCase().includes(query))
  return filtered.length > 0 ? filtered.join('\n\n---\n\n') : 'No events matched the filter.'
}

// ── Deterministic fallback formatters → always produce UIPage JSON ────

function eventsToPage(text: string): string | null {
  const events = parseEvents(text)
  if (events.length === 0) return null
  const page: CardPage = {
    type:  'card_page',
    title: `${events.length} event${events.length === 1 ? '' : 's'}`,
    cards: events.map(e => {
      const date  = e.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      const start = e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      const end   = e.end.toLocaleTimeString('en-US',   { hour: 'numeric', minute: '2-digit', hour12: true })
      return { headline: e.title, subtext: `${date} · ${start} – ${end}`, tags: e.account ? [e.account] : undefined }
    }),
  }
  return JSON.stringify(page)
}

function emailsToPage(text: string): string | null {
  const blocks = text.split(/\n(?=ID:|From:)/m).map(b => b.trim()).filter(Boolean)
  const cards = blocks.flatMap(block => {
    const subject = block.match(/Subject:\s*(.+)/i)?.[1]?.trim()
    const from    = block.match(/From:\s*(.+)/i)?.[1]?.trim()
    const date    = block.match(/Date:\s*(.+)/i)?.[1]?.trim()
    const snippet = block.match(/Snippet:\s*(.+)/i)?.[1]?.trim()
    if (!subject && !from) return []
    return [{ headline: subject ?? '(no subject)', subtext: from, note: snippet }]
  })
  if (cards.length === 0) return null
  const page: CardPage = { type: 'card_page', title: `${cards.length} email${cards.length === 1 ? '' : 's'}`, cards }
  return JSON.stringify(page)
}

function dataToFallbackPage(text: string): string {
  return emailsToPage(text)
    ?? eventsToPage(text)
    ?? JSON.stringify({ type: 'text_page', body: text.trim() } satisfies TextPage)
}

// ── LLM schema prompt ─────────────────────────────────────────────────

const SCHEMA_SYSTEM = `You are a UI schema generator. Convert input data into ONE of these 3 JSON schemas. Return ONLY valid JSON, nothing else.

Tier 1 – card_page (rich structure: events, emails, tasks, conflicts):
{"type":"card_page","title":"short title","badge":{"text":"5 events","variant":"default"},"cards":[{"headline":"main text","subtext":"date or detail","tags":["tag"],"note":"extra"}]}

Tier 2 – list_page (simple lists):
{"type":"list_page","title":"short title","items":[{"text":"item","detail":"secondary","tags":["tag"]}]}

Tier 3 – text_page (prose summaries):
{"type":"text_page","title":"short title","body":"summary text"}

Rules: choose richest tier that fits. badge variant: "destructive"=errors/conflicts, "success"=all-clear, "warning"=attention needed, "default"=neutral. Max 20 cards/items. Be concise.`

function extractRawJSON(text: string): string | null {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/```[\w]*\n?/g, '')
    .trim()
  try { JSON.parse(cleaned); return cleaned } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) { try { JSON.parse(match[0]); return match[0] } catch {} }
  return null
}

async function execSummarize(params: Record<string, unknown>, context: Record<string, string>, model?: string): Promise<string> {
  let data = resolveVar(params.data ?? '', context)
  if (!data) {
    const vals = Object.values(context).filter(Boolean)
    data = vals.length > 0 ? vals[vals.length - 1] : ''
  }
  if (!data) return JSON.stringify({ type: 'text_page', body: 'Nothing to summarize.' } satisfies TextPage)

  const fallback = dataToFallbackPage(data)

  if (!model) return fallback
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SCHEMA_SYSTEM },
          { role: 'user',   content: `${String(params.instruction ?? 'Convert this data into the JSON schema')}:\n\n${data.slice(0, 4000)}` },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) return fallback
    const json  = await res.json()
    const raw   = extractRawJSON(json.message?.content ?? '')
    if (!raw) return fallback
    // Validate it — if LLM produced garbage, degrade gracefully
    const page = validatePage(raw)
    return page.type === 'text_page' && page.body === raw ? fallback : raw
  } catch {
    return fallback
  }
}
