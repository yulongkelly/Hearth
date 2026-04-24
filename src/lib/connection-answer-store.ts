const TIMEOUT_MS = 10 * 60 * 1000

export interface ConnectionResult {
  ok: boolean
  connectionId?: string
  error?: string
}

const g = global as typeof globalThis & { __connectionsPending?: Map<string, (r: ConnectionResult) => void> }
if (!g.__connectionsPending) g.__connectionsPending = new Map()
const pending = g.__connectionsPending

export function waitForConnection(id: string): Promise<ConnectionResult> {
  return new Promise(resolve => {
    pending.set(id, resolve)
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve({ ok: false, error: 'Timed out waiting for user' })
      }
    }, TIMEOUT_MS)
  })
}

export function resolveConnection(id: string, result: ConnectionResult): boolean {
  const resolve = pending.get(id)
  if (!resolve) return false
  pending.delete(id)
  resolve(result)
  return true
}
