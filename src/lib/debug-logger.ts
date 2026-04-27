import fs from 'fs'
import path from 'path'
import os from 'os'

export interface DebugEntry {
  t:    string   // ISO timestamp
  step: string
  data: unknown
}

export class DebugLogger {
  readonly sessionId: string
  private fd: number
  readonly filePath: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
    const dir = path.join(os.homedir(), '.hearth', 'debug')
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    this.filePath = path.join(dir, `${ts}_${sessionId.slice(0, 8)}.ndjson`)
    this.fd = fs.openSync(this.filePath, 'w', 0o600)
  }

  log(step: string, data: unknown): void {
    const entry: DebugEntry = { t: new Date().toISOString(), step, data }
    try { fs.writeSync(this.fd, JSON.stringify(entry) + '\n') } catch { /* non-critical */ }
  }

  close(): void {
    try { fs.closeSync(this.fd) } catch {}
  }
}
