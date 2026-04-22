import { NextRequest, NextResponse } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { body, model } = await req.json()
  if (!body || !model) {
    return NextResponse.json({ error: 'Missing body or model' }, { status: 400 })
  }

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: 'user',
          content: `Summarize this email in 2-3 sentences. Be concise and highlight the key action items or important information.\n\n${body.slice(0, 4000)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Ollama error' }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json({ summary: data.message?.content ?? '' })
}
