'use client'

import { Mail } from 'lucide-react'
import { PlatformCard } from './platform-card'

export function OutlookCard() {
  return (
    <PlatformCard
      platform="outlook-imap"
      label="Outlook / Hotmail / Live"
      description="Read and send email via IMAP (outlook.com, hotmail.com, live.com)"
      icon={Mail}
      iconBg="bg-blue-500/10"
      iconColor="text-blue-400"
      authType="token"
      tokenFields={[
        { key: 'token',  label: 'Email Address', placeholder: 'you@outlook.com' },
        { key: 'secret', label: 'App Password',  placeholder: '16-character app password' },
      ]}
      tokenHelp={{
        url:      'https://account.live.com/proofs/AppPassword',
        text:     'Microsoft requires an App Password for IMAP when two-step verification is on. Go to your Microsoft account security page → Advanced security options → App passwords → Create a new app password. Paste the 16-character code here instead of your normal password.',
        linkText: 'Create Microsoft App Password',
      }}
      connectedNote="Connected via IMAP. outlook.com, hotmail.com, and live.com are all supported."
    />
  )
}
