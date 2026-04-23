'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Calendar, Loader2, RefreshCw, AlertCircle, Plug2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface CalendarEvent {
  id: string
  summary: string
  start: string
  end: string
  description?: string
  location?: string
  allDay: boolean
}

interface AccountData {
  email: string
  label: string
  events: CalendarEvent[]
  error?: string
}

type TaggedEvent = CalendarEvent & { accountLabel: string }

function localDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function groupByDay(accounts: AccountData[]): [string, TaggedEvent[]][] {
  const map: Record<string, TaggedEvent[]> = {}
  for (const acc of accounts) {
    for (const evt of acc.events) {
      const date = evt.start.split('T')[0]
      if (!map[date]) map[date] = []
      map[date].push({ ...evt, accountLabel: acc.label })
    }
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, events]) => [
      date,
      [...events].sort((a: TaggedEvent, b: TaggedEvent) => a.start.localeCompare(b.start)),
    ])
}

function formatDayLabel(dateStr: string): string {
  const today = localDateStr(new Date())
  const tomorrow = localDateStr(new Date(Date.now() + 86_400_000))
  if (dateStr === today) return 'Today'
  if (dateStr === tomorrow) return 'Tomorrow'
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatTime(iso: string, allDay: boolean): string {
  if (allDay) return 'All day'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function CalendarPage() {
  const [accounts, setAccounts] = useState<AccountData[] | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [filter, setFilter]     = useState<string | null>(null)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/calendar/events?maxResults=20')
      if (res.status === 401) { setAccounts([]); setLoading(false); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setAccounts(json.accounts ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )

  if (error) return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    </div>
  )

  if (accounts !== null && accounts.length === 0) return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center px-6">
      <Calendar className="h-10 w-10 text-muted-foreground/40" />
      <div>
        <p className="text-sm font-medium">No Google Calendar connected</p>
        <p className="text-xs text-muted-foreground mt-1">Connect an account to see your events</p>
      </div>
      <Link href="/integrations">
        <Button size="sm" variant="outline" className="gap-2">
          <Plug2 className="h-3.5 w-3.5" />
          Connect Google
        </Button>
      </Link>
    </div>
  )

  const all = accounts ?? []
  const filtered = filter ? all.filter(a => a.email === filter) : all
  const grouped = groupByDay(filtered)
  const multiAccount = all.length > 1
  const totalAll = all.reduce((s, a) => s + a.events.length, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
            <Calendar className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Calendar</h1>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={fetchEvents} className="h-8 w-8 p-0" aria-label="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl px-6 py-6 space-y-6">

          {multiAccount && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setFilter(null)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  filter === null
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
              >
                All ({totalAll})
              </button>
              {all.map(acc => (
                <button
                  key={acc.email}
                  onClick={() => setFilter(filter === acc.email ? null : acc.email)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    filter === acc.email
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  {acc.label} ({acc.events.length})
                </button>
              ))}
            </div>
          )}

          {grouped.length === 0 && (
            <p className="text-center py-12 text-sm text-muted-foreground">No upcoming events</p>
          )}

          {grouped.map(([dateStr, events]) => (
            <div key={dateStr} className="space-y-2">
              <div className="flex items-center gap-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  {formatDayLabel(dateStr)}
                </p>
                <div className="flex-1 h-px bg-border" />
              </div>

              {events.map((evt: TaggedEvent, i: number) => (
                <div key={`${evt.id}-${i}`} className="rounded-md border border-border bg-card px-4 py-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{evt.summary}</p>
                    {multiAccount && (
                      <span className="font-mono text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground flex-shrink-0">
                        {evt.accountLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(evt.start, evt.allDay)}
                    {!evt.allDay && evt.end && ` – ${formatTime(evt.end, false)}`}
                  </p>
                  {evt.location && (
                    <p className="text-xs text-muted-foreground/60">{evt.location}</p>
                  )}
                </div>
              ))}
            </div>
          ))}

        </div>
      </ScrollArea>
    </div>
  )
}
