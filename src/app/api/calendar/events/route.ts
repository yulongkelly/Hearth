import { NextRequest, NextResponse } from 'next/server'
import { getValidAccessToken } from '@/lib/google-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = await getValidAccessToken()
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const now = new Date().toISOString()
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
  url.searchParams.set('timeMin', now)
  url.searchParams.set('maxResults', req.nextUrl.searchParams.get('maxResults') ?? '10')
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Calendar API error' }, { status: res.status })
  }

  return NextResponse.json(await res.json())
}
