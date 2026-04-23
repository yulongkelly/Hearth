'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plug2 } from 'lucide-react'
import { GmailCard } from '@/components/integrations/gmail-card'
import { CalendarCard } from '@/components/integrations/calendar-card'
import { PlaidCard } from '@/components/integrations/plaid-card'
import { WechatCard } from '@/components/integrations/wechat-card'
import { QqCard } from '@/components/integrations/qq-card'
import { TelegramCard } from '@/components/integrations/telegram-card'
import { DiscordCard } from '@/components/integrations/discord-card'

function IntegrationsContent() {
  const searchParams = useSearchParams()
  const oauthError = searchParams.get('error')

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center border-b border-border px-6 h-14 flex-shrink-0">
        <Plug2 className="h-4 w-4 text-muted-foreground mr-2" />
        <h1 className="text-base font-semibold">Connected Apps</h1>
      </div>

      <div className="flex flex-col gap-4 p-6 max-w-2xl">
        <p className="text-sm text-muted-foreground">
          Connect services to let Hearth read and act on your behalf — all AI processing stays local on your machine.
        </p>

        <GmailCard initialError={oauthError} />
        <CalendarCard initialError={oauthError} />
        <PlaidCard />
        <WechatCard />
        <QqCard />
        <TelegramCard />
        <DiscordCard />
      </div>
    </div>
  )
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <IntegrationsContent />
    </Suspense>
  )
}
