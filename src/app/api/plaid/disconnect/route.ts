import { NextRequest, NextResponse } from 'next/server'
import { removeItem } from '@/lib/plaid-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { itemId } = await req.json()
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })
  removeItem(String(itemId))
  return NextResponse.json({ ok: true })
}
