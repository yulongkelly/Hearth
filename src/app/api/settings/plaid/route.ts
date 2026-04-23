import { NextRequest, NextResponse } from 'next/server'
import { isConfigured, loadCredentials, saveCredentials, type PlaidEnv } from '@/lib/plaid-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const creds = loadCredentials()
  return NextResponse.json({ configured: isConfigured(), env: creds?.env ?? null })
}

export async function POST(req: NextRequest) {
  const { clientId, secret, env } = await req.json()
  if (!clientId || !secret || !env) {
    return NextResponse.json({ error: 'clientId, secret, and env are required' }, { status: 400 })
  }
  if (!['sandbox', 'development', 'production'].includes(env)) {
    return NextResponse.json({ error: 'env must be sandbox, development, or production' }, { status: 400 })
  }
  saveCredentials(String(clientId), String(secret), env as PlaidEnv)
  return NextResponse.json({ ok: true })
}
