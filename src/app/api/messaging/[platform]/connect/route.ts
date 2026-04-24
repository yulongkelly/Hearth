import { NextRequest, NextResponse } from 'next/server'
import { getAsync, isPlatform } from '@/lib/platform-registry'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params
  if (!isPlatform(platform)) return NextResponse.json({ error: 'Unknown platform' }, { status: 404 })
  const adapter = await getAsync(platform)
  if (!adapter) return NextResponse.json({ error: 'Adapter not registered' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const opts = {
    token:  typeof body.token  === 'string' ? body.token  : undefined,
    secret: typeof body.secret === 'string' ? body.secret : undefined,
  }

  try {
    await adapter.connect(opts)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Connect failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
