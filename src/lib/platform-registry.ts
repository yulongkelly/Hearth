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
  // Lazily instantiate all adapters if instrumentation hasn't run yet
  // (happens in Next.js dev mode when route handlers load before the instrumentation hook)
  const [
    { WechatAdapter },
    { QqAdapter },
    { TelegramAdapter },
    { DiscordAdapter },
    { SlackAdapter },
    { WhatsAppAdapter },
    { MatrixAdapter },
    { EmailAdapter },
    { MattermostAdapter },
  ] = await Promise.all([
    import('./adapters/wechat-adapter'),
    import('./adapters/qq-adapter'),
    import('./adapters/telegram-adapter'),
    import('./adapters/discord-adapter'),
    import('./adapters/slack-adapter'),
    import('./adapters/whatsapp-adapter'),
    import('./adapters/matrix-adapter'),
    import('./adapters/email-adapter'),
    import('./adapters/mattermost-adapter'),
  ])
  ;[
    new WechatAdapter(), new QqAdapter(), new TelegramAdapter(), new DiscordAdapter(),
    new SlackAdapter(), new WhatsAppAdapter(), new MatrixAdapter(), new EmailAdapter(), new MattermostAdapter(),
  ].forEach(a => registry().set(a.name, a))
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
