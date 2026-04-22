import { NextRequest, NextResponse } from 'next/server'
import { getValidAccessToken } from '@/lib/google-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = await getValidAccessToken()
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const pageToken = req.nextUrl.searchParams.get('pageToken') ?? ''
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&labelIds=INBOX${pageToken ? `&pageToken=${pageToken}` : ''}`

  const listRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!listRes.ok) {
    return NextResponse.json({ error: 'Gmail API error' }, { status: listRes.status })
  }

  const { messages = [], nextPageToken } = await listRes.json()

  const details = await Promise.all(
    (messages as { id: string }[]).map(m =>
      fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      ).then(r => r.json())
    )
  )

  return NextResponse.json({ messages: details, nextPageToken: nextPageToken ?? null })
}
