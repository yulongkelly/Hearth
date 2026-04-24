'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2, CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PlatformName, ConnectStatus } from '@/lib/platform-adapter'

interface PlatformState {
  platform: PlatformName
  status:   ConnectStatus
  qrImage:  string | null
  identity: string | null
  meta:     Record<string, unknown>
  error:    string | null
}

interface TokenField {
  key:         'token' | 'secret'
  label:       string
  placeholder: string
}

interface PlatformCardProps {
  platform:        PlatformName
  label:           string
  description:     string
  icon:            React.ComponentType<{ className?: string }>
  iconBg:          string
  iconColor:       string
  authType:        'qr' | 'token'
  connectingLabel?: string
  tokenLabel?:     string  // single-field mode placeholder
  tokenFields?:    TokenField[]  // multi-field mode (replaces tokenLabel)
  tokenHelp?:      { url: string; text: string; linkText: string }
  connectedNote?:  string
}

const TERMINAL = new Set<ConnectStatus>(['connected', 'error'])

export function PlatformCard({
  platform, label, description, icon: Icon, iconBg, iconColor,
  authType, connectingLabel, tokenLabel, tokenFields, tokenHelp, connectedNote,
}: PlatformCardProps) {
  const [state, setState]                 = useState<PlatformState | null>(null)
  const [token, setToken]                 = useState('')
  const [secret, setSecret]               = useState('')
  const [connecting, setConnecting]       = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const esRef      = useRef<EventSource | null>(null)
  const statusRef  = useRef<ConnectStatus>('stopped')

  function subscribe() {
    esRef.current?.close()
    const es = new EventSource(`/api/messaging/${platform}/status`)
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const s = JSON.parse(e.data) as PlatformState
        statusRef.current = s.status
        setState(s)
        if (TERMINAL.has(s.status)) { es.close(); if (esRef.current === es) esRef.current = null }
      } catch {}
    }
    es.onerror = () => {
      es.close()
      if (esRef.current !== es) return
      esRef.current = null
      // Server closed stream before we reached a terminal state — reconnect
      if (!TERMINAL.has(statusRef.current)) setTimeout(subscribe, 800)
    }
  }

  useEffect(() => {
    subscribe()
    return () => { esRef.current?.close(); esRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleConnect() {
    setConnecting(true)
    const body: Record<string, unknown> = {}
    if (token.trim())  body.token  = token.trim()
    if (secret.trim()) body.secret = secret.trim()
    await fetch(`/api/messaging/${platform}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setConnecting(false)
    setToken('')
    setSecret('')
    subscribe()
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    await fetch(`/api/messaging/${platform}/disconnect`, { method: 'POST' })
    setDisconnecting(false)
    subscribe()
  }

  const status         = state?.status   ?? 'stopped'
  const hasToken       = (state?.meta?.hasToken ?? state?.meta?.hasCredentials) as boolean | undefined
  const multiField     = !!tokenFields?.length
  const canConnectMulti = multiField
    ? (tokenFields!.every(f => f.key === 'token' ? !!token.trim() : !!secret.trim()) || !!hasToken)
    : (!!token.trim() || !!hasToken)

  const guilds = Array.isArray(state?.meta?.guilds)
    ? (state!.meta.guilds as string[])
    : []

  const canConnect = authType === 'qr' || !!token.trim() || !!hasToken

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
              <Icon className={`h-5 w-5 ${iconColor}`} />
            </div>
            <div>
              <CardTitle className="text-sm">{label}</CardTitle>
              <CardDescription className="text-xs">{description}</CardDescription>
            </div>
          </div>
          {status === 'connected' && (
            <div className="flex items-center gap-1.5 text-[10px] text-green-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">

        {/* ── Stopped ── */}
        {status === 'stopped' && (
          <div className="space-y-3">
            {authType === 'qr' && (
              <p className="text-xs text-muted-foreground">
                Scan a QR code with the {label} mobile app to connect your account.
              </p>
            )}
            {authType === 'token' && !hasToken && tokenHelp && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                <p className="text-[10px] text-muted-foreground leading-relaxed">{tokenHelp.text}</p>
                <a href={tokenHelp.url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                  {tokenHelp.linkText} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            )}
            {authType === 'token' ? (
              <div className="space-y-2">
                {multiField ? (
                  tokenFields!.map(f => (
                    <Input key={f.key}
                      className="h-8 text-xs font-mono"
                      placeholder={hasToken ? `Update ${f.label}…` : f.placeholder}
                      value={f.key === 'token' ? token : secret}
                      onChange={e => f.key === 'token' ? setToken(e.target.value) : setSecret(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && canConnectMulti) handleConnect() }}
                    />
                  ))
                ) : (
                  <Input
                    className="h-8 text-xs font-mono"
                    placeholder={hasToken ? 'Paste new token to update…' : (tokenLabel ?? 'Paste token…')}
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && canConnectMulti) handleConnect() }}
                  />
                )}
                <Button size="sm" onClick={handleConnect} disabled={connecting || !canConnectMulti} className="gap-2">
                  {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                  {connecting ? 'Connecting…' : 'Connect'}
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={handleConnect} disabled={connecting} className="gap-2">
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                {connecting ? 'Starting…' : `Connect ${label}`}
              </Button>
            )}
          </div>
        )}

        {/* ── Scanning / Connecting ── */}
        {(status === 'scanning' || status === 'connecting') && (
          <div className="space-y-3">
            {authType === 'qr' && status === 'scanning' ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Open {label} on your phone and scan the QR code.
                </p>
                {state?.qrImage ? (
                  <div className="flex flex-col items-center gap-2">
                    <img src={state.qrImage} alt={`${label} QR Code`}
                         className="w-48 h-48 rounded-lg border border-border bg-white" />
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Waiting for scan…
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating QR code…
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {connectingLabel ?? `Connecting to ${label}…`}
              </div>
            )}
          </div>
        )}

        {/* ── Connected ── */}
        {status === 'connected' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span className="text-sm font-medium">{state?.identity ?? label}</span>
              </div>
              {guilds.length > 0 && (
                <p className="text-[10px] text-muted-foreground pl-5 mt-0.5">
                  In {guilds.length} server{guilds.length !== 1 ? 's' : ''}: {guilds.slice(0, 3).join(', ')}{guilds.length > 3 ? '…' : ''}
                </p>
              )}
              {connectedNote && guilds.length === 0 && (
                <p className="text-[10px] text-muted-foreground pl-5 mt-0.5">{connectedNote}</p>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={disconnecting}
                    className="text-muted-foreground hover:text-destructive h-7 text-xs gap-1.5">
              {disconnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        )}

        {/* ── Error ── */}
        {status === 'error' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs text-destructive font-medium">Connection failed</p>
                <p className="text-[10px] text-muted-foreground">{state?.error}</p>
              </div>
            </div>
            {authType === 'token' ? (
              <div className="space-y-2">
                {multiField ? (
                  tokenFields!.map(f => (
                    <Input key={f.key}
                      className="h-8 text-xs font-mono"
                      placeholder={f.placeholder}
                      value={f.key === 'token' ? token : secret}
                      onChange={e => f.key === 'token' ? setToken(e.target.value) : setSecret(e.target.value)}
                    />
                  ))
                ) : (
                  <Input className="h-8 text-xs font-mono" placeholder="Paste new token…"
                         value={token} onChange={e => setToken(e.target.value)} />
                )}
                <Button size="sm" variant="outline" onClick={handleConnect}
                        disabled={connecting || !canConnectMulti} className="gap-2">
                  {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Retry
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={handleConnect} disabled={connecting} className="gap-2">
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Retry
              </Button>
            )}
          </div>
        )}

      </CardContent>
    </Card>
  )
}
