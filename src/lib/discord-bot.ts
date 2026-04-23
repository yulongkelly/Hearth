import path from 'path'
import os from 'os'
import { appendDiscordMessage } from './discord-store'
import { writeEncrypted, readEncrypted } from './secure-storage'

const HEARTH_DIR  = path.join(os.homedir(), '.hearth')
const CONFIG_FILE = path.join(HEARTH_DIR, 'discord-config.json')

interface DiscordConfig { token: string }

export type DiscordStatus = 'stopped' | 'connecting' | 'connected' | 'error'

interface DiscordState {
  status:  DiscordStatus
  botName: string | null
  guilds:  string[]
  error:   string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { var __discord: { client: any; state: DiscordState } | undefined }

export function getDiscordState(): DiscordState {
  return global.__discord?.state ?? { status: 'stopped', botName: null, guilds: [], error: null }
}

export function loadDiscordToken(): string | null {
  return readEncrypted<DiscordConfig>(CONFIG_FILE)?.token ?? null
}

export async function startDiscordBot(token?: string) {
  if (global.__discord) {
    if (global.__discord.state.status !== 'error') return
    await stopDiscordBot()
  }

  const t = token ?? loadDiscordToken()
  if (!t) throw new Error('No Discord bot token provided')

  if (token) writeEncrypted(CONFIG_FILE, { token })

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client, GatewayIntentBits, Events } = require('discord.js') as typeof import('discord.js')

  const state: DiscordState = { status: 'connecting', botName: null, guilds: [], error: null }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  })

  global.__discord = { client, state }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.once(Events.ClientReady, (c: any) => {
    state.status  = 'connected'
    state.botName = c.user.tag
    state.guilds  = c.guilds.cache.map((g: { name: string }) => g.name)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on(Events.MessageCreate, (message: any) => {
    try {
      if (message.author.bot || !message.content) return
      appendDiscordMessage({
        from:      message.author.username,
        channel:   message.guild ? (message.channel.name ?? null) : null,
        guild:     message.guild?.name ?? null,
        text:      message.content,
        timestamp: new Date().toISOString(),
      })
    } catch { /* non-critical */ }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on(Events.Error, (err: any) => {
    state.status = 'error'
    state.error  = err?.message ?? 'Unknown error'
  })

  try {
    await client.login(t)
  } catch (err) {
    state.status = 'error'
    state.error  = err instanceof Error ? err.message : 'Invalid token or network error'
    global.__discord = undefined
  }
}

export async function stopDiscordBot() {
  if (!global.__discord) return
  try { global.__discord.client.destroy() } catch {}
  global.__discord = undefined
}

export async function sendDiscordMessage(channelTarget: string, text: string): Promise<string> {
  if (!global.__discord || global.__discord.state.status !== 'connected') return 'Error: Discord bot is not connected.'
  try {
    const { client } = global.__discord
    // Try by channel ID first, then by name
    let ch = client.channels.cache.get(channelTarget)
    if (!ch) ch = client.channels.cache.find((c: { name?: string }) => c.name === channelTarget)
    if (!ch || !('send' in ch)) return `Error: channel "${channelTarget}" not found.`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ch as any).send(text)
    return `Message sent to #${channelTarget}.`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : 'send failed'}`
  }
}
