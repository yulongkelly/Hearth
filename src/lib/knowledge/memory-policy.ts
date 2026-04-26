import type { KnowledgeCluster, WikiPage, PolicyDecision } from './types'
import type { ModelAdapter } from '@/lib/model-adapter'
import { listWikiPages, writeWikiPage, serializeFrontmatter, serializeEvidence, toSlug } from './wiki'
import { INJECTION_PATTERNS, INVISIBLE_UNICODE } from '@/lib/security-runtime'

export function scanWikiContent(content: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) return `Blocked: content matches injection pattern`
  }
  if (new RegExp(INVISIBLE_UNICODE.source).test(content)) return `Blocked: invisible unicode detected`
  return null
}

export function evaluateCluster(cluster: KnowledgeCluster): PolicyDecision {
  if (cluster.confidence < 0.1) {
    return { action: 'ignore', cluster, reason: 'confidence too low' }
  }

  const pages = listWikiPages()

  // Person entities: match by entity_type + personName
  if (cluster.entityType === 'person' && cluster.personName) {
    const slug = toSlug(`person-${cluster.personName}`)
    const match = pages.find(p => p.frontmatter.id === slug)
    if (match) {
      return { action: 'merge', cluster, existingPage: match, reason: `existing person page: ${slug}` }
    }
    return { action: 'write', cluster, reason: 'new person' }
  }

  // Goal entities: match by entity_type=goal tag
  if (cluster.entityType === 'goal') {
    const match = pages.find(p =>
      p.frontmatter.entity_type === 'goal' &&
      p.frontmatter.tags.some(t => t.toLowerCase() === cluster.primaryTag.toLowerCase())
    )
    if (match) {
      return { action: 'merge', cluster, existingPage: match, reason: `existing goal page: ${match.frontmatter.id}` }
    }
    return { action: 'write', cluster, reason: 'new goal' }
  }

  // Default: match by primary tag
  const match = pages.find(page =>
    page.frontmatter.tags.some(t => t.toLowerCase() === cluster.primaryTag.toLowerCase())
  )
  if (match) {
    return { action: 'merge', cluster, existingPage: match, reason: `existing page: ${match.frontmatter.id}` }
  }

  return { action: 'write', cluster, reason: 'no existing page for this tag' }
}

function synthPromptForCluster(cluster: KnowledgeCluster, signalList: string): string {
  if (cluster.entityType === 'person') {
    return `Summarize what is known about this person from the user's interactions. Write 2-3 declarative sentences covering: their likely role or context (colleague, friend, etc.), interaction pattern (frequency, topics), and recent activity. Do NOT start with "The user". Be direct. Output ONLY the summary.\n\nSignals:\n${signalList}`
  }
  if (cluster.entityType === 'goal') {
    return `Summarize this user goal or learning intent. Write 2-3 declarative sentences: what the goal is, current progress if evident, and any declared timeline. Do NOT start with "The user". Be direct. Output ONLY the summary.\n\nSignals:\n${signalList}`
  }
  if (cluster.entityType === 'concern') {
    return `Summarize this recurring concern or value. Write 2-3 declarative sentences. Be empathetic and factual. Do NOT start with "The user". Output ONLY the summary.\n\nSignals:\n${signalList}`
  }
  return `Summarize this user preference pattern. Write 2-3 declarative sentences. Do NOT start with "The user". Be direct and factual. Output ONLY the summary.\n\nSignals:\n${signalList}`
}

export async function synthesizeCluster(
  cluster:  KnowledgeCluster,
  adapter:  ModelAdapter,
  model:    string,
): Promise<string> {
  const signalList = cluster.signals
    .slice(-8)
    .map(s => `- "${s.value}" (${s.domain})`)
    .join('\n')

  try {
    const result = await adapter.chat({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are summarizing user signals for a personal AI assistant. ' + synthPromptForCluster(cluster, signalList),
        },
        {
          role: 'user',
          content: `Observations (${cluster.frequency} total):\n${signalList}`,
        },
      ],
      signal: AbortSignal.timeout(15_000),
    })
    const text = result.content.trim()
    return text || cluster.signals[0]?.value || cluster.primaryTag
  } catch {
    return cluster.signals[0]?.value || cluster.primaryTag
  }
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')
}

