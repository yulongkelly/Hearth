import { NextRequest, NextResponse } from 'next/server'
import { getAsync, isPlatform } from '@/lib/platform-registry'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params
  if (!isPlatform(platform)) return NextResponse.json({ error: 'Unknown platform' }, { status: 404 })
  const adapter = await getAsync(platform)
  if (!adapter) return NextResponse.json({ error: 'Adapter not registered' }, { status: 404 })

  await adapter.disconnect()
  return NextResponse.json({ ok: true })
}
