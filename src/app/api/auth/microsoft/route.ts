import { NextResponse } from 'next/server'
import { isConfigured, buildAuthUrl } from '@/lib/microsoft-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'Microsoft credentials not configured' }, { status: 400 })
  }
  return NextResponse.redirect(buildAuthUrl())
}
