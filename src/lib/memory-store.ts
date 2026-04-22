import fs from 'fs'
import os from 'os'
import path from 'path'

const HEARTH_DIR  = path.join(os.homedir(), '.hearth')
const MEMORY_DIR  = path.join(HEARTH_DIR, 'memory')
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.txt')
const USER_FILE   = path.join(MEMORY_DIR, 'user.txt')
const DELIMITER   = '\n§\n'

export type MemoryTarget = 'memory' | 'user'

// ─── Injection / exfiltration security scan ──────────────────────────────────

const INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /act\s+as\s+if/i,
  /disregard\s+(all|your|the)/i,
  /curl[^|]*Authorization/i,
  /wget[^|]*token/i,
]
const INVISIBLE_UNICODE = /[​‌‪-‮]/

function scanContent(content: string): string | null {
  if (INVISIBLE_UNICODE.test(content)) return 'Error: content contains disallowed unicode characters.'
  for (const re of INJECTION_PATTERNS) {
    if (re.test(content)) return 'Error: content contains disallowed patterns.'
  }
  return null
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function filePath(target: MemoryTarget): string {
  return target === 'memory' ? MEMORY_FILE : USER_FILE
}

function ensureDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true, mode: 0o700 })
  }
}

function readRaw(target: MemoryTarget): string {
  try { return fs.readFileSync(filePath(target), 'utf8') } catch { return '' }
}

function writeAtomic(target: MemoryTarget, content: string) {
  ensureDir()
  const fp  = filePath(target)
  const tmp = fp + '.tmp'
  fs.writeFileSync(tmp, content, { mode: 0o600, encoding: 'utf8' })
  fs.renameSync(tmp, fp)
}

function parseEntries(raw: string): string[] {
  return raw
    .split(DELIMITER)
    .map(e => e.trim())
    .filter(Boolean)
}

function dedup(entries: string[]): string[] {
  const seen = new Set<string>()
  return entries.filter(e => {
    if (seen.has(e)) return false
    seen.add(e)
    return true
  })
}

function serialize(entries: string[]): string {
  return entries.join(DELIMITER)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function readMemory(target: MemoryTarget): string {
  return readRaw(target).trim()
}

export function readMemoryTrimmed(target: MemoryTarget, charBudget: number): string {
  const raw = readRaw(target)
  if (!raw.trim()) return ''
  if (charBudget <= 0 || raw.length <= charBudget) return raw.trim()

  // Take entries from the END (most recent) until budget exhausted
  const entries = parseEntries(raw)
  const kept: string[] = []
  let used = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    const cost  = entry.length + DELIMITER.length
    if (used + cost > charBudget) break
    kept.unshift(entry)
    used += cost
  }
  return kept.join(DELIMITER)
}

export function addEntry(target: MemoryTarget, content: string): string {
  const err = scanContent(content)
  if (err) return err
  if (!content.trim()) return 'Error: content is empty.'

  const entries = dedup([...parseEntries(readRaw(target)), content.trim()])
  writeAtomic(target, serialize(entries))
  return 'Memory saved.'
}

export function replaceEntry(target: MemoryTarget, old: string, next: string): string {
  if (!old.trim()) return 'Error: old_content is required for replace.'
  const err = scanContent(next)
  if (err) return err

  const entries = parseEntries(readRaw(target))
  const idx = entries.findIndex(e => e.includes(old.trim()))
  if (idx === -1) return 'Error: entry not found.'

  entries[idx] = next.trim()
  writeAtomic(target, serialize(dedup(entries)))
  return 'Memory updated.'
}

export function removeEntry(target: MemoryTarget, old: string): string {
  if (!old.trim()) return 'Error: old_content is required for remove.'

  const entries = parseEntries(readRaw(target))
  const filtered = entries.filter(e => !e.includes(old.trim()))
  if (filtered.length === entries.length) return 'Error: entry not found.'

  writeAtomic(target, serialize(filtered))
  return 'Memory entry removed.'
}

export function writeFullMemory(target: MemoryTarget, content: string): string {
  const err = scanContent(content)
  if (err) return err
  writeAtomic(target, content)
  return 'Memory saved.'
}
