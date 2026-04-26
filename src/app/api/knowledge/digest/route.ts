import { NextRequest, NextResponse } from 'next/server'
import { getModelAdapter } from '@/lib/adapters/registry'
import { generateWeeklyDigest, writePendingDigest, readPendingDigest, clearPendingDigest } from '@/lib/knowledge/weekly-digest'

// POST /api/knowledge/digest — generate and store a new digest
export async function POST(req: NextRequest) {
  try {
    const body    = await req.json().catch(() => ({}))
    const model   = typeof body.model === 'string' ? body.model : ''
    if (!model) return NextResponse.json({ error: 'model is required' }, { status: 400 })

    const adapter = getModelAdapter()
    const digest  = await generateWeeklyDigest(adapter, model)
    writePendingDigest(digest)
    return NextResponse.json({ ok: true, digest })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'digest error' }, { status: 500 })
  }
}

// GET /api/knowledge/digest/pending — check for a pending digest
export async function GET() {
  const digest = readPendingDigest()
  if (!digest) return NextResponse.json({ pending: false })
  return NextResponse.json({ pending: true, digest })
}

// DELETE /api/knowledge/digest/pending — mark digest as read
export async function DELETE(_req: NextRequest) {
  clearPendingDigest()
  return NextResponse.json({ ok: true })
}
