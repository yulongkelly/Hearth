import fs from 'fs'
import os from 'os'
import path from 'path'

const HEARTH_DIR  = path.join(os.homedir(), '.hearth')
const EVENTS_FILE = path.join(HEARTH_DIR, 'events.jsonl')

export interface HearthEvent {
  id:        string
  type:      'tool_call' | 'workflow_run'
  timestamp: string

  // tool_call
  tool?:   string
  args?:   Record<string, unknown>
  result?: string

  // workflow_run
  workflowId?:   string
  workflowName?: string
  durationMs?:   number
  stepOutputs?:  Record<string, string>
}

function ensureDir() {
  if (!fs.existsSync(HEARTH_DIR)) {
    fs.mkdirSync(HEARTH_DIR, { recursive: true, mode: 0o700 })
  }
}

export function appendEvent(event: Omit<HearthEvent, 'id' | 'timestamp'>): void {
  try {
    ensureDir()
    const record: HearthEvent = {
      id:        crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    }
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(record) + '\n', { mode: 0o600, encoding: 'utf8' })
  } catch { /* non-critical — never throw from logging */ }
}

function readAllEvents(): HearthEvent[] {
  try {
    const raw = fs.readFileSync(EVENTS_FILE, 'utf8')
    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line) as HearthEvent } catch { return null } })
      .filter((e): e is HearthEvent => e !== null)
  } catch { return [] }
}

interface ListOpts {
  type?:  string
  days?:  number
  limit?: number
}

export function listEvents(opts: ListOpts = {}): HearthEvent[] {
  const { type, days = 30, limit = 20 } = opts
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  return readAllEvents()
    .filter(e => e.timestamp >= cutoff)
    .filter(e => !type || e.type === type)
    .reverse()
    .slice(0, limit)
}

export function searchEvents(query: string, opts: ListOpts = {}): HearthEvent[] {
  const { type, days = 30, limit = 20 } = opts
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const q = query.toLowerCase()
  return readAllEvents()
    .filter(e => e.timestamp >= cutoff)
    .filter(e => !type || e.type === type)
    .filter(e => JSON.stringify(e).toLowerCase().includes(q))
    .reverse()
    .slice(0, limit)
}
