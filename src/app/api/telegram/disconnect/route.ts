import { NextResponse } from 'next/server'
import { stopTelegramBot } from '@/lib/telegram-bot'

export async function POST() {
  await stopTelegramBot()
  return NextResponse.json({ ok: true })
}
