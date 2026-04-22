import { OLLAMA_BASE_URL } from './ollama'

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
  const inputs = Array.isArray(params.inputs) ? params.inputs : [params.inputs]
  return inputs.map(v => resolveVar(v, context)).filter(Boolean).join('\n\n---\n\n')
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
  const key = params.events ?? params.inputs ?? ''
  const data = resolveVar(key, context)
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

async function execSummarize(
  params: Record<string, unknown>,
  context: Record<string, string>,
  model?: string,
): Promise<string> {
  const data        = resolveVar(params.data ?? '', context)
  const instruction = String(params.instruction ?? 'Summarize this in 2-3 sentences. Be factual.')
  if (!data) return 'Nothing to summarize.'
  if (!model) return data

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a concise summarizer. Be factual. Only use information present in the data. Do not use any tools.' },
          { role: 'user',   content: `${instruction}\n\nData:\n${data.slice(0, 4000)}` },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return data
    const json = await res.json()
    return json.message?.content ?? data
  } catch {
    return data
  }
}
