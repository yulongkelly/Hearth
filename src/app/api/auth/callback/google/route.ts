import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, addAccount } from '@/lib/google-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(new URL('/integrations?error=access_denied', req.url))
  }

  const res = await exchangeCode(code)
  if (!res.ok) {
    return NextResponse.redirect(new URL('/integrations?error=token_exchange_failed', req.url))
  }

  const data = await res.json()

  // Fetch the account email using the Gmail profile endpoint (covered by gmail.readonly scope)
  let email = 'unknown@google.com'
  try {
    const profileRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    )
    if (profileRes.ok) {
      const profile = await profileRes.json()
      if (profile.emailAddress) email = profile.emailAddress
    }
  } catch {}

  addAccount(email, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  })

  return NextResponse.redirect(new URL('/integrations', req.url))
}
