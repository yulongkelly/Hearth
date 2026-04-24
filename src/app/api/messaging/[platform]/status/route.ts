import { NextRequest } from 'next/server'
import { getAsync, isPlatform } from '@/lib/platform-registry'

export const dynamic = 'force-dynamic'

const TERMINAL = new Set(['connected', 'error'])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params
  if (!isPlatform(platform)) return new Response('Unknown platform', { status: 404 })
  const adapterOrUndef = await getAsync(platform)
  if (!adapterOrUndef) return new Response('Adapter not registered', { status: 404 })
  const adapter = adapterOrUndef

  const encoder = new TextEncoder()
  let timer: NodeJS.Timeout | undefined

  const stream = new ReadableStream({
    start(controller) {
      let lastSnapshot = ''

      function push() {
        const state = adapter.getState()
        const json = JSON.stringify(state)
        if (json !== lastSnapshot) {
          lastSnapshot = json
          controller.enqueue(encoder.encode(`data: ${json}\n\n`))
          if (TERMINAL.has(state.status)) {
            clearInterval(timer)
            try { controller.close() } catch {}
          }
        }
      }

      push()
      timer = setInterval(push, 300)

      request.signal.addEventListener('abort', () => {
        clearInterval(timer)
        try { controller.close() } catch {}
      })
    },
    cancel() {
      clearInterval(timer)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
