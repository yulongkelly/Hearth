import { NextRequest } from 'next/server'
import { listWikiPages, writeWikiPage, toSlug, serializeFrontmatter, serializeEvidence } from '@/lib/knowledge/wiki'
import type { WikiPage } from '@/lib/knowledge/types'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    const pages = listWikiPages()
    return Response.json({ pages })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json()
    const { title, tags, body: pageBody, source = 'manual' } = body as {
      title:   string
      tags:    string[]
      body:    string
      source?: 'inferred' | 'manual'
    }

    if (!title || !Array.isArray(tags) || typeof pageBody !== 'string') {
      return Response.json({ error: 'title, tags (array), and body are required' }, { status: 400 })
    }

    const id = toSlug(title)
    const fm = {
      id,
      title,
      tags,
      confidence:   1,
      frequency:    1,
      last_updated: new Date().toISOString().slice(0, 10),
      source,
    }
    const evidence: WikiPage['evidence'] = []
    const raw = serializeFrontmatter(fm) + '\n\n' + pageBody + '\n'
    const page: WikiPage = { frontmatter: fm, body: pageBody, evidence, raw }

    const ok = writeWikiPage(page)
    if (!ok) return Response.json({ error: 'Write failed' }, { status: 500 })

    return Response.json({ page }, { status: 201 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
