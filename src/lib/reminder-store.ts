import fs from 'fs'
import os from 'os'
import path from 'path'
import { encryptLine, decryptLine } from './secure-storage'

const HEARTH_DIR      = path.join(os.homedir(), '.hearth')
const REMINDERS_FILE  = path.join(HEARTH_DIR, 'reminders.jsonl')
const REMINDERS_TMP   = path.join(HEARTH_DIR, 'reminders.jsonl.tmp')

export interface Reminder {
  id: string
  text: string
  dueDate: string        // YYYY-MM-DD
  createdAt: string
  completedAt?: string
  notifiedAt?: string    // set when first fired; prevents re-notification after restart
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly'
  sourceContext?: string
  tags?: string[]
}

function ensureDir() {
  if (!fs.existsSync(HEARTH_DIR)) {
    fs.mkdirSync(HEARTH_DIR, { recursive: true, mode: 0o700 })
  }
}

function readAll(): Reminder[] {
  try {
    const raw = fs.readFileSync(REMINDERS_FILE, 'utf8')
    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return decryptLine(line) as Reminder } catch { return null } })
      .filter((r): r is Reminder => r !== null)
  } catch { return [] }
}

function writeAll(reminders: Reminder[]): void {
  ensureDir()
  const content = reminders.map(r => encryptLine(r)).join('\n') + (reminders.length ? '\n' : '')
  fs.writeFileSync(REMINDERS_TMP, content, { mode: 0o600, encoding: 'utf8' })
  fs.renameSync(REMINDERS_TMP, REMINDERS_FILE)
}

export function createReminder(input: Omit<Reminder, 'id' | 'createdAt'>): Reminder {
  ensureDir()
  const reminder: Reminder = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  }
  const sizeBefore = fs.existsSync(REMINDERS_FILE) ? fs.statSync(REMINDERS_FILE).size : 0
  fs.appendFileSync(REMINDERS_FILE, encryptLine(reminder) + '\n', { mode: 0o600, encoding: 'utf8' })
  if (fs.statSync(REMINDERS_FILE).size <= sizeBefore) {
    throw new Error('Reminder write failed: file did not grow after append')
  }
  return reminder
}

export function listReminders(opts: { includeCompleted?: boolean; limit?: number } = {}): Reminder[] {
  const { includeCompleted = false, limit } = opts
  let reminders = readAll()
  if (!includeCompleted) reminders = reminders.filter(r => !r.completedAt)
  reminders.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return limit ? reminders.slice(0, limit) : reminders
}

export function getDueReminders(): Reminder[] {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return readAll().filter(r => !r.completedAt && !r.notifiedAt && r.dueDate <= today)
}

export function markNotified(id: string): void {
  const reminders = readAll()
  const idx = reminders.findIndex(r => r.id === id)
  if (idx === -1) return
  const r = reminders[idx]
  if (r.recurrence) {
    // Advance to next occurrence — clears notifiedAt so it can fire again next period
    reminders[idx] = { ...r, dueDate: nextDueDate(r.dueDate, r.recurrence), notifiedAt: undefined }
  } else {
    reminders[idx] = { ...r, notifiedAt: new Date().toISOString() }
  }
  writeAll(reminders)
}

function nextDueDate(dueDate: string, recurrence: Reminder['recurrence']): string {
  const d = new Date(dueDate + 'T12:00:00') // noon local to avoid DST edge cases
  switch (recurrence) {
    case 'daily':   d.setDate(d.getDate() + 1); break
    case 'weekly':  d.setDate(d.getDate() + 7); break
    case 'monthly': d.setMonth(d.getMonth() + 1); break
    case 'yearly':  d.setFullYear(d.getFullYear() + 1); break
  }
  return d.toISOString().slice(0, 10)
}

export function completeReminder(id: string): { updated: Reminder; next?: Reminder } {
  const reminders = readAll()
  const idx = reminders.findIndex(r => r.id === id)
  if (idx === -1) throw new Error(`Reminder ${id} not found`)
  const updated: Reminder = { ...reminders[idx], completedAt: new Date().toISOString() }
  reminders[idx] = updated
  writeAll(reminders)

  let next: Reminder | undefined
  if (updated.recurrence) {
    next = createReminder({
      text:          updated.text,
      dueDate:       nextDueDate(updated.dueDate, updated.recurrence),
      recurrence:    updated.recurrence,
      sourceContext: updated.sourceContext,
      tags:          updated.tags,
    })
  }
  return { updated, next }
}

export function deleteReminder(id: string): boolean {
  const reminders = readAll()
  const filtered = reminders.filter(r => r.id !== id)
  if (filtered.length === reminders.length) return false
  writeAll(filtered)
  return true
}

export function updateReminder(id: string, patch: Partial<Pick<Reminder, 'text' | 'dueDate' | 'recurrence' | 'tags'>>): Reminder | null {
  const reminders = readAll()
  const idx = reminders.findIndex(r => r.id === id)
  if (idx === -1) return null
  reminders[idx] = { ...reminders[idx], ...patch }
  writeAll(reminders)
  return reminders[idx]
}