function uniqueSecondaryTags(cluster: KnowledgeCluster): string[] {
  const seen = new Set<string>([cluster.primaryTag])
  const extras: string[] = []
  for (const sig of cluster.signals) {
    for (const tag of sig.tags.slice(1)) {
      const lower = tag.toLowerCase()
      if (!seen.has(lower)) {
        seen.add(lower)
        extras.push(lower)
      }
    }
  }
  return extras.slice(0, 4)
}

export function buildWikiPage(cluster: KnowledgeCluster, synthesis: string): WikiPage {
  let id: string
  let title: string

  if (cluster.entityType === 'person' && cluster.personName) {
    id    = toSlug(`person-${cluster.personName}`)
    title = cluster.personName
  } else if (cluster.entityType === 'goal') {
    id    = toSlug(`goal-${cluster.primaryTag}`)
    title = titleCase(cluster.primaryTag)
  } else {
    id    = toSlug(cluster.signals[0]?.domain ?? cluster.primaryTag) + '-' + toSlug(cluster.primaryTag)
    title = titleCase(cluster.primaryTag)
  }

  const tags = [cluster.primaryTag, ...uniqueSecondaryTags(cluster)]
  const fm = {
    id,
    title,
    tags,
    confidence:   Math.round(cluster.confidence * 100) / 100,
    frequency:    cluster.frequency,
    last_updated: new Date().toISOString().slice(0, 10),
    source:       'inferred' as const,
    ...(cluster.entityType  ? { entity_type: cluster.entityType }   : {}),
    ...(cluster.trajectory  ? { trajectory:  cluster.trajectory }   : {}),
    ...(cluster.weekCounts  ? { week_counts: cluster.weekCounts }    : {}),
  }
  const evidence = cluster.signals.slice(-5).map(s => ({
    date:    s.timestamp.slice(0, 10),
    quote:   s.value.slice(0, 80),
    context: s.domain,
  }))
  const body = synthesis
  const evidenceSection = serializeEvidence(evidence)
  const raw = serializeFrontmatter(fm) + '\n\n' + body + (evidenceSection ? '\n\n' + evidenceSection : '') + '\n'
  return { frontmatter: fm, body, evidence, raw }
}

export function mergeIntoPage(existing: WikiPage, cluster: KnowledgeCluster, synthesis: string): WikiPage {
  const newEvidence = cluster.signals.slice(-5).map(s => ({
    date:    s.timestamp.slice(0, 10),
    quote:   s.value.slice(0, 80),
    context: s.domain,
  }))
  const merged = [...existing.evidence, ...newEvidence]
    .filter((e, i, arr) => arr.findIndex(x => x.date === e.date && x.quote === e.quote) === i)
    .slice(-10)

  const newFrequency  = existing.frontmatter.frequency + cluster.frequency
  const newConfidence = Math.round((newFrequency / (newFrequency + 2)) * 100) / 100

  // Merge week_counts
  const existingWC = existing.frontmatter.week_counts ?? {}
  const newWC      = cluster.weekCounts ?? {}
  const mergedWC: Record<string, number> = { ...existingWC }
  for (const [w, c] of Object.entries(newWC)) {
    mergedWC[w] = (mergedWC[w] ?? 0) + c
  }

  const fm = {
    ...existing.frontmatter,
    confidence:   newConfidence,
    frequency:    newFrequency,
    last_updated: new Date().toISOString().slice(0, 10),
    week_counts:  mergedWC,
    ...(cluster.trajectory ? { trajectory: cluster.trajectory } : {}),
  }

  const body = synthesis || existing.body
  const evidenceSection = serializeEvidence(merged)
  const raw = serializeFrontmatter(fm) + '\n\n' + body + (evidenceSection ? '\n\n' + evidenceSection : '') + '\n'
  return { frontmatter: fm, body, evidence: merged, raw }
}

export function executeDecision(decision: PolicyDecision, synthesis: string): boolean {
  if (decision.action === 'ignore') return true

  const page = decision.action === 'write'
    ? buildWikiPage(decision.cluster, synthesis)
    : mergeIntoPage(decision.existingPage!, decision.cluster, synthesis)

  const scanError = scanWikiContent(page.raw)
  if (scanError) return false

  return writeWikiPage(page)
}
