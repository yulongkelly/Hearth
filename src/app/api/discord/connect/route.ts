import { NextRequest, NextResponse } from 'next/server'
import { startDiscordBot, getDiscordState } from '@/lib/discord-bot'

export async function POST(req: NextRequest) {
  let token: string | undefined
  try { const body = await req.json(); if (body.token) token = String(body.token).trim() } catch {}
  try {
    await startDiscordBot(token)
  } catch (err) {
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'Failed', botName: null, guilds: [] }, { status: 400 })
  }
  return NextResponse.json(getDiscordState())
}
