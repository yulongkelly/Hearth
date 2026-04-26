import { NextRequest } from 'next/server'
import { queryWiki } from '@/lib/knowledge/wiki'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const url  = new URL(req.url)
    const raw  = url.searchParams.get('tags') ?? ''
    const tags = raw.split(',').map(t => t.trim()).filter(Boolean)
    const pages = queryWiki(tags)
    return Response.json({ pages })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
