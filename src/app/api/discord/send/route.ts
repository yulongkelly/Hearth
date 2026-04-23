import { NextRequest, NextResponse } from 'next/server'
import { sendDiscordMessage } from '@/lib/discord-bot'

export async function POST(req: NextRequest) {
  const { channel, message } = await req.json()
  if (!channel || !message) return NextResponse.json({ error: 'channel and message required' }, { status: 400 })
  const result = await sendDiscordMessage(String(channel), String(message))
  return NextResponse.json({ result })
}
