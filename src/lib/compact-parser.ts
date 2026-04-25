import { validateMemoryEntry } from './memory-validator'

export interface CompactResult {
  summary: string
  facts: string[]
}

export function parseCompactResponse(text: string): CompactResult {
  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?=FACTS:|$)/i)
  const factsMatch   = text.match(/FACTS:\s*([\s\S]*?)$/i)

  const summary = summaryMatch?.[1]?.trim() ?? text.trim()
  const facts: string[] = []

  if (factsMatch?.[1]) {
    for (const line of factsMatch[1].split('\n')) {
      const fact = line.replace(/^[\s\-•*]+/, '').trim()
      if (fact.length > 0 && fact.length <= 280 && validateMemoryEntry(fact).valid) {
        facts.push(fact)
      }
    }
  }

  return { summary, facts: facts.slice(0, 5) }
}
