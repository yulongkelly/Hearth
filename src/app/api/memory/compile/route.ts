import { NextRequest, NextResponse } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'
import { listEvents } from '@/lib/event-store'
import { readMemory, addEntry } from '@/lib/memory-store'

export const dynamic = 'force-dynamic'

function summariseEvent(e: ReturnType<typeof listEvents>[number]): string {
  if (e.type === 'tool_call') {
    const args   = e.args ? ` (${Object.entries(e.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})` : ''
    const result = e.result ? ` → ${e.result.slice(0, 120)}` : ''
    return `[${e.timestamp.slice(0, 16)}] tool:${e.tool}${args}${result}`
  }
  if (e.type === 'workflow_run') {
    return `[${e.timestamp.slice(0, 16)}] workflow:${e.workflowName ?? e.workflowId} (${e.durationMs ?? '?'}ms)`
  }
  return ''
}

export async function POST(req: NextRequest) {
  const body  = await req.json().catch(() => ({}))
  const model = (body.model as string) || 'llama3.2:3b'

  const events = listEvents({ days: 30, limit: 100 })
  if (!events.length) return NextResponse.json({ added: 0, entries: [], message: 'No events to analyze.' })

  const eventSummary = events.map(summariseEvent).filter(Boolean).join('\n')
  const currentMemory = readMemory('memory')

  const prompt = `You are analyzing recent Hearth activity to extract useful memory entries.

Current memory already saved:
${currentMemory || '(none)'}

Recent actions (newest first):
${eventSummary}

Based on these actions, extract concise memory entries that would help Hearth serve this user better.
Focus on: patterns (tools used frequently), preferences revealed, accounts/institutions used, conventions established.
Skip one-off actions, obvious facts, or anything already in current memory.

Output ONLY the entries to add, one per line, each starting with "- ".
If nothing useful to add, respond with exactly: nothing to add`

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) return NextResponse.json({ error: 'LLM request failed' }, { status: 502 })

  const data   = await res.json()
  const output = String(data?.message?.content ?? '').trim()

  if (!output || output.toLowerCase().startsWith('nothing to add')) {
    return NextResponse.json({ added: 0, entries: [], message: 'Nothing to add.' })
  }

  const lines = output
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2).trim())
    .filter(Boolean)

  const added: string[] = []
  for (const line of lines) {
    const result = addEntry('memory', line)
    if (result === 'Memory saved.') added.push(line)
  }

  return NextResponse.json({ added: added.length, entries: added })
}
