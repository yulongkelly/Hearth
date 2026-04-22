'use client'

import { useState, useEffect } from 'react'
import { CalendarDays, CheckCircle2, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { GmailStatus } from '@/lib/types'

type CardState = 'loading' | 'connected' | 'disconnected'

interface CalendarCardProps {
  initialError?: string | null
}

export function CalendarCard({ initialError }: CalendarCardProps) {
  const [cardState, setCardState] = useState<CardState>('loading')

  useEffect(() => {
    fetch('/api/gmail/status')
      .then(r => r.json())
      .then(({ connected }: GmailStatus) => setCardState(connected ? 'connected' : 'disconnected'))
      .catch(() => setCardState('disconnected'))
  }, [])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10">
              <CalendarDays className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <CardTitle className="text-sm">Google Calendar</CardTitle>
              <CardDescription className="text-xs">
                View your schedule and get AI-powered summaries.
              </CardDescription>
            </div>
          </div>
          {cardState === 'connected' && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <Badge variant="success" className="text-[10px]">Connected</Badge>
            </div>
          )}
          {cardState === 'loading' && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </CardHeader>

      <CardContent>
        {initialError && cardState !== 'connected' && (
          <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2 mb-3">
            Sign-in failed. Please try again.
          </p>
        )}

        {cardState === 'disconnected' && (
          <div className="space-y-2">
            <Button size="sm" onClick={() => { window.location.href = '/api/auth/gmail' }}>
              Connect with Google
            </Button>
            <p className="text-xs text-muted-foreground">
              Uses the same Google connection as Gmail — connecting once covers both.
            </p>
          </div>
        )}

        {cardState === 'connected' && (
          <p className="text-xs text-muted-foreground">
            Google Calendar linked via your Google account.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
