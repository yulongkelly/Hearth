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

  const { target, message } = await req.json().catch(() => ({})) as Record<string, unknown>
  if (!target || !message) return NextResponse.json({ error: 'target and message are required' }, { status: 400 })

  const result = await adapter.send(String(target), String(message))
  return NextResponse.json({ result })
}
