import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, addAccount } from '@/lib/microsoft-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(new URL('/integrations?error=access_denied', req.url))
  }

  const res = await exchangeCode(code)
  if (!res.ok) {
    return NextResponse.redirect(new URL('/integrations?error=token_exchange_failed', req.url))
  }

  const data = await res.json()

  let email = 'unknown@microsoft.com'
  try {
    const profileRes = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    )
    if (profileRes.ok) {
      const profile = await profileRes.json()
      email = profile.mail || profile.userPrincipalName || email
    }
  } catch {}

  addAccount(email, {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    Date.now() + data.expires_in * 1000,
  })

  return NextResponse.redirect(new URL('/integrations', req.url))
}
