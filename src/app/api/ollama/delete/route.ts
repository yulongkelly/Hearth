import { NextRequest, NextResponse } from 'next/server'
import { OLLAMA_BASE_URL } from '@/lib/ollama'

export async function DELETE(req: NextRequest) {
  try {
    const { name } = await req.json()
    if (!name) {
      return NextResponse.json({ error: 'Model name is required' }, { status: 400 })
    }

    const res = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: text || 'Failed to delete model' }, { status: res.status })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Cannot connect to Ollama' }, { status: 503 })
  }
}
