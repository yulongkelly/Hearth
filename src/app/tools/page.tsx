'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mail, Calendar, FileText, Search, BarChart, List, Play, Trash2,
  Wrench, Workflow, type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { loadUserTools, deleteUserTool, type UserTool } from '@/lib/user-tools'
import { loadWorkflowTools, deleteWorkflowTool, type WorkflowTool } from '@/lib/workflow-tools'

const TOOL_ICONS: Record<string, LucideIcon> = {
  Mail, Calendar, FileText, Search, BarChart, List,
}

function ToolIcon({ name, className }: { name: string; className?: string }) {
  const Icon = TOOL_ICONS[name] ?? FileText
  return <Icon className={className} />
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

type AnyTool = (UserTool & { kind: 'legacy' }) | (WorkflowTool & { kind: 'workflow' })

function lastRun(tool: AnyTool): string | null {
  return tool.runs.length > 0 ? tool.runs[0].createdAt : null
}

export default function ToolsPage() {
  const router = useRouter()
  const [tools, setTools] = useState<AnyTool[]>([])

  function loadAll() {
    const legacy: AnyTool[]   = loadUserTools().map(t => ({ ...t, kind: 'legacy' as const }))
    const workflow: AnyTool[] = loadWorkflowTools().map(t => ({ ...t, kind: 'workflow' as const }))
    setTools([...workflow, ...legacy])
  }

  useEffect(() => {
    loadAll()
    window.addEventListener('hearth:tool-created', loadAll)
    return () => window.removeEventListener('hearth:tool-created', loadAll)
  }, [])

  function handleDelete(e: React.MouseEvent, tool: AnyTool) {
    e.stopPropagation()
    if (tool.kind === 'workflow') deleteWorkflowTool(tool.id)
    else deleteUserTool(tool.id)
    window.dispatchEvent(new CustomEvent('hearth:tool-created'))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Wrench className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Tools</h1>
            <p className="text-xs text-muted-foreground">Your custom AI-powered tools. Create new ones by asking in chat.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tools.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Wrench className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No tools yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Go to Chat and ask the AI to create a tool — for example, "create a tool to check my calendar conflicts".
            </p>
            <Button size="sm" variant="outline" onClick={() => router.push('/chat')}>
              Open Chat
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
            {tools.map(tool => (
              <Card
                key={tool.id}
                className="cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => router.push(`/tools/${tool.id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                        <ToolIcon name={tool.icon} className="h-4 w-4 text-primary" />
                      </div>
                      <CardTitle className="text-sm leading-tight">{tool.name}</CardTitle>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                      onClick={e => handleDelete(e, tool)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {tool.kind === 'workflow' && (
                      <span className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                        <Workflow className="h-2.5 w-2.5" /> workflow
                      </span>
                    )}
                    <CardDescription className="text-xs">{tool.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-muted-foreground">
                      {lastRun(tool)
                        ? `Last run ${formatDate(lastRun(tool)!)}`
                        : `Created ${formatDate(tool.createdAt)}`}
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={e => { e.stopPropagation(); router.push(`/tools/${tool.id}`) }}>
                      <Play className="h-3 w-3" /> Run
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
