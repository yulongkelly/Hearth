import { getDueReminders, markNotified } from './reminder-store'

declare global {
  // eslint-disable-next-line no-var
  var __reminderSchedulerStarted: boolean | undefined
}

async function poll() {
  try {
    const due = getDueReminders()
    for (const r of due) {
      markNotified(r.id)
      // OS desktop notification — available in Electron's Node context
      if (typeof Notification !== 'undefined') {
        new Notification(r.text, {
          body: r.sourceContext ?? `Due: ${r.dueDate}`,
        })
      }
    }
  } catch { /* never throw from background poll */ }
}

export function startReminderScheduler(): void {
  if (global.__reminderSchedulerStarted) return
  global.__reminderSchedulerStarted = true
  poll()
  setInterval(() => { poll() }, 60_000)
}
