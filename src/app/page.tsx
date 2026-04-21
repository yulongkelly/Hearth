'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  MessageSquare, Cpu, Mail, CalendarDays, ArrowRight,
  CheckCircle2, AlertCircle, Zap, Brain
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatBytes } from '@/lib/utils'
import type { OllamaModel, OllamaRunningModel } from '@/lib/ollama'

interface StatusState {
  ollamaOnline: boolean | null
  models: OllamaModel[]
  running: OllamaRunningModel[]
}

export default function DashboardPage() {
  const [status, setStatus] = useState<StatusState>({
    ollamaOnline: null,
    models: [],
    running: [],
  })

  useEffect(() => {
    async function fetchStatus() {
      try {
        const [tagsRes, psRes] = await Promise.all([
          fetch('/api/ollama/tags'),
          fetch('/api/ollama/ps'),
        ])
        if (!tagsRes.ok) {
          setStatus({ ollamaOnline: false, models: [], running: [] })
          return
        }
        const tags = await tagsRes.json()
        const ps = psRes.ok ? await psRes.json() : { models: [] }
        setStatus({
          ollamaOnline: true,
          models: tags.models || [],
          running: ps.models || [],
        })
      } catch {
        setStatus({ ollamaOnline: false, models: [], running: [] })
      }
    }
    fetchStatus()
  }, [])

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            Hearth
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{date}</p>
        </div>
        <Badge variant={status.ollamaOnline === true ? 'success' : status.ollamaOnline === false ? 'destructive' : 'secondary'}>
          {status.ollamaOnline === null ? 'Checking...' : status.ollamaOnline ? 'Ollama Online' : 'Ollama Offline'}
        </Badge>
      </div>

      {/* Ollama offline warning */}
      {status.ollamaOnline === false && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">Ollama is not running</p>
            <p className="text-xs text-muted-foreground mt-1">
              Start Ollama to use AI features. Download from{' '}
              <span className="text-primary font-medium">ollama.com</span>
            </p>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/chat">
          <Card className="group cursor-pointer transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Chat</p>
                <p className="text-xs text-muted-foreground">Talk to your AI</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/models">
          <Card className="group cursor-pointer transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 group-hover:bg-violet-500/20 transition-colors">
                <Cpu className="h-5 w-5 text-violet-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Models</p>
                <p className="text-xs text-muted-foreground">
                  {status.models.length > 0 ? `${status.models.length} installed` : 'Manage models'}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </CardContent>
          </Card>
        </Link>

        <Card className="opacity-50 cursor-not-allowed">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Mail className="h-5 w-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Gmail</p>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">Soon</Badge>
          </CardContent>
        </Card>

        <Card className="opacity-50 cursor-not-allowed">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <CalendarDays className="h-5 w-5 text-green-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Calendar</p>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">Soon</Badge>
          </CardContent>
        </Card>
      </div>

      {/* System status */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              Installed Models
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status.models.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-xs text-muted-foreground mb-3">No models installed yet.</p>
                <Link href="/models">
                  <Button size="sm" variant="outline" className="gap-2">
                    <Cpu className="h-3.5 w-3.5" />
                    Download a model
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {status.models.slice(0, 5).map(m => (
                  <div key={m.name} className="flex items-center justify-between gap-2">
                    <p className="text-xs truncate text-foreground">{m.name}</p>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{formatBytes(m.size)}</span>
                  </div>
                ))}
                {status.models.length > 5 && (
                  <p className="text-xs text-muted-foreground">+{status.models.length - 5} more</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              Running Now
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status.running.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No models currently loaded in memory.</p>
            ) : (
              <div className="space-y-3">
                {status.running.map(m => (
                  <div key={m.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium truncate">{m.name}</p>
                      <Badge variant="success" className="text-[10px] flex-shrink-0">Active</Badge>
                    </div>
                    <div className="flex gap-4 text-[10px] text-muted-foreground">
                      {m.size_vram > 0 && <span>VRAM: {formatBytes(m.size_vram)}</span>}
                      <span>RAM: {formatBytes(m.size)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Privacy notice */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="flex items-start gap-3 p-4">
          <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">100% Private by Design</p>
            <p className="text-xs text-muted-foreground mt-1">
              All AI processing happens on your machine via Ollama. Your conversations, emails, and data never leave your computer or reach any external server.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
