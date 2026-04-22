import fs from 'fs'
import path from 'path'
import os from 'os'

const HEARTH_DIR = path.join(os.homedir(), '.hearth')
const CREDENTIALS_FILE = path.join(HEARTH_DIR, 'google-credentials.json')
const TOKENS_FILE = path.join(HEARTH_DIR, 'google-tokens.json')

export interface GoogleTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

function ensureDir() {
  if (!fs.existsSync(HEARTH_DIR)) fs.mkdirSync(HEARTH_DIR, { recursive: true })
}

function getClientId(): string {
  try { return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8')).clientId ?? '' } catch { return '' }
}

function getClientSecret(): string {
  try { return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8')).clientSecret ?? '' } catch { return '' }
}

export function isConfigured(): boolean {
  return !!(getClientId() && getClientSecret())
}

export function saveCredentials(clientId: string, clientSecret: string) {
  ensureDir()
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ clientId, clientSecret }, null, 2))
}

export function saveTokens(tokens: GoogleTokens) {
  ensureDir()
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2))
}

export function loadTokens(): GoogleTokens | null {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'))
  } catch { return null }
}

export function deleteTokens() {
  try { fs.unlinkSync(TOKENS_FILE) } catch {}
}

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = loadTokens()
  if (!tokens) return null
  if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken

  const clientId = getClientId()
  const clientSecret = getClientSecret()
  if (!clientId || !clientSecret) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) return null
  const data = await res.json()
  const newTokens: GoogleTokens = {
    accessToken: data.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  saveTokens(newTokens)
  return newTokens.accessToken
}

export function buildAuthUrl(): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', getClientId())
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

export async function exchangeCode(code: string) {
  return fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
}

export const REDIRECT_URI = 'http://localhost:3000/api/auth/callback/google'
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ')
