'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, MessageSquare, Calendar, Bell, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { href: '/',            icon: LayoutDashboard, label: 'Home'      },
  { href: '/chat',        icon: MessageSquare,   label: 'Chat'      },
  { href: '/calendar',    icon: Calendar,        label: 'Calendar'  },
  { href: '/reminders',   icon: Bell,            label: 'Reminders' },
  { href: '/settings',    icon: Settings,        label: 'Settings'  },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card md:hidden">
      <div className="flex">
        {items.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 py-3 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className={cn('h-5 w-5', active && 'text-primary')} />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
