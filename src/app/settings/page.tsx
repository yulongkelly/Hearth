'use client'

import { useState, useEffect } from 'react'
import { Save, RotateCcw, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { DEFAULT_SETTINGS, type AppSettings } from '@/lib/types'

const SETTINGS_KEY = 'hearth_settings'

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  const save = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const reset = () => {
    setSettings(DEFAULT_SETTINGS)
  }

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center border-b border-border px-6 h-14 flex-shrink-0">
        <h1 className="text-base font-semibold flex-1">Settings</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={reset} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button size="sm" onClick={save} className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saved ? 'Saved!' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6 p-6 max-w-2xl">
        {/* Google Account */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Google Account</CardTitle>
            <CardDescription>Manage your Gmail connection and OAuth credentials.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/integrations">
              <Button size="sm" variant="outline" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Manage in Connected Apps
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Ollama */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ollama Connection</CardTitle>
            <CardDescription>Configure how Hearth connects to your local Ollama instance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Ollama URL</label>
              <Input
                value={settings.ollamaUrl}
                onChange={e => update('ollamaUrl', e.target.value)}
                placeholder="http://localhost:11434"
              />
              <p className="text-xs text-muted-foreground">Default: http://localhost:11434</p>
            </div>
          </CardContent>
        </Card>

        {/* Chat defaults */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Chat Defaults</CardTitle>
            <CardDescription>Default behavior for new conversations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Default Model</label>
              <Input
                value={settings.defaultModel}
                onChange={e => update('defaultModel', e.target.value)}
                placeholder="llama3.2:3b"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to auto-select the first available model.
              </p>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <label className="text-xs font-medium">System Prompt</label>
              <Textarea
                value={settings.systemPrompt}
                onChange={e => update('systemPrompt', e.target.value)}
                rows={4}
                placeholder="You are a helpful AI assistant..."
              />
              <p className="text-xs text-muted-foreground">
                This prompt is sent at the start of every conversation.
              </p>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Streaming</p>
                <p className="text-xs text-muted-foreground">Show responses as they are generated.</p>
              </div>
              <button
                onClick={() => update('streamingEnabled', !settings.streamingEnabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  settings.streamingEnabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.streamingEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Memory */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Memory</CardTitle>
            <CardDescription>Control how much of the model&apos;s context window is reserved for persistent memory.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Memory Context</label>
                <span className="text-xs text-muted-foreground font-mono">{Math.round(settings.memoryThreshold * 100)}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={50}
                step={5}
                value={Math.round(settings.memoryThreshold * 100)}
                onChange={e => update('memoryThreshold', Number(e.target.value) / 100)}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                How much of the model&apos;s context window to use for memory. Lower values leave more room for conversation. Default: 20%.
              </p>
            </div>
            <Separator />
            <Link href="/memory">
              <Button size="sm" variant="outline" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Review &amp; Edit Memory
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">About Hearth</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Version</span>
              <span>0.1.0</span>
            </div>
            <div className="flex justify-between">
              <span>License</span>
              <span>MIT</span>
            </div>
            <div className="flex justify-between">
              <span>AI Engine</span>
              <span>Ollama (local)</span>
            </div>
            <Separator className="my-2" />
            <p>
              Hearth is open source. All AI processing happens locally on your machine.
              Your data never leaves your computer.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
