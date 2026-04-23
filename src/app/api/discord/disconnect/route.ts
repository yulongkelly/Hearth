import { NextResponse } from 'next/server'
import { stopDiscordBot } from '@/lib/discord-bot'

export async function POST() {
  await stopDiscordBot()
  return NextResponse.json({ ok: true })
}
