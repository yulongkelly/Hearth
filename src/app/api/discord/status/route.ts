import { NextResponse } from 'next/server'
import { getDiscordState, loadDiscordToken } from '@/lib/discord-bot'

export const dynamic = 'force-dynamic'

export async function GET() {
  const state = getDiscordState()
  return NextResponse.json({ ...state, hasToken: !!loadDiscordToken() })
}
