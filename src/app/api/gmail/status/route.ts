import { NextResponse } from 'next/server'
import { isConfigured, loadTokens } from '@/lib/google-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    configured: isConfigured(),
    connected: !!loadTokens(),
  })
}
