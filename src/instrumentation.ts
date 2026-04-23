export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSecureStorage } = await import('./lib/secure-storage')
    await initSecureStorage()

    // Auto-restart WeChat bot if a prior session file exists
    const fs   = (await import('fs')).default
    const os   = (await import('os')).default
    const path = (await import('path')).default
    const sessionDir = path.join(os.homedir(), '.hearth', 'wechat-session')
    if (fs.existsSync(sessionDir)) {
      const { startBot } = await import('./lib/wechat-bot')
      startBot().catch(() => {})
    }
  }
}
