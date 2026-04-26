'use client'

import { useState, useEffect } from 'react'
import { Mail, CheckCircle2, Loader2, Copy, Check, ExternalLink, Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

const REDIRECT_URI = 'http://localhost:3000/api/auth/callback/microsoft'

interface OutlookStatus {
  configured: boolean
  connected: boolean
  accounts: AccountInfo[]
}

interface AccountInfo {
  email: string
  nickname?: string | null
}

interface OutlookCardProps {
  initialError?: string | null
}

interface NicknameEditState {
  email: string
  value: string
  saving: boolean
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  if (local.length <= 1) return `${local}***@${domain}`
  return `${local[0]}***${local[local.length - 1]}@${domain}`
}

const errorMessages: Record<string, string> = {
  access_denied:         'You cancelled the sign-in. Click Connect to try again.',
  token_exchange_failed: 'Sign-in failed — your Client ID or Secret may be wrong. Double-check and try again.',
}

export function OutlookCard({ initialError }: OutlookCardProps) {
  const [status, setStatus]             = useState<OutlookStatus | null>(null)
  const [showSetup, setShowSetup]       = useState(false)
  const [clientId, setClientId]         = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [copied, setCopied]             = useState(false)
  const [nicknameEdit, setNicknameEdit] = useState<NicknameEditState | null>(null)

  useEffect(() => {
    fetch('/api/outlook/status')
      .then(r => r.json())
      .then((data: OutlookStatus) => setStatus(data))
      .catch(() => setStatus({ configured: false, connected: false, accounts: [] }))
  }, [])

  function copyRedirectUri() {
    navigator.clipboard.writeText(REDIRECT_URI)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/settings/microsoft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      })
      if (!res.ok) {
        const data = await res.json()
        setSaveError(data.error ?? 'Failed to save')
        return
      }
      window.location.href = '/api/auth/microsoft'
    } catch {
      setSaveError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect(email: string) {
    setDisconnecting(email)
    await fetch('/api/outlook/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect', email }),
    })
    setStatus(prev => prev ? {
      ...prev,
      accounts: prev.accounts.filter(a => a.email !== email),
      connected: prev.accounts.filter(a => a.email !== email).length > 0,
    } : prev)
    setDisconnecting(null)
  }

  async function handleSaveNickname() {
    if (!nicknameEdit) return
    const { email, value } = nicknameEdit
    setNicknameEdit(prev => prev ? { ...prev, saving: true } : null)
    await fetch('/api/outlook/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, nickname: value }),
    })
    setStatus(prev => prev ? {
      ...prev,
      accounts: prev.accounts.map(a => a.email === email ? { ...a, nickname: value.trim() || null } : a),
    } : prev)
    setNicknameEdit(null)
  }

  const loading     = status === null
  const configured  = status?.configured ?? false
  const accounts    = status?.accounts ?? []
  const hasAccounts = accounts.length > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
              <Mail className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Outlook / Microsoft</CardTitle>
              <CardDescription className="text-xs">
                Read and send email via Microsoft Graph API.
              </CardDescription>
            </div>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {hasAccounts && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <Badge variant="success" className="text-[10px]">
                {accounts.length === 1 ? 'Connected' : `${accounts.length} accounts`}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {initialError && !hasAccounts && (
          <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2">
            {errorMessages[initialError] ?? 'Something went wrong. Please try again.'}
          </p>
        )}

        {hasAccounts && (
          <div className="space-y-2">
            {accounts.map((acc: AccountInfo) => (
              <div key={acc.email} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{maskEmail(acc.email)}</p>
                  {nicknameEdit?.email === acc.email ? (
                    <div className="flex items-center gap-1 mt-1">
                      <Input
                        className="h-6 text-[11px] px-1.5 py-0"
                        value={nicknameEdit.value}
                        onChange={e => setNicknameEdit(prev => prev ? { ...prev, value: e.target.value } : null)}
                        placeholder="nickname (e.g. work)"
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveNickname(); if (e.key === 'Escape') setNicknameEdit(null) }}
                        autoFocus
                      />
                      <Button size="sm" className="h-6 px-2 text-[11px]" onClick={handleSaveNickname} disabled={nicknameEdit.saving}>
                        {nicknameEdit.saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => setNicknameEdit(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 mt-0.5">
                      {acc.nickname && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{acc.nickname}</Badge>}
                      <button
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setNicknameEdit({ email: acc.email, value: acc.nickname ?? '', saving: false })}
                        title="Set nickname"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDisconnect(acc.email)}
                  disabled={disconnecting === acc.email}
                  className="h-7 px-2 text-destructive hover:text-destructive flex-shrink-0"
                  title="Disconnect"
                >
                  {disconnecting === acc.email
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />
                  }
                </Button>
              </div>
            ))}

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => { window.location.href = '/api/auth/microsoft' }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Add another account
            </Button>
          </div>
        )}

        {!loading && !hasAccounts && !configured && !showSetup && (
          <Button size="sm" onClick={() => setShowSetup(true)}>
            Connect Outlook
          </Button>
        )}

        {!loading && !hasAccounts && configured && !showSetup && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => { window.location.href = '/api/auth/microsoft' }}>
              Connect Outlook
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowSetup(true)} className="text-xs text-muted-foreground">
              Change credentials
            </Button>
          </div>
        )}

        {!loading && showSetup && (
          <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium text-foreground">
              One-time setup — takes about 3 minutes
            </p>

            <ol className="space-y-2 text-xs text-muted-foreground list-none">
              {[
                <>Go to the <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade" target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Azure App Registration page <ExternalLink className="h-3 w-3" /></a> and sign in with your Microsoft account.</>,
                <>Set <strong className="text-foreground">Name</strong> to <strong className="text-foreground">Hearth</strong>. Under <strong className="text-foreground">Supported account types</strong>, select <strong className="text-foreground">Accounts in any organizational directory and personal Microsoft accounts</strong>. Click <strong className="text-foreground">Register</strong>.</>,
                <>Copy the <strong className="text-foreground">Application (client) ID</strong> shown on the overview page — paste it below.</>,
                <>In the left sidebar go to <strong className="text-foreground">Certificates &amp; secrets → New client secret</strong>. Set any description and expiry, click <strong className="text-foreground">Add</strong>. Copy the <strong className="text-foreground">Value</strong> immediately — paste it below.</>,
                <div className="flex-1 space-y-1">
                  <span>Go to <strong className="text-foreground">Authentication → Add a platform → Web</strong>. Add this redirect URI, then click <strong className="text-foreground">Configure</strong>:</span>
                  <div className="flex items-center gap-2 rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">
                    <span className="flex-1 select-all">{REDIRECT_URI}</span>
                    <button onClick={copyRedirectUri} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>,
                <>Go to <strong className="text-foreground">API permissions → Add a permission → Microsoft Graph → Delegated permissions</strong>. Add: <strong className="text-foreground">Mail.Read</strong>, <strong className="text-foreground">Mail.Send</strong>, <strong className="text-foreground">User.Read</strong>, <strong className="text-foreground">offline_access</strong>. Click <strong className="text-foreground">Add permissions</strong>.</>,
              ].map((step, i) => (
                <li key={i} className="flex gap-2 items-start">
                  <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px] font-bold mt-px">{i + 1}</span>
                  <span className="flex-1">{step}</span>
                </li>
              ))}
            </ol>

            <div className="space-y-2">
              <Input
                placeholder="Application (client) ID"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
              />
              <Input
                placeholder="Client Secret Value"
                type="password"
                value={clientSecret}
                onChange={e => setClientSecret(e.target.value)}
              />
            </div>

            {saveError && <p className="text-xs text-destructive">{saveError}</p>}

            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowSetup(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!clientId.trim() || !clientSecret.trim() || saving}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Save & Connect
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
