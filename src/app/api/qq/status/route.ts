import { NextResponse } from 'next/server'
import { getQqState } from '@/lib/qq-bot'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(getQqState())
}
