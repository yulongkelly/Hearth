import { NextRequest, NextResponse } from 'next/server'
import { setNickname, removeAccount, listAccounts } from '@/lib/microsoft-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ accounts: listAccounts() })
}

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

export async function POST(req: NextRequest) {
  try {
    const { action, email } = await req.json()
    if (action === 'disconnect' && typeof email === 'string' && email) {
      removeAccount(email)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }
}
