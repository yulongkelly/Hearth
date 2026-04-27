'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Bell,
  Cpu,
  Plug2,
  Settings,
  Brain,
  Smartphone,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { loadUserTools } from '@/lib/user-tools'
import { loadWorkflowTools } from '@/lib/workflow-tools'
import * as RunStore  from '@/lib/workflow-run-store'
import * as ChatStore from '@/lib/chat-store'

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/chat',       icon: MessageSquare, label: 'Chat'         },
  { href: '/calendar',   icon: Calendar,      label: 'Calendar'     },
  { href: '/reminders',  icon: Bell,          label: 'Reminders'    },
  { href: '/models',     icon: Cpu,           label: 'Models'       },
  { href: '/integrations', icon: Plug2,       label: 'Connected Apps' },
  { href: '/memory',     icon: Brain,         label: 'Memory'       },
]

const bottomItems = [
  { href: '/connect',  icon: Smartphone, label: 'Connect Phone' },
  { href: '/settings', icon: Settings,   label: 'Settings' },
]

export function Sidebar() {
  const pathname = usePathname()
  const [hasTools, setHasTools]           = useState(false)
  const [hasActiveRun, setHasActiveRun]   = useState(false)
  const [chatStreaming, setChatStreaming]  = useState(false)
  const [hasDueReminders, setHasDueReminders] = useState(false)

  useEffect(() => {
    setHasTools(loadUserTools().length + loadWorkflowTools().length > 0)
    const handler = () => setHasTools(loadUserTools().length + loadWorkflowTools().length > 0)
    window.addEventListener('hearth:tool-created', handler)
    return () => window.removeEventListener('hearth:tool-created', handler)
  }, [])

  useEffect(() => {
    const sync = () => setHasActiveRun(RunStore.getActiveRuns().length > 0)
    sync()
    return RunStore.subscribe(sync)
  }, [])

  useEffect(() => {
    const sync = () => setChatStreaming(ChatStore.isActive())
    sync()
    return ChatStore.subscribe(sync)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      setHasDueReminders((e as CustomEvent).detail.dueCount > 0)
    }
    window.addEventListener('hearth:reminders-updated', handler)
    return () => window.removeEventListener('hearth:reminders-updated', handler)
  }, [])

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="fixed left-0 top-0 z-40 hidden md:flex h-full w-16 flex-col border-r border-border bg-card">
        {/* Logo */}
        <div className="flex h-16 items-center justify-center border-b border-border">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20">
            <Brain className="h-5 w-5 text-primary" />
          </div>
        </div>

        {/* Main nav */}
        <nav className="flex flex-1 flex-col items-center gap-1 py-4 overflow-y-auto">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname === href || (href !== '/' && pathname.startsWith(href))
            const showDot  = (href === '/chat' && chatStreaming && !isActive) ||
                             (href === '/reminders' && hasDueReminders && !isActive)
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary/20 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                    aria-label={label}
                  >
                    <div className="relative">
                      <Icon className="h-5 w-5" />
                      {showDot && (
                        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary animate-pulse" />
                      )}
                    </div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            )
          })}

          {/* Tools hub — shown once any tool exists */}
          {hasTools && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/tools"
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                    pathname.startsWith('/tools')
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  aria-label="Tools"
                >
                  <div className="relative">
                    <Wrench className="h-5 w-5" />
                    {hasActiveRun && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Tools</TooltipContent>
            </Tooltip>
          )}
        </nav>

        {/* Bottom nav */}
        <div className="flex flex-col items-center gap-1 border-t border-border py-4">
          {bottomItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname === href
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary/20 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                    aria-label={label}
                  >
                    <Icon className="h-5 w-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </aside>
    </TooltipProvider>
  )
}
