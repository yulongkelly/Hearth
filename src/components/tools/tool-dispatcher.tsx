'use client'

import { useState, useEffect } from 'react'
import { loadWorkflowTools } from '@/lib/workflow-tools'
import { loadUserTools } from '@/lib/user-tools'
import { WorkflowRunPage } from './workflow-run-page'
import { ToolPage } from './tool-page'

export function ToolDispatcher({ id }: { id: string }) {
  const [type, setType] = useState<'workflow' | 'legacy' | 'unknown' | null>(null)

  useEffect(() => {
    if (loadWorkflowTools().some(t => t.id === id)) setType('workflow')
    else if (loadUserTools().some(t => t.id === id)) setType('legacy')
    else setType('unknown')
  }, [id])

  if (type === null) return null
  if (type === 'workflow') return <WorkflowRunPage id={id} />
  return <ToolPage id={id} />
}
