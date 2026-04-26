import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ModelAdapter } from '@/lib/model-adapter'
import { readSignalsSince } from './signal-store'
import { queryWikiAll } from './wiki'
import { getLocaleForSession } from './locale'

const HEARTH_DIR   = path.join(os.homedir(), '.hearth')
const MEMORY_DIR   = path.join(HEARTH_DIR, 'memory')
const PENDING_FILE = path.join(MEMORY_DIR, 'digest-pending.md')

function ensureDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true, mode: 0o700 })
  }
}

function weekLabel(): string {
  const now  = new Date()
  const mon  = new Date(now)
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const sun  = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(mon)}–${fmt(sun)}`
}

export async function generateWeeklyDigest(
  adapter: ModelAdapter,
  model:   string,
): Promise<string> {
  const since7d   = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const signals   = readSignalsSince(since7d)
  const wikiPages = queryWikiAll()

  // Build a compact context for the LLM
  const signalSummary = (() => {
    const byType: Record<string, number> = {}
    for (const s of signals) byType[s.type] = (byType[s.type] ?? 0) + 1
    return Object.entries(byType).map(([t, c]) => `${t}: ${c}`).join(', ')
  })()

  const personPages = wikiPages.filter(p => p.frontmatter.entity_type === 'person')
  const goalPages   = wikiPages.filter(p => p.frontmatter.entity_type === 'goal')
  const otherPages  = wikiPages.filter(p => !p.frontmatter.entity_type || p.frontmatter.entity_type === 'concern' || p.frontmatter.entity_type === 'topic')

  const personContext = personPages.map(p => {
    const wc = p.frontmatter.week_counts ?? {}
    const sorted = Object.keys(wc).sort()
    const thisWeek = sorted.slice(-1)[0] ? wc[sorted.slice(-1)[0]] : 0
    const prevWeek = sorted.slice(-2, -1)[0] ? wc[sorted.slice(-2, -1)[0]] : 0
    const trend = thisWeek > prevWeek ? `↑${thisWeek} this week` : thisWeek > 0 ? `${thisWeek} this week` : 'no activity this week'
    return `${p.frontmatter.title}: ${trend} — ${p.body.slice(0, 120)}`
  }).join('\n')

  const goalContext = goalPages.map(p =>
    `${p.frontmatter.title} (${p.frontmatter.trajectory ?? 'stable'}): ${p.body.slice(0, 120)}`
  ).join('\n')

  const concernContext = otherPages
    .filter(p => signals.some(s => (s.type === 'concern' || s.type === 'identity') && s.tags.some(t => p.frontmatter.tags.includes(t))))
    .map(p => `${p.frontmatter.title}: ${p.body.slice(0, 100)}`)
    .join('\n')

  const promptContext = [
    signalSummary ? `Signals this week: ${signalSummary}` : '',
    personContext  ? `People:\n${personContext}` : '',
    goalContext    ? `Goals:\n${goalContext}` : '',
    concernContext ? `Themes:\n${concernContext}` : '',
  ].filter(Boolean).join('\n\n')

  const label = weekLabel()

  const sampleText = wikiPages[0]?.body ?? ''
  const locale = getLocaleForSession(sampleText)
  const localeSuffix = locale.digestPromptSuffix ? `\n${locale.digestPromptSuffix}` : ''

  const systemPrompt = `You are generating a weekly digest for a personal AI assistant.
Write a concise, warm, observational digest. Do NOT be prescriptive or preachy.
Use this exact format (omit sections if no data):

─── Weekly Digest · ${label} ──────────────────────────

Relationships
  <Name>  <trend emoji> <N> interactions this week (<brief topic>)
  ...

You seem to be thinking about
  <Theme> (<how many times mentioned>)
  ...

Progress this week
  ✓ <completed item>
  → <in-progress item>
  ...

Suggestion
  <One actionable, specific observation — not generic advice>

Keep it under 25 lines total. Only include sections with real data.${localeSuffix}`

  try {
    const result = await adapter.chat({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: promptContext || 'No signals this week.' },
      ],
      signal: AbortSignal.timeout(30_000),
    })
    return result.content.trim()
  } catch {
    return `─── Weekly Digest · ${label} ──────────────────────────\n\nNot enough data yet — keep chatting and I'll have more to share next week.`
  }
}

export function writePendingDigest(content: string): void {
  ensureDir()
  fs.writeFileSync(PENDING_FILE, content, { encoding: 'utf-8', mode: 0o600 })
}

export function readPendingDigest(): string | null {
  try {
    return fs.readFileSync(PENDING_FILE, 'utf-8')
  } catch { return null }
}

export function clearPendingDigest(): void {
  try { fs.unlinkSync(PENDING_FILE) } catch {}
}
