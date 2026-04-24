'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plug2, MessageSquare, Send, Hash } from 'lucide-react'
import { GmailCard } from '@/components/integrations/gmail-card'
import { CalendarCard } from '@/components/integrations/calendar-card'
import { PlaidCard } from '@/components/integrations/plaid-card'
import { PlatformCard } from '@/components/integrations/platform-card'
import { MyConnectionsSection } from '@/components/integrations/my-connections-section'

function WechatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.714 4.175 6.95 4.175.842 0 1.61-.116 2.328-.327a.7.7 0 0 1 .588.08l1.566.915a.28.28 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.48.48 0 0 1 .179-.545C23.024 18.48 24 17.04 24 15.4c0-2.96-2.69-5.466-7.062-4.542zm-3.502 3.025c.531 0 .962.436.962.973a.967.967 0 0 1-.962.972.967.967 0 0 1-.963-.972c0-.537.431-.973.963-.973zm4.56 0c.531 0 .962.436.962.973a.967.967 0 0 1-.962.972.967.967 0 0 1-.963-.972c0-.537.431-.973.963-.973z"/>
    </svg>
  )
}

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

        <PlatformCard
          platform="wechat"
          label="WeChat"
          description="Read and send WeChat messages"
          icon={WechatIcon}
          iconBg="bg-green-500/10"
          iconColor="text-green-500"
          authType="qr"
          connectingLabel="Resuming WeChat session…"
          connectedNote="Messages received while Hearth is running are stored locally."
        />

        <PlatformCard
          platform="qq"
          label="QQ"
          description="Read and send QQ messages via Official Bot API"
          icon={MessageSquare}
          iconBg="bg-blue-500/10"
          iconColor="text-blue-500"
          authType="token"
          tokenFields={[
            { key: 'token',  label: 'App ID',        placeholder: 'Your QQ Bot App ID' },
            { key: 'secret', label: 'Client Secret', placeholder: 'Your QQ Bot Client Secret' },
          ]}
          tokenHelp={{
            url:      'https://q.qq.com/qqbot/',
            text:     'Log in at q.qq.com → 机器人 (Bot) → open your bot → 开发设置 (Dev Settings). Copy the AppID into App ID and the AppSecret into Client Secret.',
            linkText: 'Open QQ Bot Dashboard',
          }}
          connectedNote="Messages received while Hearth is running are stored locally."
        />

        <PlatformCard
          platform="telegram"
          label="Telegram"
          description="Receive and send messages via a bot"
          icon={Send}
          iconBg="bg-blue-400/10"
          iconColor="text-blue-400"
          authType="token"
          tokenLabel="Paste bot token…"
          tokenHelp={{
            url:         'tg://resolve?domain=BotFather',
            text:        'Message @BotFather on Telegram → /newbot → follow prompts. BotFather will send you a token like 123456789:AAF…. Paste it below.',
            linkText:    'Open in Telegram App',
            altUrl:      'https://web.telegram.org/k/#@BotFather',
            altLinkText: 'Open in Telegram Web',
          }}
          connectedNote="Message this bot in Telegram to have Hearth read and reply to you."
        />

        <PlatformCard
          platform="discord"
          label="Discord"
          description="Monitor servers and send messages via a bot"
          icon={Hash}
          iconBg="bg-indigo-500/10"
          iconColor="text-indigo-400"
          authType="token"
          tokenLabel="Paste bot token…"
          tokenHelp={{
            url:      'https://discord.com/developers/applications',
            text:     'Open Developer Portal → New Application → Bot → Privileged Gateway Intents: enable Message Content Intent → Reset Token → copy and paste it below.',
            linkText: 'Open Developer Portal',
          }}
          connectedNote="Messages from servers where this bot is a member are stored locally."
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
