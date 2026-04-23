import { NextRequest, NextResponse } from 'next/server'
import { startBot, getBotState } from '@/lib/wechat-bot'
import type { PuppetType } from '@/lib/wechat-bot'

export async function POST(req: NextRequest) {
  let puppet: PuppetType = 'wechat4u'
  try { const body = await req.json(); if (body.puppet === 'xp') puppet = 'xp' } catch {}
  await startBot(puppet)
  return NextResponse.json(getBotState())
}
