import { NextRequest, NextResponse } from 'next/server'
import { getValidAccessTokenForAccount, listAccounts } from '@/lib/google-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const maxResults = req.nextUrl.searchParams.get('maxResults') ?? '20'
  const accountParam = req.nextUrl.searchParams.get('account')

  const allAccounts = listAccounts()
  if (allAccounts.length === 0) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const accounts = accountParam
    ? allAccounts.filter(a => a.email === accountParam || a.nickname === accountParam)
    : allAccounts

  if (accounts.length === 0) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const now = new Date().toISOString()

  const results = await Promise.all(accounts.map(async ({ email, nickname }) => {
    const label = nickname ?? email
    const token = await getValidAccessTokenForAccount(email)
    if (!token) return { email, label, events: [], error: 'auth failed' }

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    url.searchParams.set('timeMin', now)
    url.searchParams.set('maxResults', maxResults)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { email, label, events: [], error: `API error ${res.status}` }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { items = [] }: { items: any[] } = await res.json()
    const events = items.map(evt => ({
      id:          evt.id as string,
      summary:     (evt.summary ?? '(no title)') as string,
      start:       (evt.start?.dateTime ?? evt.start?.date ?? '') as string,
      end:         (evt.end?.dateTime   ?? evt.end?.date   ?? '') as string,
      description: evt.description ? String(evt.description).slice(0, 200) : undefined,
      location:    evt.location    ? String(evt.location).slice(0, 100)    : undefined,
      allDay:      !evt.start?.dateTime,
    }))

    return { email, label, events }
  }))

  return NextResponse.json({ accounts: results })
}
