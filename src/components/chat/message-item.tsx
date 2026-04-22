'use client'

import { memo } from 'react'
import { Brain, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/ui/markdown'
import type { Message } from '@/lib/types'

interface MessageItemProps {
  message: Message
  isStreaming?: boolean
}

export const MessageItem = memo(function MessageItem({ message, isStreaming }: MessageItemProps) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-3 px-4 py-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary/20' : 'bg-muted'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary" />
        ) : (
          <Brain className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-primary/15 text-foreground rounded-tr-sm'
            : 'bg-muted/50 text-foreground rounded-tl-sm'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <Markdown content={message.content} streaming={isStreaming} />
        )}
      </div>
    </div>
  )
})
