import { NextRequest } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { model, messages, stream = true } = body

    if (!model || !messages) {
      return new Response(JSON.stringify({ error: 'model and messages are required' }), { status: 400 })
    }

    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream }),
    })

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text()
      return new Response(JSON.stringify({ error: errText || 'Ollama error' }), { status: ollamaRes.status })
    }

    return new Response(ollamaRes.body, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Cannot connect to Ollama' }), { status: 503 })
  }
}
