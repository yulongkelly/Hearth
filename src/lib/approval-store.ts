const TIMEOUT_MS = 5 * 60 * 1000

const g = global as typeof globalThis & { __approvalPending?: Map<string, (approved: boolean) => void> }
if (!g.__approvalPending) g.__approvalPending = new Map()
const pending = g.__approvalPending

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
