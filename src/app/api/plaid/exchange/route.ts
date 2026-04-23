import { NextRequest, NextResponse } from 'next/server'
import { loadCredentials, plaidBaseUrl, addItem, type PlaidAccount } from '@/lib/plaid-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { publicToken, institutionName, accounts } = await req.json()
  if (!publicToken) return NextResponse.json({ error: 'publicToken required' }, { status: 400 })

  const creds = loadCredentials()
  if (!creds) return NextResponse.json({ error: 'Plaid not configured' }, { status: 401 })

  const res = await fetch(`${plaidBaseUrl(creds.env)}/item/public_token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: creds.clientId, secret: creds.secret, public_token: publicToken }),
  })

  const data = await res.json()
  if (!res.ok) return NextResponse.json({ error: data.error_message ?? 'Exchange failed' }, { status: res.status })

  addItem(data.item_id, data.access_token, institutionName ?? 'Unknown Bank', accounts ?? [] as PlaidAccount[])
  return NextResponse.json({ ok: true })
}
