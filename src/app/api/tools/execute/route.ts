import { NextRequest } from 'next/server'
import { executeTool } from '@/lib/tools'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { name, params } = await req.json()
    if (!name || typeof name !== 'string') {
      return Response.json({ error: 'name required' }, { status: 400 })
    }
    const result = await executeTool(name, params ?? {})
    return Response.json({ result })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'execution failed' }, { status: 500 })
  }
}
