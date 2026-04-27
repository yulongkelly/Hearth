import { NextRequest, NextResponse } from 'next/server'
import { createReminder, getDueReminders, listReminders } from '@/lib/reminder-store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const includeCompleted = searchParams.get('includeCompleted') === 'true'
  const due = searchParams.get('due') === 'true'
  const limit = searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined

  const reminders = due ? getDueReminders() : listReminders({ includeCompleted, limit })
  return NextResponse.json({ reminders })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { text, dueDate, recurrence, sourceContext, tags } = body

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
    if (!dueDate || typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return NextResponse.json({ error: 'dueDate must be YYYY-MM-DD' }, { status: 400 })
    }

    const reminder = createReminder({
      text,
      dueDate,
      recurrence: recurrence ?? undefined,
      sourceContext: sourceContext ?? undefined,
      tags: Array.isArray(tags) ? tags.map(String) : undefined,
    })
    return NextResponse.json({ reminder }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
