import { NextRequest, NextResponse } from 'next/server'
import { loadCredentials, plaidBaseUrl, listItems } from '@/lib/plaid-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const creds = loadCredentials()
  if (!creds) return NextResponse.json({ error: 'Plaid not configured' }, { status: 401 })

  const days      = Math.min(Number(req.nextUrl.searchParams.get('days')) || 30, 90)
  const itemIdParam = req.nextUrl.searchParams.get('itemId')
  const items     = listItems().filter(i => !itemIdParam || i.itemId === itemIdParam)

  if (items.length === 0) return NextResponse.json({ transactions: [] })

  const startDate = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0]
  const endDate   = new Date().toISOString().split('T')[0]
  const base      = plaidBaseUrl(creds.env)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTransactions: any[] = []

  await Promise.all(items.map(async item => {
    const res = await fetch(`${base}/transactions/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    creds.clientId,
        secret:       creds.secret,
        access_token: item.accessToken,
        start_date:   startDate,
        end_date:     endDate,
        options:      { count: 100 },
      }),
    })
    if (!res.ok) return
    const data = await res.json()
    const accountMap = Object.fromEntries(item.accounts.map(a => [a.id, a]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const tx of (data.transactions ?? []) as any[]) {
      const acct = accountMap[tx.account_id]
      allTransactions.push({
        institution: item.institutionName,
        account:     acct ? `${acct.name} ****${acct.mask}` : tx.account_id,
        date:        tx.date,
        amount:      -tx.amount,  // Plaid: positive = debit; we invert so negative = debit
        name:        tx.name,
        merchantName: tx.merchant_name ?? null,
        category:    tx.category?.[0] ?? null,
        pending:     tx.pending,
      })
    }
  }))

  allTransactions.sort((a, b) => b.date.localeCompare(a.date))
  return NextResponse.json({ transactions: allTransactions })
}
