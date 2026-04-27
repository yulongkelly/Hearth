'use client'

import { Mail } from 'lucide-react'
import { PlatformCard } from './platform-card'

export function QQMailCard() {
  return (
    <PlatformCard
      platform="qq-imap"
      label="QQ Mail"
      description="Read and send email via IMAP (qq.com)"
      icon={Mail}
      iconBg="bg-red-500/10"
      iconColor="text-red-400"
      authType="token"
      tokenFields={[
        { key: 'token',  label: 'QQ Email',           placeholder: 'xxxxxxxxx@qq.com' },
        { key: 'secret', label: 'Authorization Code',  placeholder: '16-character code — not your QQ password' },
      ]}
      tokenHelp={{
        url:      'https://mail.qq.com',
        text:     'QQ Mail uses an Authorization Code for IMAP, not your QQ password. In QQ Mail web: Settings (设置) → Account (账户) → POP3/IMAP/SMTP Service → enable IMAP/SMTP → click "Generate Authorization Code" (生成授权码) and follow the SMS verification.',
        linkText: 'Open QQ Mail',
      }}
      connectedNote="Connected via IMAP. Uses an authorization code from QQ Mail settings, not your QQ login password."
    />
  )
}
