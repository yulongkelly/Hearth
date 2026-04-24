import { NextRequest, NextResponse } from 'next/server'
import { getAsync, isPlatform } from '@/lib/platform-registry'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params
  if (!isPlatform(platform)) return NextResponse.json({ error: 'Unknown platform' }, { status: 404 })
  const adapter = await getAsync(platform)
  if (!adapter) return NextResponse.json({ error: 'Adapter not registered' }, { status: 404 })

  const sp      = req.nextUrl.searchParams
  const contact = sp.get('contact') ?? undefined
  const channel = sp.get('channel') ?? undefined
  const days    = sp.get('days')    ? Number(sp.get('days'))  : undefined
  const limit   = sp.get('limit')   ? Number(sp.get('limit')) : undefined

  const messages = adapter.queryMessages({ contact, channel, days, limit })
  return NextResponse.json({ messages })
}
