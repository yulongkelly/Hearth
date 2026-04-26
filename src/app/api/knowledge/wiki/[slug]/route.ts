import { NextRequest } from 'next/server'
import { readWikiPage, writeWikiPage, deleteWikiPage, parseFrontmatter, parseEvidence } from '@/lib/knowledge/wiki'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: NextRequest, { params }: Params): Promise<Response> {
  const { slug } = await params
  const page = readWikiPage(slug)
  if (!page) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ page })
}

export async function PUT(req: NextRequest, { params }: Params): Promise<Response> {
  try {
    const { slug } = await params
    const requestBody = await req.json()
    const { raw } = requestBody as { raw: string }

    if (typeof raw !== 'string') {
      return Response.json({ error: 'raw (string) is required' }, { status: 400 })
    }

    const frontmatter = parseFrontmatter(raw)
    if (!frontmatter) {
      return Response.json({ error: 'Invalid frontmatter — check --- delimiters and required fields (id, title)' }, { status: 400 })
    }

    if (frontmatter.id !== slug) {
      frontmatter.id = slug
    }

    const parts     = raw.split(/^---\s*$/m)
    const bodyRaw   = parts.slice(2).join('---').trim()
    const pageBody  = bodyRaw.split('## Evidence')[0].trim()
    const evidence  = parseEvidence(bodyRaw)

    const page = { frontmatter, body: pageBody, evidence, raw }
    const ok   = writeWikiPage(page)
    if (!ok) return Response.json({ error: 'Write failed' }, { status: 500 })

    return Response.json({ page })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params): Promise<Response> {
  const { slug } = await params
  const deleted = deleteWikiPage(slug)
  if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 })
  return new Response(null, { status: 204 })
}
