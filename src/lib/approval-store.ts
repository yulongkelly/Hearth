const TIMEOUT_MS = 5 * 60 * 1000

const pending = new Map<string, (approved: boolean) => void>()

export function waitForApproval(id: string): Promise<boolean> {
  return new Promise(resolve => {
    pending.set(id, resolve)
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve(false)
      }
    }, TIMEOUT_MS)
  })
}

export function resolveApproval(id: string, approved: boolean): boolean {
  const resolve = pending.get(id)
  if (!resolve) return false
  pending.delete(id)
  resolve(approved)
  return true
}
