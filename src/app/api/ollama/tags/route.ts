import { NextResponse } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: 'Ollama returned an error' }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isTimeout = message.includes('timeout') || message.includes('abort') || message.toLowerCase().includes('timedout')
    return NextResponse.json(
      {
        error: 'Cannot connect to Ollama',
        detail: isTimeout
          ? `Connection timed out after 5s`
          : message.replace(/^.*?ECONNREFUSED.*$/, 'Connection refused — nothing is listening on that port'),
        url: `${OLLAMA_BASE_URL}/api/tags`,
      },
      { status: 503 }
    )
  }
}
