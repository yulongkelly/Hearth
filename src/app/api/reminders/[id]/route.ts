import { NextRequest, NextResponse } from 'next/server'
import { completeReminder, deleteReminder, listReminders, updateReminder } from '@/lib/reminder-store'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json()

    if (body.action === 'complete') {
      const all = listReminders({ includeCompleted: true })
      if (!all.find(r => r.id === id)) {
        return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
      }
      const result = completeReminder(id)
      return NextResponse.json(result)
    }

    const { text, dueDate, recurrence, tags } = body
    const updated = updateReminder(id, { text, dueDate, recurrence, tags })
    if (!updated) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
    return NextResponse.json({ reminder: updated })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ok = deleteReminder(id)
  if (!ok) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
