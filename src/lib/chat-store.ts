import type { UserTool } from './user-tools'
import type { WorkflowTool } from './workflow-tools'
import type { ToolAccess } from './tool-access'
import type { ClarificationQuestion } from '@/components/chat/questions-popup'

export interface PendingApproval {
  id:      string
  tool:    string
  preview: string
  risk:    ToolAccess
}

export interface PendingQuestions {
  id:        string
  questions: ClarificationQuestion[]
}

export interface ChatStreamState {
  convoId:          string
  toolStatus:       string | null
  pendingApprovals: PendingApproval[]
  pendingQuestions: PendingQuestions | null
  pendingTool:      UserTool | null
  pendingWorkflow:  WorkflowTool | null
}

let activeStream: ChatStreamState | null = null
let abortCtrl:    AbortController | null = null

const EVENT = 'hearth:chat-stream'

function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

export function startStream(convoId: string, ctrl: AbortController): void {
  abortCtrl    = ctrl
  activeStream = {
    convoId, toolStatus: null,
    pendingApprovals: [], pendingQuestions: null,
    pendingTool: null, pendingWorkflow: null,
  }
  emit()
}

export function updateToolStatus(status: string | null): void {
  if (!activeStream) return
  activeStream = { ...activeStream, toolStatus: status }
  emit()
}

export function addPendingApproval(a: PendingApproval): void {
  if (!activeStream) return
  activeStream = { ...activeStream, pendingApprovals: [...activeStream.pendingApprovals, a] }
  emit()
}

export function removePendingApproval(id: string): void {
  if (!activeStream) return
  activeStream = { ...activeStream, pendingApprovals: activeStream.pendingApprovals.filter(a => a.id !== id) }
  emit()
}

export function setPendingQuestions(q: PendingQuestions | null): void {
  if (!activeStream) return
  activeStream = { ...activeStream, pendingQuestions: q }
  emit()
}

export function setPendingTool(t: UserTool | null): void {
  if (!activeStream) return
  activeStream = { ...activeStream, pendingTool: t }
  emit()
}

export function setPendingWorkflow(w: WorkflowTool | null): void {
  if (!activeStream) return
  activeStream = { ...activeStream, pendingWorkflow: w }
  emit()
}

export function endStream(): void {
  activeStream = null
  abortCtrl    = null
  emit()
}

export function abortStream(): void {
  abortCtrl?.abort()
  activeStream = null
  abortCtrl    = null
  emit()
}

export function getActiveStream(): ChatStreamState | null {
  return activeStream
}

export function isActive(): boolean {
  return activeStream !== null
}

export function subscribe(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
