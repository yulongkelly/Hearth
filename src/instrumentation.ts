export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSecureStorage } = await import('./lib/secure-storage')
    await initSecureStorage()

    const { EmailAdapter } = await import('./lib/adapters/email-adapter')
    const { register }     = await import('./lib/platform-registry')

    const email = new EmailAdapter()
    register(email)
    await email.tryAutoConnect()
  }
}
