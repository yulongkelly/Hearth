import { NextRequest, NextResponse } from 'next/server'
import { isConfigured, saveCredentials } from '@/lib/microsoft-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ configured: isConfigured() })
}

export async function POST(req: NextRequest) {
  const { clientId, clientSecret } = await req.json()
  if (!clientId?.trim() || !clientSecret?.trim()) {
    return NextResponse.json({ error: 'Both fields are required' }, { status: 400 })
  }
  if (clientId.length > 500 || clientSecret.length > 500) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 400 })
  }
  saveCredentials(clientId.trim(), clientSecret.trim())
  return NextResponse.json({ ok: true })
}
