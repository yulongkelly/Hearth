export type SignalType =
  | 'preference' | 'fact' | 'pattern'
  | 'relationship'
  | 'concern'
  | 'identity'
  | 'learning'
  | 'goal'
  | 'progress'

export interface PreferenceSignal {
  id:        string
  timestamp: string
  type:      SignalType
  domain:    string
  value:     string
  tags:      string[]
  sessionId: string
  metadata?: {
    person?:    string
    sentiment?: 'positive' | 'neutral' | 'negative'
    week?:      string
    declared?:  boolean
  }
}

export interface KnowledgeCluster {
  primaryTag:  string
  signals:     PreferenceSignal[]
  frequency:   number
  confidence:  number
  firstSeen:   string
  lastSeen:    string
  spanHours:   number
  entityType?: 'person' | 'goal' | 'concern' | 'topic'
  personName?: string
  weekCounts?: Record<string, number>
  trajectory?: 'improving' | 'declining' | 'stable'
}

export interface WikiFrontmatter {
  id:           string
  title:        string
  tags:         string[]
  confidence:   number
  frequency:    number
  last_updated: string
  source:       'inferred' | 'manual'
  entity_type?: 'person' | 'goal' | 'concern' | 'topic'
  trajectory?:  'improving' | 'declining' | 'stable'
  week_counts?: Record<string, number>
}

export interface WikiEvidence {
  date:    string
  quote:   string
  context: string
}

export interface WikiPage {
  frontmatter: WikiFrontmatter
  body:        string
  evidence:    WikiEvidence[]
  raw:         string
}

export type PolicyAction = 'write' | 'merge' | 'ignore'

export interface PolicyDecision {
  action:        PolicyAction
  cluster:       KnowledgeCluster
  existingPage?: WikiPage
  reason:        string
}
