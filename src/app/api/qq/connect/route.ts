import { NextResponse } from 'next/server'
import { startQqBot, getQqState, savedQqUin } from '@/lib/qq-bot'

export async function POST() {
  await startQqBot(savedQqUin() ?? undefined)
  return NextResponse.json(getQqState())
}
