'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Download, Trash2, RefreshCw, AlertCircle, CheckCircle2,
  Cpu, MemoryStick, Zap, Circle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatBytes, cn } from '@/lib/utils'
import { RECOMMENDED_MODELS, type OllamaModel, type OllamaRunningModel } from '@/lib/ollama'

interface PullState {
  status: string
  progress: number
  total: number
  completed: number
}

export function ModelManager() {
  const [installedModels, setInstalledModels] = useState<OllamaModel[]>([])
  const [runningModels, setRunningModels] = useState<OllamaRunningModel[]>([])
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [pulling, setPulling] = useState<Record<string, PullState>>({})
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})
  const [customModel, setCustomModel] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [tagsRes, psRes] = await Promise.all([
        fetch('/api/ollama/tags'),
        fetch('/api/ollama/ps'),
      ])

      if (!tagsRes.ok) {
        setOllamaOnline(false)
        setLoading(false)
        return
      }

      const tagsData = await tagsRes.json()
      const psData = psRes.ok ? await psRes.json() : { models: [] }

      setInstalledModels(tagsData.models || [])
      setRunningModels(psData.models || [])
      setOllamaOnline(true)
    } catch {
      setOllamaOnline(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [refresh])

  const pullModel = async (name: string) => {
    if (pulling[name]) return

    setPulling(prev => ({
      ...prev,
      [name]: { status: 'Starting...', progress: 0, total: 0, completed: 0 },
    }))

    try {
      const res = await fetch('/api/ollama/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!res.ok || !res.body) throw new Error('Pull failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter(l => l.trim())

        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            const total = data.total || 0
            const completed = data.completed || 0
            const progress = total > 0 ? Math.round((completed / total) * 100) : 0

            setPulling(prev => ({
              ...prev,
              [name]: {
                status: data.status || 'Downloading...',
                progress,
                total,
                completed,
              },
            }))

            if (data.status === 'success') {
              await refresh()
            }
          } catch {
            // ignore parse errors on partial chunks
          }
        }
      }
    } catch (err) {
      setPulling(prev => ({
        ...prev,
        [name]: { status: 'Error downloading', progress: 0, total: 0, completed: 0 },
      }))
    } finally {
      setTimeout(() => {
        setPulling(prev => {
          const updated = { ...prev }
          delete updated[name]
          return updated
        })
      }, 2000)
    }
  }

  const deleteModel = async (name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    setDeleting(prev => ({ ...prev, [name]: true }))
    try {
      const res = await fetch('/api/ollama/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) await refresh()
    } finally {
      setDeleting(prev => ({ ...prev, [name]: false }))
    }
  }

  const installedNames = new Set(installedModels.map(m => m.name))
  const totalVram = runningModels.reduce((s, m) => s + (m.size_vram || 0), 0)
  const totalRam = runningModels.reduce((s, m) => s + (m.size || 0), 0)

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto w-full">
      {/* Status card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Ollama Status</CardTitle>
            <Button size="sm" variant="ghost" onClick={refresh} disabled={loading} className="h-8 gap-1.5">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {ollamaOnline === null ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Checking connection...</span>
            </div>
          ) : ollamaOnline ? (
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm text-green-400">Connected</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Cpu className="h-4 w-4" />
                <span className="text-sm">{installedModels.length} model{installedModels.length !== 1 ? 's' : ''} installed</span>
              </div>
              {runningModels.length > 0 && (
                <>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Zap className="h-4 w-4" />
                    <span className="text-sm">{runningModels.length} running</span>
                  </div>
                  {totalVram > 0 && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MemoryStick className="h-4 w-4" />
                      <span className="text-sm">{formatBytes(totalVram)} VRAM</span>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <div>
                <p className="text-sm text-destructive">Cannot connect to Ollama</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Make sure Ollama is installed and running. Download from{' '}
                  <span className="text-primary">ollama.com</span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Installed models */}
      {installedModels.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3">Installed Models</h2>
          <div className="flex flex-col gap-2">
            {installedModels.map(model => {
              const isRunning = runningModels.some(r => r.name === model.name || r.model === model.name)
              return (
                <div
                  key={model.name}
                  className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {isRunning ? (
                      <Circle className="h-2.5 w-2.5 fill-green-500 text-green-500 flex-shrink-0" />
                    ) : (
                      <Circle className="h-2.5 w-2.5 text-muted-foreground/30 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{model.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{formatBytes(model.size)}</span>
                        {model.details?.parameter_size && (
                          <span className="text-xs text-muted-foreground">{model.details.parameter_size}</span>
                        )}
                        {model.details?.quantization_level && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                            {model.details.quantization_level}
                          </Badge>
                        )}
                        {isRunning && <Badge variant="success" className="text-[10px] px-1.5 py-0 h-4">Running</Badge>}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteModel(model.name)}
                    disabled={deleting[model.name]}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {installedModels.length > 0 && <Separator />}

      {/* Download recommended models */}
      <div>
        <h2 className="text-sm font-semibold mb-1">Download Models</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Models are downloaded from Ollama and run entirely on your machine.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {RECOMMENDED_MODELS.map(rec => {
            const isInstalled = installedNames.has(rec.name)
            const pullState = pulling[rec.name]

            return (
              <div
                key={rec.name}
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  isInstalled ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{rec.label}</p>
                      {rec.tags.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{rec.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">Size: ~{rec.size}</p>
                  </div>

                  {isInstalled ? (
                    <Badge variant="success" className="flex-shrink-0">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Installed
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => pullModel(rec.name)}
                      disabled={!!pullState || !ollamaOnline}
                      className="flex-shrink-0 h-8 gap-1.5"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </Button>
                  )}
                </div>

                {pullState && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground truncate">{pullState.status}</p>
                      {pullState.total > 0 && (
                        <p className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                          {pullState.progress}%
                        </p>
                      )}
                    </div>
                    {pullState.total > 0 && (
                      <Progress value={pullState.progress} className="h-1.5" />
                    )}
                    {pullState.total > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        {formatBytes(pullState.completed)} / {formatBytes(pullState.total)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Custom model input */}
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={customModel}
            onChange={e => setCustomModel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && customModel.trim()) {
                pullModel(customModel.trim())
                setCustomModel('')
              }
            }}
            placeholder="or enter any model name, e.g. phi4:14b"
            className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!customModel.trim() || !ollamaOnline}
            onClick={() => {
              if (customModel.trim()) {
                pullModel(customModel.trim())
                setCustomModel('')
              }
            }}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Pull
          </Button>
        </div>
      </div>
    </div>
  )
}
