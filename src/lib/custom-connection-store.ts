import path from 'path'
import os from 'os'
import { writeEncrypted, readEncrypted } from './secure-storage'

const FILE = path.join(os.homedir(), '.hearth', 'custom-connections.json')

export interface CustomConnection {
  id: string
  service: string
  credentials: Record<string, string>
  authTemplate?: string   // e.g. "Bearer {api_key}" — applied as Authorization header
  testUrl?: string
  testMethod?: string
  verifiedAt: string
}

export function loadConnections(): CustomConnection[] {
  return readEncrypted<CustomConnection[]>(FILE) ?? []
}

export function saveConnections(list: CustomConnection[]) {
  writeEncrypted(FILE, list)
}

export function addConnection(c: CustomConnection) {
  saveConnections([...loadConnections().filter(x => x.id !== c.id), c])
}

export function removeConnection(id: string) {
  saveConnections(loadConnections().filter(c => c.id !== id))
}
