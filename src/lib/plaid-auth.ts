import fs from 'fs'
import os from 'os'
import path from 'path'

const HEARTH_DIR       = path.join(os.homedir(), '.hearth')
const CREDENTIALS_FILE = path.join(HEARTH_DIR, 'plaid-credentials.json')
const ITEMS_FILE       = path.join(HEARTH_DIR, 'plaid-items.json')

export type PlaidEnv = 'sandbox' | 'development' | 'production'

export interface PlaidCredentials {
  clientId: string
  secret:   string
  env:      PlaidEnv
}

export interface PlaidAccount {
  id:   string
  name: string
  mask: string
  type: string
}

export interface PlaidItem {
  itemId:          string
  accessToken:     string
  institutionName: string
  accounts:        PlaidAccount[]
}

type PlaidItems = Record<string, PlaidItem>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(HEARTH_DIR)) fs.mkdirSync(HEARTH_DIR, { recursive: true, mode: 0o700 })
}

function writeSecure(filePath: string, content: string) {
  ensureDir()
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, content, { mode: 0o600, encoding: 'utf8' })
  fs.renameSync(tmp, filePath)
}

// ─── Credentials ─────────────────────────────────────────────────────────────

export function isConfigured(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'))
    return !!(raw?.clientId && raw?.secret && raw?.env)
  } catch { return false }
}

export function loadCredentials(): PlaidCredentials | null {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'))
    if (raw?.clientId && raw?.secret && raw?.env) return raw as PlaidCredentials
    return null
  } catch { return null }
}

export function saveCredentials(clientId: string, secret: string, env: PlaidEnv) {
  writeSecure(CREDENTIALS_FILE, JSON.stringify({ clientId, secret, env }, null, 2))
}

// ─── Items (linked banks) ─────────────────────────────────────────────────────

function loadItems(): PlaidItems {
  try { return JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8')) } catch { return {} }
}

function saveItems(items: PlaidItems) {
  writeSecure(ITEMS_FILE, JSON.stringify(items, null, 2))
}

export function addItem(itemId: string, accessToken: string, institutionName: string, accounts: PlaidAccount[]) {
  const items = loadItems()
  items[itemId] = { itemId, accessToken, institutionName, accounts }
  saveItems(items)
}

export function removeItem(itemId: string) {
  const items = loadItems()
  delete items[itemId]
  saveItems(items)
}

export function listItems(): PlaidItem[] {
  return Object.values(loadItems())
}

export function getItem(itemId: string): PlaidItem | null {
  return loadItems()[itemId] ?? null
}

// ─── API base URL ─────────────────────────────────────────────────────────────

export function plaidBaseUrl(env: PlaidEnv): string {
  if (env === 'production')  return 'https://production.plaid.com'
  if (env === 'development') return 'https://development.plaid.com'
  return 'https://sandbox.plaid.com'
}
