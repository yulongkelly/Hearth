import { NextRequest, NextResponse } from 'next/server'
import { resolveAnswers } from '@/lib/questions-store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { id, answers } = await req.json()
  if (!id || !Array.isArray(answers)) {
    return NextResponse.json({ error: 'id and answers array are required' }, { status: 400 })
  }
  const found = resolveAnswers(id, answers)
  if (!found) {
    return NextResponse.json({ error: 'No pending question with that id' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
