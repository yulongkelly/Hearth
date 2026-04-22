import { NextResponse } from 'next/server'
import { isConfigured, buildAuthUrl } from '@/lib/google-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'Google credentials not configured' }, { status: 400 })
  }
  return NextResponse.redirect(buildAuthUrl())
}
