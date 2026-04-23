import { NextResponse } from 'next/server'
import { getTelegramState, loadTelegramToken } from '@/lib/telegram-bot'

export const dynamic = 'force-dynamic'

export async function GET() {
  const state = getTelegramState()
  return NextResponse.json({ ...state, hasToken: !!loadTelegramToken() })
}
