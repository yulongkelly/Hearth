import path from 'path'
import os from 'os'
import { appendTelegramMessage } from './telegram-store'
import { writeEncrypted, readEncrypted } from './secure-storage'

const HEARTH_DIR  = path.join(os.homedir(), '.hearth')
const CONFIG_FILE = path.join(HEARTH_DIR, 'telegram-config.json')

interface TelegramConfig { token: string }

export type TelegramStatus = 'stopped' | 'connecting' | 'connected' | 'error'

interface TelegramState {
  status:  TelegramStatus
  botName: string | null
  error:   string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { var __telegram: { bot: any; state: TelegramState } | undefined }

export function getTelegramState(): TelegramState {
  return global.__telegram?.state ?? { status: 'stopped', botName: null, error: null }
}

export function loadTelegramToken(): string | null {
  return readEncrypted<TelegramConfig>(CONFIG_FILE)?.token ?? null
}

export async function startTelegramBot(token?: string) {
  if (global.__telegram) {
    if (global.__telegram.state.status !== 'error') return
    await stopTelegramBot()
  }

  const t = token ?? loadTelegramToken()
  if (!t) throw new Error('No Telegram bot token provided')

  if (token) writeEncrypted(CONFIG_FILE, { token })

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Telegraf } = require('telegraf') as typeof import('telegraf')

  const state: TelegramState = { status: 'connecting', botName: null, error: null }
  const bot = new Telegraf(t)

  try {
    const me = await bot.telegram.getMe()
    state.status  = 'connected'
    state.botName = me.username ?? me.first_name
  } catch (err) {
    state.status = 'error'
    state.error  = err instanceof Error ? err.message : 'Invalid token or network error'
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot.on('message', (ctx: any) => {
    try {
      const msg = ctx.message
      if (!msg?.text) return
      appendTelegramMessage({
        from:      msg.from?.username ?? msg.from?.first_name ?? 'unknown',
        chatId:    msg.chat.id,
        chatTitle: msg.chat.title ?? null,
        text:      msg.text,
        timestamp: new Date().toISOString(),
      })
    } catch { /* non-critical */ }
  })

  global.__telegram = { bot, state }

  bot.launch().catch((err: Error) => {
    state.status = 'error'
    state.error  = err.message
  })
}

export async function stopTelegramBot() {
  if (!global.__telegram) return
  try { global.__telegram.bot.stop() } catch {}
  global.__telegram = undefined
}

export async function sendTelegramMessage(chatIdOrUsername: string, text: string): Promise<string> {
  if (!global.__telegram || global.__telegram.state.status !== 'connected') return 'Error: Telegram bot is not connected.'
  try {
    const target = /^\d+$/.test(chatIdOrUsername) ? parseInt(chatIdOrUsername) : chatIdOrUsername
    await global.__telegram.bot.telegram.sendMessage(target, text)
    return `Message sent to ${chatIdOrUsername}.`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'send failed'}`
  }
}
