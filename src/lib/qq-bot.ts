import path from 'path'
import os from 'os'
import { appendQqMessage } from './qq-store'
import { writeEncrypted, readEncrypted } from './secure-storage'

const HEARTH_DIR  = path.join(os.homedir(), '.hearth')
const CONFIG_FILE = path.join(HEARTH_DIR, 'qq-config.json')
const SESSION_DIR = path.join(HEARTH_DIR, 'qq-session')

interface QqConfig { uin: number }

export type QqStatus = 'stopped' | 'scanning' | 'connecting' | 'connected' | 'error'

interface QqState {
  status:     QqStatus
  qrImage:    string | null
  loggedInAs: string | null
  uin:        number | null
  error:      string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { var __qq: { client: any; state: QqState; pollTimer?: NodeJS.Timeout } | undefined }

export function getQqState(): QqState {
  return global.__qq?.state ?? { status: 'stopped', qrImage: null, loggedInAs: null, uin: null, error: null }
}

export function savedQqUin(): number | null {
  return readEncrypted<QqConfig>(CONFIG_FILE)?.uin ?? null
}

export async function startQqBot(uin?: number) {
  if (global.__qq) {
    if (global.__qq.state.status !== 'error') return
    await stopQqBot()
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('icqq') as typeof import('icqq')

  const state: QqState = {
    status:     uin ? 'connecting' : 'scanning',
    qrImage:    null,
    loggedInAs: null,
    uin:        null,
    error:      null,
  }

  const client = createClient({ log_level: 'off', data_dir: SESSION_DIR })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on('system.login.qrcode', (e: any) => {
    state.status  = 'scanning'
    state.qrImage = 'data:image/png;base64,' + (e.image as Buffer).toString('base64')
    // Poll to detect scan
    if (global.__qq) {
      if (global.__qq.pollTimer) clearInterval(global.__qq.pollTimer)
      global.__qq.pollTimer = setInterval(() => { client.login() }, 4000)
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on('system.login.slider', (e: any) => {
    state.status = 'error'
    state.error  = `Slider captcha required. Open in browser and paste the ticket: ${e.url}`
    if (global.__qq?.pollTimer) { clearInterval(global.__qq.pollTimer); global.__qq.pollTimer = undefined }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on('system.login.error', (e: any) => {
    state.status = 'error'
    state.error  = String(e.message || 'Login failed')
    if (global.__qq?.pollTimer) { clearInterval(global.__qq.pollTimer); global.__qq.pollTimer = undefined }
  })

  client.on('system.online', () => {
    if (global.__qq?.pollTimer) { clearInterval(global.__qq.pollTimer); global.__qq.pollTimer = undefined }
    state.status    = 'connected'
    state.loggedInAs = client.nickname
    state.uin       = client.uin
    state.qrImage   = null
    writeEncrypted(CONFIG_FILE, { uin: client.uin })
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on('system.offline', (e: any) => {
    state.status    = 'stopped'
    state.loggedInAs = null
    state.error     = String(e?.message ?? 'Disconnected')
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on('message.private', (e: any) => {
    try {
      if (e.self_id === e.sender.user_id) return
      appendQqMessage({ from: e.sender.nickname, uin: e.sender.user_id, room: null, text: e.raw_message, timestamp: new Date().toISOString() })
    } catch { /* non-critical */ }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on('message.group', (e: any) => {
    try {
      appendQqMessage({ from: e.sender.nickname, uin: e.sender.user_id, room: e.group_name || String(e.group_id), text: e.raw_message, timestamp: new Date().toISOString() })
    } catch { /* non-critical */ }
  })

  global.__qq = { client, state }
  client.login(uin)
}

export async function stopQqBot() {
  if (!global.__qq) return
  if (global.__qq.pollTimer) clearInterval(global.__qq.pollTimer)
  try { await global.__qq.client.logout() } catch {}
  global.__qq = undefined
}

export async function sendQqMessage(target: string, text: string): Promise<string> {
  if (!global.__qq || global.__qq.state.status !== 'connected') return 'Error: QQ is not connected.'
  const num = parseInt(target)
  if (isNaN(num)) return `Error: target must be a QQ number, got "${target}".`
  try {
    await global.__qq.client.sendPrivateMsg(num, text)
    return `Message sent to ${target}.`
  } catch {
    try {
      await global.__qq.client.sendGroupMsg(num, text)
      return `Message sent to group ${target}.`
    } catch {
      return `Error: could not send to ${target}. They may not be in your contact list.`
    }
  }
}
