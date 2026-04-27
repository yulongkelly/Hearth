'use client'

import { useEffect, useState } from 'react'
import { Bell, Check, Plus, Trash2, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { Reminder } from '@/lib/reminder-store'

type Tab = 'upcoming' | 'completed'

function dueDateColor(dueDate: string): string {
  const today = new Date().toISOString().slice(0, 10)
  if (dueDate < today) return 'text-red-400'
  if (dueDate === today) return 'text-amber-400'
  return 'text-foreground'
}

interface NewReminderForm {
  text: string
  dueDate: string
  recurrence: string
}

export default function RemindersPage() {
  const [tab, setTab] = useState<Tab>('upcoming')
  const [upcoming, setUpcoming] = useState<Reminder[]>([])
  const [completed, setCompleted] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<NewReminderForm>({ text: '', dueDate: '', recurrence: '' })
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [upRes, doneRes] = await Promise.all([
        fetch('/api/reminders?includeCompleted=false'),
        fetch('/api/reminders?includeCompleted=true'),
      ])
      const upData = await upRes.json()
      const doneData = await doneRes.json()
      setUpcoming(upData.reminders ?? [])
      setCompleted((doneData.reminders ?? []).filter((r: Reminder) => r.completedAt))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function complete(id: string) {
    await fetch(`/api/reminders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete' }),
    })
    load()
  }

  async function remove(id: string) {
    await fetch(`/api/reminders/${id}`, { method: 'DELETE' })
    load()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.text.trim() || !form.dueDate) return
    setSubmitting(true)
    try {
      await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: form.text.trim(),
          dueDate: form.dueDate,
          recurrence: form.recurrence || undefined,
        }),
      })
      setForm({ text: '', dueDate: '', recurrence: '' })
      setShowForm(false)
      load()
    } finally {
      setSubmitting(false)
    }
  }

  const list = tab === 'upcoming' ? upcoming : completed
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" />
          Reminders
        </h1>
        <Button size="sm" onClick={() => setShowForm(v => !v)} className="gap-2">
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Cancel' : 'New reminder'}
        </Button>
      </div>

      {/* New reminder form */}
      {showForm && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Input
                placeholder="What do you want to be reminded about?"
                value={form.text}
                onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                required
              />
              <div className="flex gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Due date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    min={today}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                    required
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Repeat</label>
                  <select
                    value={form.recurrence}
                    onChange={e => setForm(f => ({ ...f, recurrence: e.target.value }))}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
                  >
                    <option value="">No repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <Button type="submit" size="sm" disabled={submitting} className="self-start">
                {submitting ? 'Saving…' : 'Save reminder'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['upcoming', 'completed'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
            {t === 'upcoming' && upcoming.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                {upcoming.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <Bell className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {tab === 'upcoming' ? 'No upcoming reminders. Add one above or ask the AI in chat.' : 'No completed reminders.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {list.map(r => (
                <div key={r.id} className="flex items-start gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{r.text}</p>
                      {r.recurrence && (
                        <Badge variant="secondary" className="text-[10px]">{r.recurrence}</Badge>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 ${dueDateColor(r.dueDate)}`}>
                      {r.completedAt ? `Completed ${r.completedAt.slice(0, 10)}` : `Due ${r.dueDate}`}
                    </p>
                    {r.sourceContext && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.sourceContext}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!r.completedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-green-400"
                        onClick={() => complete(r.id)}
                        title="Mark complete"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                      onClick={() => remove(r.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
