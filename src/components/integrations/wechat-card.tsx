'use client'

import { useState, useEffect, useCallback } from 'react'
import { MessageCircle, Loader2, CheckCircle2, AlertCircle, RefreshCw, Monitor } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type BotStatus = 'stopped' | 'scanning' | 'connected' | 'error'
type PuppetType = 'xp' | 'wechat4u'

interface WechatState {
  status:       BotStatus
  puppet:       PuppetType | null
  qrImage:      string | null
  loggedInAs:   string | null
  error:        string | null
  xpAvailable:  boolean
}

// Detect the "web login blocked" error from wechat4u
function isAccountBlockedError(error: string | null): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return lower.includes('blocked') || lower.includes('not allowed') ||
         lower.includes('restricted') || lower.includes('cancel') ||
         lower.includes('logout') || lower.includes('web')
}

function XpInstallInstructions() {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <p className="text-xs font-medium">Enable WeChat PC mode (one-time setup)</p>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        WeChat PC mode bypasses the web login restriction by hooking directly into your running WeChat desktop app — no QR code needed.
      </p>
      <ol className="text-[10px] text-muted-foreground space-y-1.5 list-decimal list-inside leading-relaxed">
        <li>
          Download{' '}
          <span className="font-mono bg-muted px-1 rounded text-[10px]">Visual Studio Build Tools</span>{' '}
          — free from{' '}
          <span className="text-primary font-medium">visualstudio.microsoft.com/visual-cpp-build-tools</span>
        </li>
        <li>Run the installer → select <strong>Desktop development with C++</strong> → Install (~4 GB)</li>
        <li>Restart your terminal, then run:</li>
      </ol>
      <pre className="text-[10px] bg-muted rounded px-2 py-1.5 font-mono select-all">npm install wechaty-puppet-xp</pre>
      <p className="text-[10px] text-muted-foreground">Then restart Hearth and click Connect — WeChat PC must be open.</p>
    </div>
  )
}

