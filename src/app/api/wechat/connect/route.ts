import { NextResponse } from 'next/server'
import { startBot, getBotState } from '@/lib/wechat-bot'

export async function POST() {
  await startBot()
  return NextResponse.json(getBotState())
}
