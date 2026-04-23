'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { Landmark, Loader2, Trash2, Plus, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface PlaidAccount {
  id:   string
  name: string
  mask: string
  type: string
}

interface PlaidItem {
  itemId:          string
  institutionName: string
  accounts:        PlaidAccount[]
}

interface PlaidStatus {
  configured: boolean
  env:        string | null
  items:      PlaidItem[]
}

// ─── Plaid Link button (needs a token before it can open) ────────────────────

function LinkButton({ onLinked, label }: { onLinked: () => void; label: string }) {
  const [linkToken, setLinkToken]   = useState<string | null>(null)
  const [fetching, setFetching]     = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const { open, ready } = usePlaidLink({
    token: linkToken ?? '',
    onSuccess: async (publicToken, metadata) => {
      const accounts: PlaidAccount[] = (metadata.accounts ?? []).map(a => ({
        id:   a.id,
        name: a.name ?? '',
        mask: a.mask ?? '',
        type: a.type ?? '',
      }))
      await fetch('/api/plaid/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicToken,
          institutionName: metadata.institution?.name ?? 'Unknown Bank',
          accounts,
        }),
      })
      setLinkToken(null)
      onLinked()
    },
    onExit: () => setLinkToken(null),
  })

  useEffect(() => {
    if (linkToken && ready) open()
  }, [linkToken, ready, open])

  async function handleClick() {
    setFetching(true)
    setError(null)
    try {
      const res  = await fetch('/api/plaid/link-token', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.link_token) {
        setError(data.error ?? 'Failed to start Plaid Link')
        setFetching(false)
        return
      }
      setLinkToken(data.link_token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Plaid Link')
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="space-y-1">
      <Button size="sm" onClick={handleClick} disabled={fetching} className="gap-2">
        {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        {label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function PlaidCard() {
  const [status, setStatus]         = useState<PlaidStatus | null>(null)
  const [showSetup, setShowSetup]   = useState(false)
  const [env, setEnv]               = useState<'sandbox' | 'production'>('sandbox')
  const [clientId, setClientId]     = useState('')
  const [secret, setSecret]         = useState('')
  const [saving, setSaving]         = useState(false)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/plaid/status')
    if (res.ok) setStatus(await res.json())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleSave() {
    if (!clientId.trim() || !secret.trim()) return
    setSaving(true)
    await fetch('/api/settings/plaid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId.trim(), secret: secret.trim(), env }),
    })
    setSaving(false)
    setShowSetup(false)
    refresh()
  }

  async function handleDisconnect(itemId: string) {
    setDisconnecting(itemId)
    await fetch('/api/plaid/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    })
    setDisconnecting(null)
    refresh()
  }

  const envLabel = { sandbox: 'Sandbox', production: 'Production' }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10">
              <Landmark className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <CardTitle className="text-sm">Bank Accounts</CardTitle>
              <CardDescription className="text-xs">via Plaid</CardDescription>
            </div>
          </div>
          {status?.configured && (
            <Badge variant="outline" className="text-[10px] font-normal">
              {envLabel[status.env as keyof typeof envLabel] ?? status.env}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Not yet configured */}
        {status && !status.configured && !showSetup && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Connect your bank accounts to read transaction history. Sign up at{' '}
              <span className="text-primary font-medium">plaid.com</span> to get your API keys.
            </p>
            <Button size="sm" variant="outline" onClick={() => setShowSetup(true)}>
              Set up Plaid
            </Button>
          </div>
        )}

        {/* Setup form */}
        {showSetup && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Environment</label>
              <select
                value={env}
                onChange={e => setEnv(e.target.value as typeof env)}
                className="w-full h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="sandbox">Sandbox (mock data, free)</option>
                <option value="production">Production (real banks — free trial up to 10 accounts)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Client ID</label>
              <Input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="From plaid.com → Team → Keys" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Secret</label>
              <Input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Sandbox / Development / Production secret" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving || !clientId.trim() || !secret.trim()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowSetup(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Configured — show linked banks */}
        {status?.configured && !showSetup && (
          <div className="space-y-3">
            {status.items.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">No banks connected yet.</p>
                <LinkButton label="Connect Bank Account" onLinked={refresh} />
              </div>
            ) : (
              <>
                {status.items.map(item => (
                  <div key={item.itemId} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                        <span className="text-sm font-medium">{item.institutionName}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDisconnect(item.itemId)}
                        disabled={disconnecting === item.itemId}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      >
                        {disconnecting === item.itemId
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                    <div className="space-y-0.5">
                      {item.accounts.map(acct => (
                        <p key={acct.id} className="text-xs text-muted-foreground pl-5">
                          {acct.name}{acct.mask ? ` ****${acct.mask}` : ''}
                          {acct.type ? <span className="text-muted-foreground/50 ml-1">· {acct.type}</span> : null}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
                <LinkButton label="Add another bank" onLinked={refresh} />
              </>
            )}
            <button
              onClick={() => setShowSetup(true)}
              className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              Change API keys
            </button>
          </div>
        )}

      </CardContent>
    </Card>
  )
}