export function WechatCard() {
  const [state, setState]               = useState<WechatState | null>(null)
  const [connecting, setConnecting]     = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [showXpGuide, setShowXpGuide]   = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/wechat/status')
    if (res.ok) setState(await res.json())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Poll while scanning (wechat4u QR waiting)
  useEffect(() => {
    if (state?.status !== 'scanning') return
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [state?.status, refresh])

  async function handleConnect(puppet: 'wechat4u' | 'xp' = 'wechat4u') {
    setConnecting(true)
    await fetch('/api/wechat/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puppet }),
    })
    setConnecting(false)
    refresh()
    const id = setInterval(async () => {
      const res = await fetch('/api/wechat/status')
      if (res.ok) {
        const data = await res.json()
        setState(data)
        if (data.status !== 'scanning') clearInterval(id)
      }
    }, 2000)
    setTimeout(() => clearInterval(id), 120_000)
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    await fetch('/api/wechat/disconnect', { method: 'POST' })
    setDisconnecting(false)
    refresh()
  }

  const status       = state?.status ?? 'stopped'
  const xpAvailable  = state?.xpAvailable ?? false
  const puppet       = state?.puppet
  const accountBlocked = status === 'error' && isAccountBlockedError(state?.error ?? null)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10">
              <MessageCircle className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <CardTitle className="text-sm">WeChat</CardTitle>
              <CardDescription className="text-xs">Read and send messages</CardDescription>
            </div>
          </div>
          {status === 'connected' && (
            <div className="flex items-center gap-1.5 text-[10px] text-green-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {puppet === 'xp' ? 'PC mode' : 'Connected'}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">

        {/* Stopped */}
        {status === 'stopped' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {xpAvailable
                ? 'Connect via QR code or WeChat PC (if your account can\'t use web login).'
                : 'Scan a QR code to connect your WeChat account. Messages are stored locally.'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleConnect('wechat4u')} disabled={connecting} className="gap-2">
                {connecting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <MessageCircle className="h-3.5 w-3.5" />}
                {connecting ? 'Connecting…' : 'QR Code'}
              </Button>
              {xpAvailable && (
                <Button size="sm" variant="outline" onClick={() => handleConnect('xp')} disabled={connecting} className="gap-2">
                  <Monitor className="h-3.5 w-3.5" /> WeChat PC
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Scanning — wechat4u QR flow */}
        {status === 'scanning' && (
          <div className="space-y-3">
            {puppet === 'xp' ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Connecting to WeChat PC…
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Open WeChat on your phone → <strong>Me → Scan QR Code</strong>
                </p>
                {state?.qrImage ? (
                  <div className="flex flex-col items-center gap-2">
                    <img src={state.qrImage} alt="WeChat QR Code" className="w-48 h-48 rounded-lg border border-border" />
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
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={refresh} className="gap-1.5 h-7 text-xs">
                <RefreshCw className="h-3 w-3" /> Refresh
              </Button>
              {puppet !== 'xp' && xpAvailable && (
                <Button
                  size="sm" variant="ghost"
                  onClick={async () => { await handleDisconnect(); handleConnect('xp') }}
                  disabled={connecting || disconnecting}
                  className="gap-1.5 h-7 text-xs text-muted-foreground"
                >
                  <Monitor className="h-3 w-3" /> Switch to WeChat PC
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Connected */}
        {status === 'connected' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span className="text-sm font-medium">{state?.loggedInAs ?? 'WeChat'}</span>
              </div>
              <p className="text-[10px] text-muted-foreground pl-5 mt-0.5">
                {puppet === 'xp'
                  ? 'Connected via WeChat PC — keep WeChat open while using Hearth.'
                  : 'Messages received while Hearth is running are stored locally.'}
              </p>
            </div>
            <Button
              size="sm" variant="ghost"
              onClick={handleDisconnect} disabled={disconnecting}
              className="text-muted-foreground hover:text-destructive h-7 text-xs gap-1.5"
            >
              {disconnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs text-destructive font-medium">
                  {puppet === 'xp' ? 'WeChat PC not detected' : accountBlocked ? 'Account not supported for web login' : 'Connection failed'}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {puppet === 'xp'
                    ? 'Open WeChat on your PC and make sure you\'re logged in, then retry.'
                    : accountBlocked
                      ? 'Your account was created after 2017 — Tencent blocks web login for it.'
                      : state?.error}
                </p>
              </div>
            </div>

            {/* wechat4u blocked + no xp installed — show setup guide */}
            {puppet !== 'xp' && accountBlocked && !xpAvailable && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  Use <strong>WeChat PC mode</strong> instead — it works for all accounts.
                </p>
                <button
                  onClick={() => setShowXpGuide(v => !v)}
                  className="text-[10px] text-primary hover:underline"
                >
                  {showXpGuide ? 'Hide instructions' : 'Show setup instructions'}
                </button>
                {showXpGuide && <XpInstallInstructions />}
              </div>
            )}

            <div className="flex gap-2">
              {/* Retry with same puppet (xp) or fallback to wechat4u */}
              <Button size="sm" variant="outline" onClick={() => handleConnect(puppet === 'xp' ? 'xp' : 'wechat4u')} disabled={connecting} className="gap-2">
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Retry
              </Button>
              {/* wechat4u blocked + xp available → offer switch */}
              {puppet !== 'xp' && accountBlocked && xpAvailable && (
                <Button size="sm" onClick={() => handleConnect('xp')} disabled={connecting} className="gap-2">
                  <Monitor className="h-3.5 w-3.5" /> Try WeChat PC mode
                </Button>
              )}
              {/* xp failed → offer fallback to QR */}
              {puppet === 'xp' && (
                <Button size="sm" variant="ghost" onClick={() => handleConnect('wechat4u')} disabled={connecting} className="gap-2 text-xs text-muted-foreground">
                  <MessageCircle className="h-3.5 w-3.5" /> Use QR instead
                </Button>
              )}
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  )
}
