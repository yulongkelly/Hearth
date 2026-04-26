import fs from 'fs'
import os from 'os'
import path from 'path'
import type { WikiPage, WikiFrontmatter, WikiEvidence } from './types'

const HEARTH_DIR  = path.join(os.homedir(), '.hearth')
const MEMORY_DIR  = path.join(HEARTH_DIR, 'memory')
const WIKI_DIR    = process.env.HEARTH_WIKI_DIR_OVERRIDE ?? path.join(MEMORY_DIR, 'wiki')
const INDEX_FILE  = path.join(WIKI_DIR, 'index.md')

const TOOL_TAG_MAP: Record<string, string> = {
  gmail:    'email',
  email:    'email',
  calendar: 'calendar',
  http:     'web',
}

function ensureWikiDir(): void {
  if (!fs.existsSync(WIKI_DIR)) {
    fs.mkdirSync(WIKI_DIR, { recursive: true, mode: 0o700 })
  }
}

export function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[/\\]/g, '-')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
}

export function parseFrontmatter(raw: string): WikiFrontmatter | null {
  try {
    const parts = raw.split(/^---\s*$/m)
    if (parts.length < 3) return null
    const block = parts[1]
    const fm: Partial<WikiFrontmatter> = {}
    for (const line of block.split('\n')) {
      const sep = line.indexOf(':')
      if (sep < 0) continue
      const key = line.slice(0, sep).trim()
      const val = line.slice(sep + 1).trim()
      switch (key) {
        case 'id':           fm.id           = val; break
        case 'title':        fm.title        = val; break
        case 'last_updated': fm.last_updated = val; break
        case 'source':       fm.source       = val as 'inferred' | 'manual'; break
        case 'confidence':   fm.confidence   = parseFloat(val); break
        case 'frequency':    fm.frequency    = parseInt(val, 10); break
        case 'entity_type':  fm.entity_type  = val as WikiFrontmatter['entity_type']; break
        case 'trajectory':   fm.trajectory   = val as WikiFrontmatter['trajectory']; break
        case 'tags': {
          const match = val.match(/^\[(.+)\]$/)
          fm.tags = match ? match[1].split(',').map(t => t.trim()).filter(Boolean) : []
          break
        }
        case 'week_counts': {
          // Stored as inline JSON: week_counts: {"2026-W17":5}
          try { fm.week_counts = JSON.parse(val) } catch {}
          break
        }
      }
    }
    if (!fm.id || !fm.title) return null
    return {
      id:           fm.id,
      title:        fm.title,
      tags:         fm.tags         ?? [],
      confidence:   fm.confidence   ?? 0,
      frequency:    fm.frequency    ?? 0,
      last_updated: fm.last_updated ?? new Date().toISOString().slice(0, 10),
      source:       fm.source       ?? 'inferred',
      ...(fm.entity_type ? { entity_type: fm.entity_type } : {}),
      ...(fm.trajectory  ? { trajectory:  fm.trajectory }  : {}),
      ...(fm.week_counts ? { week_counts: fm.week_counts }  : {}),
    }
  } catch { return null }
}

export function serializeFrontmatter(fm: WikiFrontmatter): string {
  const tags = `[${fm.tags.join(', ')}]`
  const lines = [
    '---',
    `id: ${fm.id}`,
    `title: ${fm.title}`,
    `tags: ${tags}`,
    `confidence: ${fm.confidence}`,
    `frequency: ${fm.frequency}`,
    `last_updated: ${fm.last_updated}`,
    `source: ${fm.source}`,
  ]
  if (fm.entity_type) lines.push(`entity_type: ${fm.entity_type}`)
  if (fm.trajectory)  lines.push(`trajectory: ${fm.trajectory}`)
  if (fm.week_counts && Object.keys(fm.week_counts).length > 0) {
    lines.push(`week_counts: ${JSON.stringify(fm.week_counts)}`)
  }
  lines.push('---')
  return lines.join('\n')
}

export function parseEvidence(body: string): WikiEvidence[] {
  const re = /^- (\d{4}-\d{2}-\d{2}): "(.+?)" \((.+?)\)$/gm
  const evidence: WikiEvidence[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    evidence.push({ date: m[1], quote: m[2], context: m[3] })
  }
  return evidence
}

export function serializeEvidence(evidence: WikiEvidence[]): string {
  if (evidence.length === 0) return ''
  const lines = evidence.map(e => `- ${e.date}: "${e.quote}" (${e.context})`)
  return '## Evidence\n' + lines.join('\n')
}

