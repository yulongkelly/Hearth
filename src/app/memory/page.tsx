'use client'

import { useState, useEffect } from 'react'
import { Pencil, Save, X, Brain, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Panel = 'memory' | 'user'

interface PanelState {
  content: string
  editing: boolean
  draft: string
  saving: boolean
  saved: boolean
}

const EMPTY_PANEL: PanelState = { content: '', editing: false, draft: '', saving: false, saved: false }

export default function MemoryPage() {
  const [panels, setPanels] = useState<Record<Panel, PanelState>>({
    memory: EMPTY_PANEL,
    user:   EMPTY_PANEL,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/memory')
      .then(r => r.json())
      .then(data => {
        setPanels({
          memory: { ...EMPTY_PANEL, content: data.memory ?? '', draft: data.memory ?? '' },
          user:   { ...EMPTY_PANEL, content: data.user   ?? '', draft: data.user   ?? '' },
        })
      })
      .finally(() => setLoading(false))
  }, [])

  function startEdit(target: Panel) {
    setPanels(prev => ({ ...prev, [target]: { ...prev[target], editing: true, draft: prev[target].content } }))
  }

  function cancelEdit(target: Panel) {
    setPanels(prev => ({ ...prev, [target]: { ...prev[target], editing: false, draft: prev[target].content } }))
  }

  async function save(target: Panel) {
    setPanels(prev => ({ ...prev, [target]: { ...prev[target], saving: true } }))
    const draft = panels[target].draft
    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, content: draft }),
    })
    setPanels(prev => ({
      ...prev,
      [target]: { ...prev[target], saving: false, saved: true, editing: false, content: draft },
    }))
    setTimeout(() => {
      setPanels(prev => ({ ...prev, [target]: { ...prev[target], saved: false } }))
    }, 2000)
  }

  const panels_config: { key: Panel; label: string; description: string; Icon: typeof Brain }[] = [
    { key: 'memory', label: 'Agent Memory', description: 'Facts, conventions, and environment details the AI has learned.', Icon: Brain },
    { key: 'user',   label: 'User Profile', description: 'Your preferences, habits, and personal details.', Icon: User },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border px-6 h-14 flex-shrink-0">
        <h1 className="text-base font-semibold">Memory</h1>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-6 overflow-auto p-6 md:grid-cols-2">
          {panels_config.map(({ key, label, description, Icon }) => {
            const p = panels[key]
            const charCount = p.content.length
            return (
              <div key={key} className="flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                    {p.editing ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => cancelEdit(key)} className="h-7 px-2">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" onClick={() => save(key)} disabled={p.saving} className="h-7 px-3 text-xs">
                          <Save className="h-3.5 w-3.5 mr-1" />
                          {p.saving ? 'Saving…' : p.saved ? 'Saved!' : 'Save'}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => startEdit(key)} className="h-7 px-2">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Textarea
                    value={p.editing ? p.draft : p.content}
                    onChange={e => setPanels(prev => ({ ...prev, [key]: { ...prev[key], draft: e.target.value } }))}
                    readOnly={!p.editing}
                    rows={14}
                    placeholder={p.editing ? 'Write memory entries here…' : '(empty — the AI will populate this as you chat)'}
                    className={cn(
                      'resize-none font-mono text-xs leading-relaxed',
                      !p.editing && 'cursor-default opacity-80',
                    )}
                  />
                  <p className="text-[10px] text-muted-foreground text-right">{charCount} chars</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
