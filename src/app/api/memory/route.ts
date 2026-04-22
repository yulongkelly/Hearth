import { NextRequest } from 'next/server'
import { readMemory, writeFullMemory } from '@/lib/memory-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    memory: readMemory('memory'),
    user:   readMemory('user'),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { target, content } = body

  if (target !== 'memory' && target !== 'user') {
    return Response.json({ error: 'target must be "memory" or "user"' }, { status: 400 })
  }
  if (typeof content !== 'string') {
    return Response.json({ error: 'content must be a string' }, { status: 400 })
  }

  const result = writeFullMemory(target, content)
  if (result.startsWith('Error:')) {
    return Response.json({ error: result }, { status: 400 })
  }

  return Response.json({ ok: true })
}
