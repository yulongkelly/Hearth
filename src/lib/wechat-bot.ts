import { WechatyBuilder } from 'wechaty'
import { appendWechatMessage } from './wechat-store'

export type BotStatus = 'stopped' | 'scanning' | 'connected' | 'error'
export type PuppetType = 'xp' | 'wechat4u'

interface BotState {
  status:     BotStatus
  puppet:     PuppetType | null
  qr:         string | null
  loggedInAs: string | null
  error:      string | null
}

// eslint-disable-next-line no-var
declare global { var __wechat: { bot: ReturnType<typeof WechatyBuilder.build>; state: BotState } | undefined }

export function getBotState(): BotState {
  return global.__wechat?.state ?? { status: 'stopped', puppet: null, qr: null, loggedInAs: null, error: null }
}

// Check at runtime whether the XP puppet is installed (requires VS Build Tools)
export function isXpAvailable(): boolean {
  try { require.resolve('wechaty-puppet-xp'); return true } catch { return false }
}

export async function startBot() {
  if (global.__wechat) return

  const useXp = isXpAvailable()
  const state: BotState = { status: 'scanning', puppet: useXp ? 'xp' : 'wechat4u', qr: null, loggedInAs: null, error: null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let puppet: any
  if (useXp) {
    // XP puppet: hooks into running WeChat PC process — works for ALL accounts, no QR needed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PuppetXp } = require('wechaty-puppet-xp')
    puppet = new PuppetXp()
  } else {
    // wechat4u: WeChat Web protocol — blocked for accounts created after ~2017
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PuppetWechat4u } = require('wechaty-puppet-wechat4u') as typeof import('wechaty-puppet-wechat4u')
    puppet = new PuppetWechat4u()
  }

  const bot = WechatyBuilder.build({ puppet })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot.on('scan',   (qr: any)   => { state.status = 'scanning'; state.qr = qr })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot.on('login',  (user: any) => { state.status = 'connected'; state.loggedInAs = user.name(); state.qr = null })
  bot.on('logout', ()          => { state.status = 'stopped'; state.loggedInAs = null })
  bot.on('error',  (e: Error)  => { state.status = 'error'; state.error = e.message })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot.on('message', async (message: any) => {
    try {
      if (message.self()) return
      const room = message.room()
      appendWechatMessage({
        from:      message.talker().name(),
        room:      room ? await room.topic() : null,
        text:      message.text(),
        timestamp: new Date().toISOString(),
      })
    } catch { /* non-critical */ }
  })

  global.__wechat = { bot, state }
  await bot.start()
}

export async function stopBot() {
  if (!global.__wechat) return
  await global.__wechat.bot.stop()
  global.__wechat = undefined
}

export async function sendWechatMessage(contactName: string, text: string): Promise<string> {
  if (!global.__wechat) return 'Error: WeChat bot is not running.'
  if (global.__wechat.state.status !== 'connected') return 'Error: WeChat is not connected.'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contact = await (global.__wechat.bot as any).Contact.find({ name: contactName })
  if (!contact) return `Error: contact "${contactName}" not found.`
  await contact.say(text)
  return `Message sent to ${contactName}.`
}
