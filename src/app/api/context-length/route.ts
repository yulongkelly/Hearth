import { NextRequest } from 'next/server'
import { getModelAdapter } from '@/lib/adapters/registry'

export async function GET(req: NextRequest) {
  const model = req.nextUrl.searchParams.get('model') ?? ''
  if (!model) {
    return Response.json({ contextLength: 4096 })
  }
  try {
    const adapter = getModelAdapter()
    const contextLength = (await adapter.getContextLength?.(model)) ?? 4096
    return Response.json({ contextLength })
  } catch {
    return Response.json({ contextLength: 4096 })
  }
}
