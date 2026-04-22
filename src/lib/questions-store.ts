const TIMEOUT_MS = 10 * 60 * 1000

const g = global as typeof globalThis & { __questionsPending?: Map<string, (answers: string[]) => void> }
if (!g.__questionsPending) g.__questionsPending = new Map()
const pending = g.__questionsPending

export function waitForAnswers(id: string): Promise<string[]> {
  return new Promise(resolve => {
    pending.set(id, resolve)
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve([])
      }
    }, TIMEOUT_MS)
  })
}

export function resolveAnswers(id: string, answers: string[]): boolean {
  const resolve = pending.get(id)
  if (!resolve) return false
  pending.delete(id)
  resolve(answers)
  return true
}
