'use client'

import { useEffect, useState } from 'react'
import { Smartphone, Wifi, Globe, Copy, Check, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function ConnectPage() {
  const [localUrl, setLocalUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    fetch('/api/local-ip')
      .then(r => r.json())
      .then(({ ip }) => {
        const url = `http://${ip}:3000`
        setLocalUrl(url)
        const encoded = encodeURIComponent(url)
        setQrDataUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}&bgcolor=0a0a0f&color=a78bfa&margin=2`)
      })
  }, [])

  const copy = async () => {
    await navigator.clipboard.writeText(localUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center border-b border-border px-6 h-14 flex-shrink-0">
        <h1 className="text-base font-semibold">Connect your phone</h1>
      </div>

      <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto w-full">

        {/* Step 1 — Firewall */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Step 1 — Allow Hearth through Windows Firewall
            </CardTitle>
            <CardDescription>
              Only needed once. Run this in an admin PowerShell on your PC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block rounded-lg border border-border bg-muted px-4 py-3 text-xs font-mono break-all">
              New-NetFirewallRule -DisplayName &quot;Hearth&quot; -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
            </code>
          </CardContent>
        </Card>

        {/* Step 2 — QR */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" />
              Step 2 — Scan on your phone
            </CardTitle>
            <CardDescription>
              Make sure your phone is on the same Wi-Fi as this computer, then scan.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {qrDataUrl ? (
              <div className="rounded-xl overflow-hidden border border-border p-2 bg-[#0a0a0f]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="QR code" width={200} height={200} />
              </div>
            ) : (
              <div className="w-[200px] h-[200px] rounded-xl border border-border bg-muted animate-pulse" />
            )}

            <div className="flex items-center gap-2 w-full max-w-sm">
              <code className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-sm font-mono truncate">
                {localUrl || 'Detecting…'}
              </code>
              <button
                onClick={copy}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-accent transition-colors"
              >
                {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
              </button>
            </div>

            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Open this URL in Safari or Chrome on your phone, then tap
              <strong> Share → Add to Home Screen</strong> to install it like an app.
            </p>
          </CardContent>
        </Card>

        {/* Tailscale card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-violet-400" />
              Outside your home — Tailscale
              <Badge variant="secondary" className="text-[10px]">Optional</Badge>
            </CardTitle>
            <CardDescription>
              Access Hearth from anywhere — coffee shop, office, travel — with end-to-end encryption.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">1</span>
                <span className="text-muted-foreground">
                  Install <span className="text-foreground font-medium">Tailscale</span> on this computer from{' '}
                  <span className="text-primary">tailscale.com</span>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">2</span>
                <span className="text-muted-foreground">
                  Install <span className="text-foreground font-medium">Tailscale</span> on your phone from the App Store / Play Store
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">3</span>
                <span className="text-muted-foreground">Sign in to the same account on both devices</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">4</span>
                <span className="text-muted-foreground">
                  Find your computer's Tailscale IP (starts with <code className="text-xs bg-muted px-1 py-0.5 rounded">100.x.x.x</code>) and open{' '}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">http://100.x.x.x:3000</code> on your phone
                </span>
              </li>
            </ol>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Tailscale creates an encrypted tunnel between your devices. Your AI traffic never goes through any public server — not even Tailscale's.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* PWA tip */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Smartphone className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Add to Home Screen</p>
              <p className="text-xs text-muted-foreground mt-1">
                <strong>iPhone (Safari):</strong> Tap the Share icon → Add to Home Screen<br />
                <strong>Android (Chrome):</strong> Tap the menu → Add to Home Screen<br />
                Hearth will open fullscreen like a native app — no browser bar.
              </p>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
