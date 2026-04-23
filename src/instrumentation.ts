export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSecureStorage } = await import('./lib/secure-storage')
    await initSecureStorage()

    // Auto-restart WeChat bot if a prior session file exists
    const fs   = (await import('fs')).default
    const os   = (await import('os')).default
    const path = (await import('path')).default
    const hearthDir = path.join(os.homedir(), '.hearth')
    const sessionDir = path.join(hearthDir, 'wechat-session')
    if (fs.existsSync(sessionDir)) {
      const { startBot } = await import('./lib/wechat-bot')
      startBot().catch(() => {})
    }

    // Auto-restart QQ if a prior session exists
    const qqSessionDir = path.join(hearthDir, 'qq-session')
    if (fs.existsSync(qqSessionDir)) {
      const { startQqBot, savedQqUin } = await import('./lib/qq-bot')
      startQqBot(savedQqUin() ?? undefined).catch(() => {})
    }

    // Auto-restart Telegram if a token was saved
    const { loadTelegramToken, startTelegramBot } = await import('./lib/telegram-bot')
    if (loadTelegramToken()) startTelegramBot().catch(() => {})

    // Auto-restart Discord if a token was saved
    const { loadDiscordToken, startDiscordBot } = await import('./lib/discord-bot')
    if (loadDiscordToken()) startDiscordBot().catch(() => {})
  }
}
