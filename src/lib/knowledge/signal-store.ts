import fs from 'fs'
import os from 'os'
import path from 'path'
import { encryptLine, decryptLine } from '@/lib/secure-storage'
import type { PreferenceSignal } from './types'

const HEARTH_DIR   = path.join(os.homedir(), '.hearth')
const MEMORY_DIR   = path.join(HEARTH_DIR, 'memory')
const SIGNALS_FILE = path.join(MEMORY_DIR, 'signals.jsonl')

function ensureDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true, mode: 0o700 })
  }
}

export function appendSignal(signal: Omit<PreferenceSignal, 'id' | 'timestamp'>): void {
  try {
    ensureDir()
    const record: PreferenceSignal = {
      id:        crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...signal,
    }
    fs.appendFileSync(SIGNALS_FILE, encryptLine(record) + '\n', { mode: 0o600, encoding: 'utf8' })
  } catch { /* non-critical — never throw from logging */ }
}

function readRaw(): PreferenceSignal[] {
  try {
    const raw = fs.readFileSync(SIGNALS_FILE, 'utf8')
    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return decryptLine(line) as PreferenceSignal } catch { return null } })
      .filter((s): s is PreferenceSignal => s !== null && typeof s.id === 'string')
  } catch { return [] }
}

export function pruneOldSignals(maxAgeDays = 90): number {
  try {
    const cutoff  = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString()
    const all     = readRaw()
    const kept    = all.filter(s => s.timestamp >= cutoff)
    const pruned  = all.length - kept.length
    if (pruned > 0) {
      const tmp = SIGNALS_FILE + '.tmp'
      fs.writeFileSync(tmp, kept.map(s => encryptLine(s)).join('\n') + (kept.length ? '\n' : ''), { mode: 0o600, encoding: 'utf8' })
      fs.renameSync(tmp, SIGNALS_FILE)
    }
    return pruned
  } catch { return 0 }
}

export function readAllSignals(): PreferenceSignal[] {
  const signals = readRaw()
  // Lazy prune when file grows large
  if (signals.length > 500) {
    pruneOldSignals(90)
    return readRaw()
  }
  return signals
}

export function readSignalsSince(cutoffIso: string): PreferenceSignal[] {
  return readAllSignals().filter(s => s.timestamp >= cutoffIso)
}
