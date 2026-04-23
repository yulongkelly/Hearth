import fs from 'fs'
import os from 'os'
import path from 'path'
import { readEncrypted, writeEncrypted } from './secure-storage'

const HEARTH_DIR       = path.join(os.homedir(), '.hearth')
const CREDENTIALS_FILE = path.join(HEARTH_DIR, 'plaid-credentials.json')
const ITEMS_FILE       = path.join(HEARTH_DIR, 'plaid-items.json')

export type PlaidEnv = 'sandbox' | 'production'

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

// ─── Credentials ─────────────────────────────────────────────────────────────

export function isConfigured(): boolean {
  return fs.existsSync(CREDENTIALS_FILE)
}

export function loadCredentials(): PlaidCredentials | null {
  return readEncrypted<PlaidCredentials>(CREDENTIALS_FILE)
}

export function saveCredentials(clientId: string, secret: string, env: PlaidEnv) {
  writeEncrypted(CREDENTIALS_FILE, { clientId, secret, env })
}

// ─── Items (linked banks) ─────────────────────────────────────────────────────

function loadItems(): PlaidItems {
  return readEncrypted<PlaidItems>(ITEMS_FILE) ?? {}
}

function saveItems(items: PlaidItems) {
  writeEncrypted(ITEMS_FILE, items)
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
  if (env === 'production') return 'https://production.plaid.com'
  return 'https://sandbox.plaid.com'
}
