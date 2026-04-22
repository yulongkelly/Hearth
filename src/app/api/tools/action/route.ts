import { NextRequest } from 'next/server'
import { executeAction } from '@/lib/workflow-actions'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { name, params, context, model } = await req.json()
    if (!name || typeof name !== 'string') {
      return Response.json({ error: 'name required' }, { status: 400 })
    }
    const result = await executeAction(name, params ?? {}, context ?? {}, model)
    return Response.json({ result })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'action failed' }, { status: 500 })
  }
}
