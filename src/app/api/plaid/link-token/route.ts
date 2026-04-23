import { NextResponse } from 'next/server'
import { loadCredentials, plaidBaseUrl } from '@/lib/plaid-auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const creds = loadCredentials()
  if (!creds) return NextResponse.json({ error: 'Plaid not configured' }, { status: 401 })

  const res = await fetch(`${plaidBaseUrl(creds.env)}/link/token/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:    creds.clientId,
      secret:       creds.secret,
      user:         { client_user_id: 'hearth-user' },
      client_name:  'Hearth',
      products:     ['transactions'],
      country_codes: ['US', 'CA', 'GB', 'AU'],
      language:     'en',
    }),
  })

  const data = await res.json()
  if (!res.ok) return NextResponse.json({ error: data.error_message ?? 'Failed to create link token' }, { status: res.status })
  return NextResponse.json({ link_token: data.link_token })
}
