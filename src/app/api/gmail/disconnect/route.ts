import { NextRequest, NextResponse } from 'next/server'
import { removeAccount } from '@/lib/google-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (typeof email === 'string' && email) {
      removeAccount(email)
    }
  } catch {}
  return NextResponse.json({ ok: true })
}
