'use client'

import { useState } from 'react'
import { Eye, EyeOff, ExternalLink, Loader2, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PendingConnection } from '@/lib/chat-store'

interface Props {
  connection: PendingConnection
  onSuccess: (connectionId: string) => void
  onCancel: () => void
}

export function ConnectionSetupCard({ connection, onSuccess, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(connection.fields.map(f => [f.name, '']))
  )
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  function handleChange(name: string, value: string) {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  function toggleShow(name: string) {
    setShowPassword(prev => ({ ...prev, [name]: !prev[name] }))
  }

  const canSubmit = status === 'idle' || status === 'error'

  async function handleConnect() {
    setStatus('verifying')
    setErrorMsg('')
    try {
      const setupRes = await fetch('/api/connections/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service:     connection.service,
          credentials: values,
          testUrl:     connection.test_url,
          testMethod:  connection.test_method,
          testHeaders: connection.test_headers,
        }),
      })
      const data = await setupRes.json()
      if (!data.ok) {
        setStatus('error')
        setErrorMsg(data.error ?? 'Verification failed')
        return
      }

      setStatus('success')
      // Notify the chat route that the connection is ready
      await fetch('/api/connections/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: connection.id, ok: true, connectionId: data.id }),
      })
      onSuccess(data.id)
    } catch {
      setStatus('error')
      setErrorMsg('Network error — please try again')
    }
  }

  async function handleCancel() {
    await fetch('/api/connections/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: connection.id, ok: false, error: 'User cancelled' }),
    })
    onCancel()
  }

  return (
    <div className="border-t border-border bg-card">
      <div className="px-4 pt-3 pb-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Connect {connection.service}
        </p>
      </div>

      <div className="px-4 pb-4 space-y-4">
        {/* Instructions */}
        {connection.instructions && (
          <p className="text-sm text-muted-foreground leading-relaxed">{connection.instructions}</p>
        )}

        {/* Links */}
        {connection.links?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {connection.links.map(l => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {l.label}
              </a>
            ))}
          </div>
        )}

        {/* Credential fields */}
        <div className="space-y-3">
          {connection.fields.map(f => (
            <div key={f.name} className="space-y-1">
              <p className="text-xs font-medium text-foreground">{f.label}</p>
              <div className="relative">
                <Input
                  type={f.type === 'password' && !showPassword[f.name] ? 'password' : 'text'}
                  placeholder={f.placeholder ?? ''}
                  value={values[f.name] ?? ''}
                  onChange={e => handleChange(f.name, e.target.value)}
                  disabled={status === 'verifying' || status === 'success'}
                  className="h-8 text-sm pr-8"
                />
                {f.type === 'password' && (
                  <button
                    type="button"
                    onClick={() => toggleShow(f.name)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword[f.name]
                      ? <EyeOff className="h-3.5 w-3.5" />
                      : <Eye className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Status feedback */}
        {status === 'verifying' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Verifying connection…
          </div>
        )}
        {status === 'success' && (
          <div className="flex items-center gap-2 text-xs text-green-500">
            <CheckCircle className="h-3.5 w-3.5" />
            Connected successfully
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <XCircle className="h-3.5 w-3.5" />
            {errorMsg}
          </div>
        )}

        {/* Actions */}
        {status !== 'success' && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={status === 'verifying'}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConnect} disabled={status === 'verifying'}>
              {status === 'verifying' ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
