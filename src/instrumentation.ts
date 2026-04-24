export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSecureStorage } = await import('./lib/secure-storage')
    await initSecureStorage()

    const { WechatAdapter }   = await import('./lib/adapters/wechat-adapter')
    const { QqAdapter }       = await import('./lib/adapters/qq-adapter')
    const { TelegramAdapter } = await import('./lib/adapters/telegram-adapter')
    const { DiscordAdapter }  = await import('./lib/adapters/discord-adapter')
    const { register }        = await import('./lib/platform-registry')

    const adapters = [new WechatAdapter(), new QqAdapter(), new TelegramAdapter(), new DiscordAdapter()]
    adapters.forEach(register)
    await Promise.allSettled(adapters.map(a => a.tryAutoConnect()))
  }
}
