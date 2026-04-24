import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.text()
  return fetch(new URL('/api/chat', req.url), {
    method:  'POST',
    headers: req.headers,
    body,
  })
}
