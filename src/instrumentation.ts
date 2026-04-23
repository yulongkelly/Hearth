export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSecureStorage } = await import('./lib/secure-storage')
    await initSecureStorage()

    // Auto-restart WeChat bot if a prior session file exists, using the last puppet type
    const fs   = (await import('fs')).default
    const os   = (await import('os')).default
    const path = (await import('path')).default
    const hearthDir  = path.join(os.homedir(), '.hearth')
    const sessionDir = path.join(hearthDir, 'wechat-session')
    if (fs.existsSync(sessionDir)) {
      const { startBot, isXpAvailable } = await import('./lib/wechat-bot')
      let puppet: 'wechat4u' | 'xp' = 'wechat4u'
      try {
        const saved = fs.readFileSync(path.join(hearthDir, 'wechat-puppet'), 'utf8').trim()
        if (saved === 'xp' && isXpAvailable()) puppet = 'xp'
      } catch {}
      startBot(puppet).catch(() => {})
    }
  }
}
