'use client'

import { useState } from 'react'
import { ShieldAlert, ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ToolAccess } from '@/lib/tool-access'

interface ApprovalCardProps {
  id: string
  tool: string
  preview: string
  risk: ToolAccess
  onRespond: (approved: boolean) => void
}

export function ApprovalCard({ tool, preview, risk, onRespond }: ApprovalCardProps) {
  const [responded, setResponded] = useState(false)
  const isDestructive = risk === 'destructive'

  function handle(approved: boolean) {
    setResponded(true)
    onRespond(approved)
  }

  return (
    <div className={cn(
      'mx-4 my-2 rounded-lg border p-4 space-y-3',
      isDestructive
        ? 'border-destructive/40 bg-destructive/5'
        : 'border-amber-500/40 bg-amber-500/5',
    )}>
      <div className="flex items-center gap-2">
        {isDestructive
          ? <ShieldX className="h-4 w-4 text-destructive flex-shrink-0" />
          : <ShieldAlert className="h-4 w-4 text-amber-500 flex-shrink-0" />}
        <span className={cn(
          'text-xs font-medium',
          isDestructive ? 'text-destructive' : 'text-amber-500',
        )}>
          {isDestructive ? 'Destructive — cannot be undone' : 'Action requires your approval'}
        </span>
      </div>

      <div className="space-y-0.5">
        <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground mb-1">
          {tool}
        </span>
        <p className="text-sm text-foreground">{preview}</p>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => handle(false)}
          disabled={responded}
          className="flex-1"
        >
          Reject
        </Button>
        <Button
          size="sm"
          onClick={() => handle(true)}
          disabled={responded}
          className={cn('flex-1', isDestructive && 'bg-destructive hover:bg-destructive/90')}
        >
          Approve
        </Button>
      </div>
    </div>
  )
}
