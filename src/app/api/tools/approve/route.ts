import { NextRequest, NextResponse } from 'next/server'
import { resolveApproval } from '@/lib/approval-store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { id, approved } = await req.json()
  if (!id || typeof approved !== 'boolean') {
    return NextResponse.json({ error: 'id and approved are required' }, { status: 400 })
  }
  const found = resolveApproval(id, approved)
  if (!found) {
    return NextResponse.json({ error: 'No pending approval with that id' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
