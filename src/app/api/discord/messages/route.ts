import { NextRequest, NextResponse } from 'next/server'
import { queryDiscordMessages } from '@/lib/discord-store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const contact = req.nextUrl.searchParams.get('contact') ?? undefined
  const channel = req.nextUrl.searchParams.get('channel') ?? undefined
  const days    = Number(req.nextUrl.searchParams.get('days'))  || 7
  const limit   = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 200)
  return NextResponse.json({ messages: queryDiscordMessages({ contact, channel, days, limit }) })
}
