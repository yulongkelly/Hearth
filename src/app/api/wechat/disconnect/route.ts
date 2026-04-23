import { NextResponse } from 'next/server'
import { stopBot } from '@/lib/wechat-bot'

export async function POST() {
  await stopBot()
  return NextResponse.json({ ok: true })
}
