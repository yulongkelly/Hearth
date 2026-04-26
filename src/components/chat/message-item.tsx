'use client'

import { memo, useState } from 'react'
import { Brain, User, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/ui/markdown'
import type { Message } from '@/lib/types'

interface MessageItemProps {
  message: Message
  isStreaming?: boolean
}

interface ParsedContent {
  thinking: string | null
  response: string
  inProgress: boolean
}

export function parseThinking(content: string): ParsedContent {
  const openIdx = content.indexOf('<think>')
  if (openIdx === -1) return { thinking: null, response: content, inProgress: false }

  const closeIdx = content.indexOf('</think>', openIdx)
  const before = content.slice(0, openIdx).trim()

  if (closeIdx === -1) {
    return { thinking: content.slice(openIdx + 7), response: before, inProgress: true }
  }

  const thinking = content.slice(openIdx + 7, closeIdx).trim()
  const after = content.slice(closeIdx + 8).trim()
  const response = [before, after].filter(Boolean).join('\n')
  return { thinking, response, inProgress: false }
}

export const MessageItem = memo(function MessageItem({ message, isStreaming }: MessageItemProps) {
  const isUser = message.role === 'user'
  const [showThinking, setShowThinking] = useState(false)

  const { thinking, response, inProgress } = isUser
    ? { thinking: null, response: message.content, inProgress: false }
    : parseThinking(message.content)

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
          <>
            {thinking !== null && (
              <div className="mb-2">
                <button
                  onClick={() => setShowThinking(prev => !prev)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showThinking ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {inProgress ? 'Thinking…' : 'Thinking'}
                  {inProgress && <span className="ml-1 animate-pulse">●</span>}
                </button>
                {showThinking && (
                  <div className="mt-1 rounded-lg bg-muted/30 border border-border/50 px-3 py-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {thinking}
                    {inProgress && <span className="animate-pulse">▌</span>}
                  </div>
                )}
              </div>
            )}
            {response && (
              <Markdown content={response} streaming={isStreaming && !inProgress} />
            )}
          </>
        )}
      </div>
    </div>
  )
})
