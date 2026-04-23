import { NextResponse } from 'next/server'
import { stopQqBot } from '@/lib/qq-bot'

export async function POST() {
  await stopQqBot()
  return NextResponse.json({ ok: true })
}
