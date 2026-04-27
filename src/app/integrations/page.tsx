'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plug2, Mail } from 'lucide-react'
import { GmailCard } from '@/components/integrations/gmail-card'
import { OutlookCard } from '@/components/integrations/outlook-card'
import { QQMailCard } from '@/components/integrations/qq-mail-card'
import { CalendarCard } from '@/components/integrations/calendar-card'
import { PlatformCard } from '@/components/integrations/platform-card'
import { MyConnectionsSection } from '@/components/integrations/my-connections-section'

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
        <OutlookCard />
        <QQMailCard />
        <CalendarCard initialError={oauthError} />

        <PlatformCard
          platform="email"
          label="Email"
          description="Read and send email via IMAP/SMTP (Yahoo, iCloud, or any other provider)"
          icon={Mail}
          iconBg="bg-orange-500/10"
          iconColor="text-orange-500"
          authType="token"
          tokenFields={[
            { key: 'token',  label: 'Email Address', placeholder: 'you@gmail.com' },
            { key: 'secret', label: 'Password',       placeholder: 'App password or account password' },
          ]}
          tokenHelp={{
            url:      'https://myaccount.google.com/apppasswords',
            text:     'For Gmail: enable 2-Step Verification, then create an App Password (select "Mail" + your device). Use that 16-character password here instead of your account password.',
            linkText: 'Create Gmail App Password',
          }}
          connectedNote="Provider auto-detected from email domain. Gmail, Outlook, Yahoo, iCloud supported."
        />

        <div className="border-t border-border pt-4">
          <MyConnectionsSection />
        </div>
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
