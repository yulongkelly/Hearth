import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { addConnection } from '@/lib/custom-connection-store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { service, credentials, testUrl, testMethod = 'GET', testHeaders } = body as {
    service: string
    credentials: Record<string, string>
    testUrl?: string
    testMethod?: string
    testHeaders?: Record<string, string>
  }

  if (!service || !credentials) {
    return Response.json({ error: 'service and credentials are required' }, { status: 400 })
  }

  // Build auth header template from testHeaders (first Authorization entry found)
  let authTemplate: string | undefined
  if (testHeaders) {
    const authEntry = Object.entries(testHeaders).find(([k]) => k.toLowerCase() === 'authorization')
    if (authEntry) authTemplate = authEntry[1]
  }

  // Verify connection if a test URL was provided
  if (testUrl) {
    try {
      const headers: Record<string, string> = {}
      if (testHeaders) {
        for (const [k, v] of Object.entries(testHeaders)) {
          headers[k] = v.replace(/\{(\w+)\}/g, (_, field) => String(credentials[field] ?? ''))
        }
      }
      const res = await fetch(testUrl, { method: testMethod, headers })
      if (!res.ok) {
        return Response.json({
          ok: false,
          error: `Connection test failed: ${res.status} ${res.statusText}. Check your credentials and try again.`,
        })
      }
    } catch (err) {
      return Response.json({
        ok: false,
        error: `Could not reach ${testUrl}: ${err instanceof Error ? err.message : 'network error'}`,
      })
    }
  }

  const id = crypto.randomUUID()
  addConnection({ id, service, credentials, authTemplate, testUrl, testMethod, verifiedAt: new Date().toISOString() })
  return Response.json({ ok: true, id })
}
