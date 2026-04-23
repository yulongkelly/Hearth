import fs from 'fs'
import path from 'path'
import os from 'os'
import { readEncrypted, writeEncrypted } from './secure-storage'

const HEARTH_DIR = path.join(os.homedir(), '.hearth')
const CREDENTIALS_FILE = path.join(HEARTH_DIR, 'google-credentials.json')
const ACCOUNTS_FILE = path.join(HEARTH_DIR, 'google-accounts.json')

export interface GoogleTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface GoogleAccount extends GoogleTokens {
  nickname?: string | null
}

export type GoogleAccounts = Record<string, GoogleAccount>

function readCredentials(): { clientId: string; clientSecret: string } | null {
  const raw = readEncrypted<{ clientId: string; clientSecret: string }>(CREDENTIALS_FILE)
  if (raw?.clientId && raw?.clientSecret) return raw
  return null
}

export function isConfigured(): boolean {
  return fs.existsSync(CREDENTIALS_FILE)
}

export function saveCredentials(clientId: string, clientSecret: string) {
  writeEncrypted(CREDENTIALS_FILE, { clientId, clientSecret })
}

// ─── Multi-account storage ────────────────────────────────────────────────────

export function loadAccounts(): GoogleAccounts {
  return readEncrypted<GoogleAccounts>(ACCOUNTS_FILE) ?? {}
}

export function saveAccounts(accounts: GoogleAccounts) {
  writeEncrypted(ACCOUNTS_FILE, accounts)
}

export function addAccount(email: string, tokens: GoogleTokens, nickname?: string) {
  const accounts = loadAccounts()
  accounts[email] = {
    ...tokens,
    nickname: nickname ?? accounts[email]?.nickname ?? null,
  }
  saveAccounts(accounts)
}

export function removeAccount(email: string) {
  const accounts = loadAccounts()
  delete accounts[email]
  saveAccounts(accounts)
}

export function listAccounts(): Array<{ email: string; nickname?: string | null }> {
  return Object.entries(loadAccounts()).map(([email, acc]) => ({ email, nickname: acc.nickname }))
}

export function setNickname(email: string, nickname: string) {
  const accounts = loadAccounts()
  if (!accounts[email]) return
  accounts[email].nickname = nickname.trim() || null
  saveAccounts(accounts)
}

export async function getValidAccessTokenForAccount(email: string): Promise<string | null> {
  const accounts = loadAccounts()
  const account = accounts[email]
  if (!account) return null
  if (Date.now() < account.expiresAt - 60_000) return account.accessToken

  const creds = readCredentials()
  if (!creds) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) return null
  const data = await res.json()
  accounts[email] = {
    ...accounts[email],
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  saveAccounts(accounts)
  return accounts[email].accessToken
}

// ─── Backwards-compat shims (used by single-account callers) ─────────────────

export function loadTokens(): GoogleAccount | null {
  const entries = Object.values(loadAccounts())
  return entries.length > 0 ? entries[0] : null
}

export async function getValidAccessToken(): Promise<string | null> {
  const emails = Object.keys(loadAccounts())
  if (emails.length === 0) return null
  return getValidAccessTokenForAccount(emails[0])
}

// ─── OAuth helpers ────────────────────────────────────────────────────────────

export function buildAuthUrl(): string {
  const creds = readCredentials()
  if (!creds) throw new Error('Google credentials not configured')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', creds.clientId)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

export async function exchangeCode(code: string) {
  const creds = readCredentials()
  if (!creds) throw new Error('Google credentials not configured')
  return fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
}

export const REDIRECT_URI = 'http://localhost:3000/api/auth/callback/google'
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')
