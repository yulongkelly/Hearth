import { NextRequest, NextResponse } from 'next/server'
import { getAsync } from '@/lib/platform-registry'
import { PLATFORMS } from '@/lib/platform-adapter'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get('since')
  if (!since) return NextResponse.json({ error: 'since param required' }, { status: 400 })

  // Resolve all adapters (triggers lazy registration if needed)
  const adapters = await Promise.all(PLATFORMS.map(p => getAsync(p)))
  const connected = adapters.filter(a => a?.getState().status === 'connected')

  const results: Array<{ platform: string; from: string; room: string | null; text: string; timestamp: string }> = []

  for (const adapter of connected) {
    if (!adapter) continue
    // Fetch at most the last day's messages; filter to those strictly after `since`
    const msgs = adapter.queryMessages({ days: 1, limit: 200 })
    for (const m of msgs) {
      if (m.timestamp > since) results.push(m)
    }
  }

  results.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return NextResponse.json({ messages: results })
}
