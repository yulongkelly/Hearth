import { NextRequest } from 'next/server'
import { loadConnections, removeConnection } from '@/lib/custom-connection-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const list = loadConnections().map(({ id, service, testUrl, verifiedAt }) => ({
    id, service, testUrl, verifiedAt,
  }))
  return Response.json({ connections: list })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  removeConnection(String(id))
  return Response.json({ ok: true })
}
