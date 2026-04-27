import type { BasePlatformAdapter, PlatformName } from './platform-adapter'
import { PLATFORMS } from './platform-adapter'

// eslint-disable-next-line no-var
declare global { var __platformRegistry: Map<PlatformName, BasePlatformAdapter> | undefined }

function registry(): Map<PlatformName, BasePlatformAdapter> {
  if (!global.__platformRegistry) global.__platformRegistry = new Map()
  return global.__platformRegistry
}

async function ensureRegistered(): Promise<void> {
  if (registry().size > 0) return
  const { EmailAdapter }        = await import('./adapters/email-adapter')
  const { ImapPlatformAdapter } = await import('./adapters/imap-platform-adapter')
  registry().set('email',        new EmailAdapter())
  registry().set('outlook-imap', new ImapPlatformAdapter('outlook-imap', 'outlook-imap-config.json'))
  registry().set('qq-imap',      new ImapPlatformAdapter('qq-imap',      'qq-imap-config.json'))
}

export function register(adapter: BasePlatformAdapter): void {
  registry().set(adapter.name, adapter)
}

export async function getAsync(name: PlatformName): Promise<BasePlatformAdapter | undefined> {
  await ensureRegistered()
  return registry().get(name)
}

export function get(name: PlatformName): BasePlatformAdapter | undefined {
  return registry().get(name)
}

export function all(): BasePlatformAdapter[] {
  return [...registry().values()]
}

export function getConnected(): BasePlatformAdapter[] {
  return all().filter(a => a.getState().status === 'connected')
}

export function isPlatform(s: string): s is PlatformName {
  return (PLATFORMS as readonly string[]).includes(s)
}
