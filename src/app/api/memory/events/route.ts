import { NextRequest, NextResponse } from 'next/server'
import { listEvents } from '@/lib/event-store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const days  = Number(req.nextUrl.searchParams.get('days'))  || 7
  const limit = Number(req.nextUrl.searchParams.get('limit')) || 20
  const type  = req.nextUrl.searchParams.get('type') ?? undefined
  return NextResponse.json({ events: listEvents({ type, days, limit }) })
}
