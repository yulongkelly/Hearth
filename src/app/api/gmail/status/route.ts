import { NextResponse } from 'next/server'
import { isConfigured, listAccounts } from '@/lib/google-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const accounts = listAccounts()
  return NextResponse.json({
    configured: isConfigured(),
    connected: accounts.length > 0,
    accounts,
  })
}
