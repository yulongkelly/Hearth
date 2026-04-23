import { NextRequest, NextResponse } from 'next/server'
import { sendTelegramMessage } from '@/lib/telegram-bot'

export async function POST(req: NextRequest) {
  const { target, message } = await req.json()
  if (!target || !message) return NextResponse.json({ error: 'target and message required' }, { status: 400 })
  const result = await sendTelegramMessage(String(target), String(message))
  return NextResponse.json({ result })
}
