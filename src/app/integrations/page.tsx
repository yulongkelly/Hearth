'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plug2, Send, Hash } from 'lucide-react'
import { GmailCard } from '@/components/integrations/gmail-card'
import { CalendarCard } from '@/components/integrations/calendar-card'
import { PlaidCard } from '@/components/integrations/plaid-card'
import { WechatCard } from '@/components/integrations/wechat-card'
import { ComingSoonCard } from '@/components/integrations/coming-soon-card'

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

        <ComingSoonCard
          icon={Send}
          iconBg="bg-blue-500/10"
          iconColor="text-blue-400"
          name="Telegram"
          description="Get message summaries and send replies via AI."
        />
        <ComingSoonCard
          icon={Hash}
          iconBg="bg-purple-500/10"
          iconColor="text-purple-400"
          name="Slack"
          description="Summarize channels and draft replies with local AI."
        />
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
