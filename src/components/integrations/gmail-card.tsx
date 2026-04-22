'use client'

import { useState, useEffect } from 'react'
import { Mail, CheckCircle2, Loader2, Copy, Check, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { GmailStatus } from '@/lib/types'

type CardState = 'loading' | 'connected' | 'disconnected'

const REDIRECT_URI = 'http://localhost:3000/api/auth/callback/google'

const errorMessages: Record<string, string> = {
  access_denied: 'You cancelled the sign-in. Click Connect to try again.',
  token_exchange_failed: 'Sign-in failed — your Client ID or Secret may be wrong. Double-check and try again.',
}

interface GmailCardProps {
  initialError?: string | null
}

export function GmailCard({ initialError }: GmailCardProps) {
  const [cardState, setCardState] = useState<CardState>('loading')
  const [showSetup, setShowSetup] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/gmail/status')
      .then(r => r.json())
      .then(({ connected }: GmailStatus) => setCardState(connected ? 'connected' : 'disconnected'))
      .catch(() => setCardState('disconnected'))
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
      const res = await fetch('/api/settings/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      })
      if (!res.ok) {
        const data = await res.json()
        setSaveError(data.error ?? 'Failed to save')
        return
      }
      window.location.href = '/api/auth/gmail'
    } catch {
      setSaveError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    await fetch('/api/gmail/disconnect', { method: 'POST' })
    setCardState('disconnected')
    setDisconnecting(false)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
              <Mail className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Gmail</CardTitle>
              <CardDescription className="text-xs">
                Read and summarize your inbox with local AI.
              </CardDescription>
            </div>
          </div>
          {cardState === 'connected' && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <Badge variant="success" className="text-[10px]">Connected</Badge>
            </div>
          )}
          {cardState === 'loading' && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* OAuth error from redirect */}
        {initialError && cardState !== 'connected' && (
          <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2">
            {errorMessages[initialError] ?? 'Something went wrong. Please try again.'}
          </p>
        )}

        {/* Connected state */}
        {cardState === 'connected' && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Gmail account linked.</p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-destructive hover:text-destructive"
            >
              {disconnecting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Disconnect
            </Button>
          </div>
        )}

        {/* Disconnected — show connect button or setup form */}
        {cardState === 'disconnected' && !showSetup && (
          <Button size="sm" onClick={() => setShowSetup(true)}>
            Connect Gmail
          </Button>
        )}

        {cardState === 'disconnected' && showSetup && (
          <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium text-foreground">
              One-time setup — takes about 2 minutes
            </p>

            {/* Steps */}
            <ol className="space-y-2 text-xs text-muted-foreground list-none">
              {[
                <>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Google Cloud Console <ExternalLink className="h-3 w-3" /></a>. <span className="italic">If you already have a project set up, skip to step 4.</span></>,
                <><span className="text-muted-foreground/60 italic">(New project only)</span> Set <strong className="text-foreground">App name</strong> to <strong className="text-foreground">Hearth</strong> and select your email as <strong className="text-foreground">User support email</strong>. Click <strong className="text-foreground">Next</strong>.</>,
                <><span className="text-muted-foreground/60 italic">(New project only)</span> Set <strong className="text-foreground">Audience</strong> to <strong className="text-foreground">External</strong>, click <strong className="text-foreground">Create</strong>. Skip the rest and click <strong className="text-foreground">Create</strong> at the bottom.</>,
                <>In the left sidebar go to <strong className="text-foreground">Audience → Test users → Add users</strong>. Add your Gmail address and click <strong className="text-foreground">Save</strong>. <span className="italic">If you already have a client set up, skip to step 7.</span></>,
                <>In the left sidebar click <strong className="text-foreground">Clients → Create client</strong>. Set type to <strong className="text-foreground">Web application</strong>.</>,
                <div className="flex-1 space-y-1">
                  <span>Under <strong className="text-foreground">Authorized redirect URIs</strong> add this URL, then click <strong className="text-foreground">Create</strong>:</span>
                  <div className="flex items-center gap-2 rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">
                    <span className="flex-1 select-all">{REDIRECT_URI}</span>
                    <button onClick={copyRedirectUri} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>,
                <>On the <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Clients page <ExternalLink className="h-3 w-3" /></a>, click the client name you want to use, then copy the <strong className="text-foreground">Client ID</strong> and <strong className="text-foreground">Client Secret</strong> and paste below. You can always create a new secret and disable/delete old ones you no longer use.</>,
              ].map((step, i) => (
                <li key={i} className="flex gap-2 items-start">
                  <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px] font-bold mt-px">{i + 1}</span>
                  <span className="flex-1">{step}</span>
                </li>
              ))}
            </ol>

            {/* Credential inputs */}
            <div className="space-y-2">
              <Input
                placeholder="Client ID  (ends in .apps.googleusercontent.com)"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
              />
              <Input
                placeholder="Client Secret"
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
