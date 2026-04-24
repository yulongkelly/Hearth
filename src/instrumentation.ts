export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSecureStorage } = await import('./lib/secure-storage')
    await initSecureStorage()

    const { WechatAdapter }      = await import('./lib/adapters/wechat-adapter')
    const { QqAdapter }          = await import('./lib/adapters/qq-adapter')
    const { TelegramAdapter }    = await import('./lib/adapters/telegram-adapter')
    const { DiscordAdapter }     = await import('./lib/adapters/discord-adapter')
    const { SlackAdapter }       = await import('./lib/adapters/slack-adapter')
    const { WhatsAppAdapter }    = await import('./lib/adapters/whatsapp-adapter')
    const { MatrixAdapter }      = await import('./lib/adapters/matrix-adapter')
    const { EmailAdapter }       = await import('./lib/adapters/email-adapter')
    const { MattermostAdapter }  = await import('./lib/adapters/mattermost-adapter')
    const { register }           = await import('./lib/platform-registry')

    const adapters = [
      new WechatAdapter(), new QqAdapter(), new TelegramAdapter(), new DiscordAdapter(),
      new SlackAdapter(), new WhatsAppAdapter(), new MatrixAdapter(), new EmailAdapter(), new MattermostAdapter(),
    ]
    adapters.forEach(register)
    await Promise.allSettled(adapters.map(a => a.tryAutoConnect()))
  }
}
