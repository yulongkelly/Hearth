import { NextRequest } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json()
    if (!name) {
      return new Response(JSON.stringify({ error: 'Model name is required' }), { status: 400 })
    }

    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
    })

    if (!ollamaRes.ok) {
      return new Response(JSON.stringify({ error: 'Ollama pull failed' }), { status: ollamaRes.status })
    }

    // Stream Ollama's NDJSON response directly to the client
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
