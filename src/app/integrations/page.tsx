'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plug2, MessageSquare, Send, Hash, Mail } from 'lucide-react'
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

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zm2.521-10.123a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
    </svg>
  )
}

function MatrixIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M.632.55v22.9H2.28V24H0V0h2.28v.55zm7.043 7.26v1.157h.033a3.312 3.312 0 0 1 1.117-1.024c.433-.245.936-.365 1.5-.365.54 0 1.033.107 1.481.314.448.208.785.582 1.02 1.108.254-.374.6-.706 1.034-.992.434-.287.95-.43 1.546-.43.453 0 .872.056 1.26.167.388.11.716.286.993.53.276.245.489.559.646.951.152.392.23.863.23 1.417v5.728h-2.349V11.52c0-.286-.01-.559-.032-.812a1.755 1.755 0 0 0-.18-.66 1.106 1.106 0 0 0-.438-.448c-.194-.11-.457-.166-.785-.166-.332 0-.6.064-.803.189a1.38 1.38 0 0 0-.48.499 1.946 1.946 0 0 0-.231.696 5.56 5.56 0 0 0-.06.785v4.768h-2.35v-4.8c0-.254-.006-.503-.019-.752a2.02 2.02 0 0 0-.156-.696 1.135 1.135 0 0 0-.42-.508c-.194-.125-.476-.19-.854-.19-.111 0-.259.024-.44.074-.18.051-.355.144-.527.273a1.562 1.562 0 0 0-.42.534c-.11.23-.167.524-.167.883v5.182H5.47V7.81zm15.693 15.64V.55H21.72V0H24v24h-2.28v-.55z"/>
    </svg>
  )
}

function MattermostIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.066 0C5.584-.02.014 5.235 0 11.816v.217C.022 19.58 5.794 24 12.252 24H24V11.933C24 5.315 18.64 0 12.066 0zm-.176 18.667a6.667 6.667 0 1 1 0-13.334 6.667 6.667 0 0 1 0 13.334z"/>
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

        <PlatformCard
          platform="slack"
          label="Slack"
          description="Read and send messages in Slack workspaces"
          icon={SlackIcon}
          iconBg="bg-purple-500/10"
          iconColor="text-purple-500"
          authType="token"
          tokenFields={[
            { key: 'token',  label: 'Bot Token',  placeholder: 'xoxb-… Bot Token' },
            { key: 'secret', label: 'App Token',  placeholder: 'xapp-… App-Level Token' },
          ]}
          tokenHelp={{
            url:      'https://api.slack.com/apps',
            text:     'Create a Slack App → Enable Socket Mode (generates App Token xapp-…) → OAuth & Permissions → install to workspace (generates Bot Token xoxb-…). Add bot scopes: channels:history, chat:write, users:read.',
            linkText: 'Open Slack API Dashboard',
          }}
          connectedNote="Messages in channels the bot is a member of are stored locally."
        />

        <PlatformCard
          platform="whatsapp"
          label="WhatsApp"
          description="Scan a QR code to connect your WhatsApp account"
          icon={WhatsAppIcon}
          iconBg="bg-green-600/10"
          iconColor="text-green-600"
          authType="qr"
          connectingLabel="Initialising WhatsApp Web…"
          connectedNote="Do not open WhatsApp Web in a browser while Hearth is connected."
        />

        <PlatformCard
          platform="matrix"
          label="Matrix"
          description="Connect to any Matrix homeserver (matrix.org, Element, self-hosted)"
          icon={MatrixIcon}
          iconBg="bg-slate-500/10"
          iconColor="text-slate-400"
          authType="token"
          tokenFields={[
            { key: 'token',  label: 'Access Token',   placeholder: 'syt_… or MDAxY…' },
            { key: 'secret', label: 'Homeserver URL',  placeholder: 'https://matrix.org' },
          ]}
          tokenHelp={{
            url:      'https://app.element.io/#/user-settings/help-about',
            text:     'In Element: Settings → Help & About → scroll to the bottom → copy Access Token. Your homeserver URL is shown on the same page (e.g. https://matrix.org).',
            linkText: 'Open Element Settings',
          }}
          connectedNote="Messages from joined rooms are stored locally."
        />

        <PlatformCard
          platform="email"
          label="Email"
          description="Read and send email via IMAP/SMTP (Gmail, Outlook, Yahoo…)"
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

        <PlatformCard
          platform="mattermost"
          label="Mattermost"
          description="Connect to a self-hosted or cloud Mattermost instance"
          icon={MattermostIcon}
          iconBg="bg-blue-600/10"
          iconColor="text-blue-500"
          authType="token"
          tokenFields={[
            { key: 'token',  label: 'Personal Access Token', placeholder: 'Paste your PAT…' },
            { key: 'secret', label: 'Server URL',             placeholder: 'https://mattermost.example.com' },
          ]}
          tokenHelp={{
            url:      'https://docs.mattermost.com/developer/personal-access-tokens.html',
            text:     'In Mattermost: Profile → Security → Personal Access Tokens → Create Token. Paste the token and your server URL below.',
            linkText: 'Mattermost PAT docs',
          }}
          connectedNote="Messages posted in joined channels are stored locally."
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
