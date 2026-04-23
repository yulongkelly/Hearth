'use client'

import { useState, useEffect, useCallback } from 'react'
import { Send, Loader2, CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type TelegramStatus = 'stopped' | 'connecting' | 'connected' | 'error'

interface TelegramState {
  status:   TelegramStatus
  botName:  string | null
  error:    string | null
  hasToken: boolean
}

export function TelegramCard() {
  const [state, setState]                 = useState<TelegramState | null>(null)
  const [token, setToken]                 = useState('')
  const [connecting, setConnecting]       = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/telegram/status')
    if (res.ok) setState(await res.json())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleConnect() {
    setConnecting(true)
    const body = token.trim() ? { token: token.trim() } : {}
    const res = await fetch('/api/telegram/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) setState(await res.json())
    setConnecting(false)
    setToken('')
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    await fetch('/api/telegram/disconnect', { method: 'POST' })
    setDisconnecting(false)
    refresh()
  }

  const status   = state?.status ?? 'stopped'
  const hasToken = state?.hasToken ?? false

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-400/10">
              <Send className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Telegram</CardTitle>
              <CardDescription className="text-xs">Receive and send messages via a bot</CardDescription>
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
            {!hasToken && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Create a bot with <strong>@BotFather</strong> on Telegram, then paste the token below.
                </p>
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                >
                  Open @BotFather <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            )}
            <div className="flex gap-2">
              <Input
                className="h-8 text-xs font-mono"
                placeholder={hasToken ? 'Paste new token to update…' : 'Paste bot token…'}
                value={token}
                onChange={e => setToken(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (token.trim() || hasToken)) handleConnect() }}
              />
              <Button
                size="sm" onClick={handleConnect}
                disabled={connecting || (!token.trim() && !hasToken)}
                className="gap-2 flex-shrink-0"
              >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {connecting ? 'Connecting…' : 'Connect'}
              </Button>
            </div>
          </div>
        )}

        {status === 'connecting' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting to Telegram…
          </div>
        )}

        {status === 'connected' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span className="text-sm font-medium">@{state?.botName}</span>
              </div>
              <p className="text-[10px] text-muted-foreground pl-5 mt-0.5">
                Message this bot in Telegram to have Hearth read and reply to you.
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
            <div className="flex gap-2">
              <Input
                className="h-8 text-xs font-mono"
                placeholder="Paste new token…"
                value={token}
                onChange={e => setToken(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={handleConnect} disabled={connecting || (!token.trim() && !hasToken)} className="gap-2 flex-shrink-0">
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Retry
              </Button>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  )
}
