import { NextRequest, NextResponse } from 'next/server'
import { queryQqMessages } from '@/lib/qq-store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const contact = req.nextUrl.searchParams.get('contact') ?? undefined
  const days    = Number(req.nextUrl.searchParams.get('days'))  || 7
  const limit   = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 200)
  return NextResponse.json({ messages: queryQqMessages({ contact, days, limit }) })
}
