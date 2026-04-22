import { NextRequest, NextResponse } from 'next/server'
import { setNickname, listAccounts } from '@/lib/google-auth'

export async function GET() {
  return NextResponse.json({ accounts: listAccounts() })
}

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  try {
    const { email, nickname } = await req.json()
    if (typeof email === 'string' && email) {
      setNickname(email, typeof nickname === 'string' ? nickname : '')
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }
}
