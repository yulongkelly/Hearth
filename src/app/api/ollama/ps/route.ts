import { NextResponse } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/ps`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: 'Ollama returned an error' }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Cannot connect to Ollama' }, { status: 503 })
  }
}
