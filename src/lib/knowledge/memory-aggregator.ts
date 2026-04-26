import type { PreferenceSignal, KnowledgeCluster } from './types'

export const MIN_FREQUENCY  = 3
// Read at call time so tests that set HEARTH_TEST_MODE=1 before importing still work
// (ESM static imports are hoisted before module-level env assignments)
export function getMinSpanHours(): number {
  return process.env.HEARTH_TEST_MODE === '1' ? 0 : 24
}

export function computeConfidence(frequency: number): number {
  return frequency / (frequency + 2)
}

function isoWeek(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'unknown'
  // ISO week: Thursday of the week determines year
  const thu = new Date(d)
  thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3)
  const yearStart = new Date(thu.getFullYear(), 0, 1)
  const week = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`
}

function computeWeekCounts(signals: PreferenceSignal[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const s of signals) {
    const w = s.metadata?.week ?? isoWeek(s.timestamp)
    counts[w] = (counts[w] ?? 0) + 1
  }
  return counts
}

function computeTrajectory(weekCounts: Record<string, number>): 'improving' | 'declining' | 'stable' {
  const sorted = Object.keys(weekCounts).sort()
  if (sorted.length < 2) return 'stable'
  const recent = sorted.slice(-2).reduce((s, w) => s + weekCounts[w], 0)
  const prior  = sorted.slice(-4, -2).reduce((s, w) => s + weekCounts[w], 0)
  if (prior === 0) return 'stable'
  const ratio = recent / prior
  if (ratio > 1.5) return 'improving'
  if (ratio < 0.5) return 'declining'
  return 'stable'
}

function groupByPrimaryTag(signals: PreferenceSignal[]): Map<string, PreferenceSignal[]> {
  const groups = new Map<string, PreferenceSignal[]>()
  for (const signal of signals) {
    const key = (signal.tags[0] ?? signal.domain).toLowerCase().trim()
    const existing = groups.get(key)
    if (existing) {
      existing.push(signal)
    } else {
      groups.set(key, [signal])
    }
  }
  return groups
}

function groupByPerson(signals: PreferenceSignal[]): Map<string, PreferenceSignal[]> {
  const groups = new Map<string, PreferenceSignal[]>()
  for (const signal of signals) {
    const person = signal.metadata?.person
    if (!person) continue
    const key = person.toLowerCase().trim()
    const existing = groups.get(key)
    if (existing) {
      existing.push(signal)
    } else {
      groups.set(key, [signal])
    }
  }
  return groups
}

function meetsThreshold(cluster: KnowledgeCluster): boolean {
  return cluster.frequency >= MIN_FREQUENCY && cluster.spanHours >= getMinSpanHours()
}

function buildCluster(
  primaryTag: string,
  groupSignals: PreferenceSignal[],
  entityType?: KnowledgeCluster['entityType'],
  personName?: string,
): KnowledgeCluster | null {
  const timestamps = groupSignals.map(s => Date.parse(s.timestamp)).filter(t => !isNaN(t))
  if (timestamps.length === 0) return null

  const minTs = Math.min(...timestamps)
  const maxTs = Math.max(...timestamps)
  const spanHours = (maxTs - minTs) / 3_600_000

  const weekCounts = computeWeekCounts(groupSignals)
  const trajectory = computeTrajectory(weekCounts)

  return {
    primaryTag,
    signals:    groupSignals,
    frequency:  groupSignals.length,
    confidence: Math.round(computeConfidence(groupSignals.length) * 100) / 100,
    firstSeen:  new Date(minTs).toISOString(),
    lastSeen:   new Date(maxTs).toISOString(),
    spanHours,
    entityType,
    personName,
    weekCounts,
    trajectory,
  }
}

export function aggregateSignals(signals: PreferenceSignal[]): KnowledgeCluster[] {
  const clusters: KnowledgeCluster[] = []
  const usedIds  = new Set<string>()

  // Relationship signals: group by person name first
  const relationshipSignals = signals.filter(s => s.type === 'relationship')
  const personGroups = groupByPerson(relationshipSignals)
  for (const [personKey, personSignals] of personGroups) {
    const cluster = buildCluster(
      `person-${personKey.replace(/\s+/g, '-')}`,
      personSignals,
      'person',
      personSignals[0].metadata?.person ?? personKey,
    )
    if (cluster && meetsThreshold(cluster)) {
      clusters.push(cluster)
      for (const s of personSignals) usedIds.add(s.id)
    }
  }

  // All remaining signals: group by primary tag
  const remaining = signals.filter(s => !usedIds.has(s.id))
  const groups = groupByPrimaryTag(remaining)
  for (const [primaryTag, groupSignals] of groups) {
    // Determine entity type from signal types in group
    const types = new Set(groupSignals.map(s => s.type))
    let entityType: KnowledgeCluster['entityType'] | undefined
    if (types.has('goal'))    entityType = 'goal'
    else if (types.has('concern') || types.has('identity')) entityType = 'concern'
    else if (types.has('learning')) entityType = 'topic'

    const cluster = buildCluster(primaryTag, groupSignals, entityType)
    if (cluster && meetsThreshold(cluster)) {
      clusters.push(cluster)
    }
  }

  return clusters.sort((a, b) => b.confidence - a.confidence)
}
