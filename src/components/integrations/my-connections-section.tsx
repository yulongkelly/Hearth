'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plug, Trash2, RefreshCw, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface ConnectionInfo {
  id: string
  service: string
  testUrl?: string
  verifiedAt: string
}

export function MyConnectionsSection() {
  const [connections, setConnections] = useState<ConnectionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/connections')
      const data = await res.json()
      setConnections(data.connections ?? [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleRemove(id: string) {
    setRemoving(id)
    try {
      await fetch('/api/connections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setConnections(prev => prev.filter(c => c.id !== id))
    } finally {
      setRemoving(null)
    }
  }

  function relativeTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Plug className="h-4 w-4 text-muted-foreground" />
          My Connections
        </h2>
        <button onClick={refresh} className="text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}

      {!loading && connections.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-4 text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            No custom connections yet. Ask the AI to connect a service for you.
          </p>
          <Link href="/chat">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Open Chat
            </Button>
          </Link>
        </div>
      )}

      {connections.map(c => (
        <div
          key={c.id}
          className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 gap-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{c.service}</p>
            <p className="text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
                Connected · {relativeTime(c.verifiedAt)}
              </span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            disabled={removing === c.id}
            onClick={() => handleRemove(c.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}
