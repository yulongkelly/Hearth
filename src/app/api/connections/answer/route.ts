import { NextRequest } from 'next/server'
import { resolveConnection } from '@/lib/connection-answer-store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, ok, connectionId, error } = body
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const resolved = resolveConnection(String(id), { ok: Boolean(ok), connectionId, error })
  return Response.json({ resolved })
}
