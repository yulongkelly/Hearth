import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Sidebar } from '@/components/layout/sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { ReminderBanner } from '@/components/reminders/reminder-banner'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Hearth — Your Private AI Assistant',
  description: 'Privacy-first AI personal assistant powered by local models. Your data never leaves your home.',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#0a0a0f',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={inter.className} style={{ backgroundColor: '#0a0a0f' }}>
        <div className="flex h-screen overflow-hidden bg-background">
          <ReminderBanner />
          {/* Desktop sidebar — hidden on mobile */}
          <Sidebar />
          <main className="flex flex-1 flex-col overflow-hidden md:ml-16 pb-16 md:pb-0">
            {children}
          </main>
          {/* Mobile bottom nav — hidden on desktop */}
          <MobileNav />
        </div>
      </body>
    </html>
  )
}
