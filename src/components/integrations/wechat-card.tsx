'use client'

import { useState, useEffect, useCallback } from 'react'
import { MessageCircle, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type BotStatus = 'stopped' | 'scanning' | 'connected' | 'error'

interface WechatState {
  status:     BotStatus
  qrImage:    string | null
  loggedInAs: string | null
  error:      string | null
}

export function WechatCard() {
  const [state, setState]               = useState<WechatState | null>(null)
  const [connecting, setConnecting]     = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/wechat/status')
    if (res.ok) setState(await res.json())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (state?.status !== 'scanning') return
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [state?.status, refresh])

  async function handleConnect() {
    setConnecting(true)
    await fetch('/api/wechat/connect', { method: 'POST' })
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

  const status = state?.status ?? 'stopped'

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
              Connected
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">

        {status === 'stopped' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Scan a QR code to connect your WeChat account. Messages are stored locally.
            </p>
            <Button size="sm" onClick={handleConnect} disabled={connecting} className="gap-2">
              {connecting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <MessageCircle className="h-3.5 w-3.5" />}
              {connecting ? 'Connecting…' : 'Connect WeChat'}
            </Button>
          </div>
        )}

        {status === 'scanning' && (
          <div className="space-y-3">
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
            <Button size="sm" variant="ghost" onClick={refresh} className="gap-1.5 h-7 text-xs">
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        )}

        {status === 'connected' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span className="text-sm font-medium">{state?.loggedInAs ?? 'WeChat'}</span>
              </div>
              <p className="text-[10px] text-muted-foreground pl-5 mt-0.5">
                Messages received while Hearth is running are stored locally.
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

        {status === 'error' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs text-destructive font-medium">Connection failed</p>
                <p className="text-[10px] text-muted-foreground">{state?.error}</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={handleConnect} disabled={connecting} className="gap-2">
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Retry
            </Button>
          </div>
        )}

      </CardContent>
    </Card>
  )
}
