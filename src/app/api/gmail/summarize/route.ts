import { NextRequest, NextResponse } from 'next/server'
import { getModelAdapter } from '@/lib/adapters/registry'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { body, model } = await req.json()
  if (!body || !model) {
    return NextResponse.json({ error: 'Missing body or model' }, { status: 400 })
  }

  try {
    const adapter = getModelAdapter()
    const result  = await adapter.chat({
      model,
      messages: [
        {
          role:    'user',
          content: `Summarize this email in 2-3 sentences. Be concise and highlight the key action items or important information.\n\n${body.slice(0, 4000)}`,
        },
      ],
      signal: AbortSignal.timeout(30_000),
    })
    return NextResponse.json({ summary: result.content })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'LLM error' }, { status: 502 })
  }
}
