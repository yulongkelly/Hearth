'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Reminder } from '@/lib/reminder-store'

export function ReminderBanner() {
  const [dueReminders, setDueReminders] = useState<Reminder[]>([])

  function dispatch(reminders: Reminder[]) {
    window.dispatchEvent(new CustomEvent('hearth:reminders-updated', {
      detail: { dueCount: reminders.length },
    }))
  }

  async function fetchDue() {
    try {
      const res = await fetch('/api/reminders?due=true')
      if (!res.ok) return
      const data = await res.json()
      const reminders: Reminder[] = data.reminders ?? []
      setDueReminders(reminders)
      dispatch(reminders)
    } catch { /* silent */ }
  }

  useEffect(() => {
    fetchDue()
    const interval = setInterval(fetchDue, 30_000)
    return () => clearInterval(interval)
  }, [])

  async function dismiss(id: string) {
    try {
      await fetch(`/api/reminders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      })
      const next = dueReminders.filter(r => r.id !== id)
      setDueReminders(next)
      dispatch(next)
    } catch { /* silent */ }
  }

  if (!dueReminders.length) return null

  return (
    <div className="fixed top-0 left-0 md:left-16 right-0 z-50 flex flex-col gap-1 p-2 pointer-events-none">
      {dueReminders.map(r => (
        <div
          key={r.id}
          className="pointer-events-auto flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 shadow-lg backdrop-blur-sm"
        >
          <Bell className="h-4 w-4 text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-200 truncate">{r.text}</p>
            {r.sourceContext && (
              <p className="text-xs text-amber-400/70 truncate">{r.sourceContext}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href="/reminders">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-300 hover:text-amber-100">
                View all
              </Button>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-amber-400 hover:text-amber-100"
              onClick={() => dismiss(r.id)}
              aria-label="Dismiss reminder"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