export function readWikiPage(slug: string): WikiPage | null {
  try {
    const filePath = path.join(WIKI_DIR, `${slug}.md`)
    const raw = fs.readFileSync(filePath, 'utf-8')
    const frontmatter = parseFrontmatter(raw)
    if (!frontmatter) return null
    const parts = raw.split(/^---\s*$/m)
    const bodyRaw = parts.slice(2).join('---').trim()
    const evidenceSection = bodyRaw.includes('## Evidence') ? bodyRaw.split('## Evidence')[1] : ''
    const body = bodyRaw.split('## Evidence')[0].trim()
    const evidence = parseEvidence('## Evidence' + evidenceSection)
    return { frontmatter, body, evidence, raw }
  } catch { return null }
}

export function writeWikiPage(page: WikiPage): boolean {
  try {
    ensureWikiDir()
    const filePath = path.join(WIKI_DIR, `${page.frontmatter.id}.md`)
    const tmp = filePath + '.tmp'
    fs.writeFileSync(tmp, page.raw, { encoding: 'utf-8', mode: 0o600 })
    fs.renameSync(tmp, filePath)
    rebuildIndex()
    return true
  } catch { return false }
}

export function deleteWikiPage(slug: string): boolean {
  try {
    const filePath = path.join(WIKI_DIR, `${slug}.md`)
    if (!fs.existsSync(filePath)) return false
    fs.unlinkSync(filePath)
    rebuildIndex()
    return true
  } catch { return false }
}

export function listWikiPages(): WikiPage[] {
  try {
    ensureWikiDir()
    return fs.readdirSync(WIKI_DIR)
      .filter(f => f.endsWith('.md') && f !== 'index.md')
      .map(f => readWikiPage(f.slice(0, -3)))
      .filter((p): p is WikiPage => p !== null)
  } catch { return [] }
}

export function queryWiki(tags: string[]): WikiPage[] {
  if (tags.length === 0) return []
  const lower = tags.map(t => t.toLowerCase())
  return listWikiPages().filter(page =>
    page.frontmatter.tags.some(t => lower.includes(t.toLowerCase()))
  )
}

export function queryWikiByEntityType(entityType: string): WikiPage[] {
  return listWikiPages().filter(p => p.frontmatter.entity_type === entityType)
}

export function queryWikiAll(): WikiPage[] {
  return listWikiPages().sort((a, b) =>
    b.frontmatter.last_updated.localeCompare(a.frontmatter.last_updated)
  )
}

export function extractTagsFromTools(toolNames: string[]): string[] {
  const seen = new Set<string>()
  for (const name of toolNames) {
    const tag = TOOL_TAG_MAP[name.toLowerCase()]
    if (tag) seen.add(tag)
  }
  return Array.from(seen)
}

export function rebuildIndex(): void {
  try {
    ensureWikiDir()
    const pages = listWikiPages()
    if (pages.length === 0) {
      fs.writeFileSync(INDEX_FILE, '# Knowledge Wiki\n\n_(no entries yet)_\n', { encoding: 'utf-8', mode: 0o600 })
      return
    }

    const groups = new Map<string, WikiPage[]>()
    for (const page of pages) {
      const section = page.frontmatter.entity_type
        ? page.frontmatter.entity_type.charAt(0).toUpperCase() + page.frontmatter.entity_type.slice(1) + 's'
        : (page.frontmatter.tags[0] ?? 'General').charAt(0).toUpperCase() + (page.frontmatter.tags[0] ?? 'General').slice(1)
      const existing = groups.get(section)
      if (existing) {
        existing.push(page)
      } else {
        groups.set(section, [page])
      }
    }

    const lines = ['# Knowledge Wiki', '']
    for (const [section, sectionPages] of groups) {
      lines.push(`## ${section}`)
      for (const page of sectionPages) {
        const preview = page.body.slice(0, 60).replace(/\n/g, ' ')
        const traj = page.frontmatter.trajectory ? ` · ${page.frontmatter.trajectory}` : ''
        lines.push(`- [${page.frontmatter.title}](${page.frontmatter.id}.md) — ${preview} (confidence: ${page.frontmatter.confidence}${traj})`)
      }
      lines.push('')
    }

    fs.writeFileSync(INDEX_FILE, lines.join('\n'), { encoding: 'utf-8', mode: 0o600 })
  } catch { /* non-critical */ }
}
