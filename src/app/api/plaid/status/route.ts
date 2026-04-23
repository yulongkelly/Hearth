import { NextResponse } from 'next/server'
import { isConfigured, loadCredentials, listItems } from '@/lib/plaid-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const items = listItems().map(({ itemId, institutionName, accounts }) => ({
    itemId, institutionName, accounts,
  }))
  return NextResponse.json({
    configured: isConfigured(),
    env:        loadCredentials()?.env ?? null,
    items,
  })
}
