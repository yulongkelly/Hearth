import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getModelAdapter } from '@/lib/adapters/registry'
import type { ChatMessage } from '@/lib/model-adapter'
import { readMemoryTrimmed, readMemoryEntries, queueMemoryWrite, flushMemoryQueue } from '@/lib/memory-store'
import { retrieveRelevantMemory } from '@/lib/memory-retrieval'
import { parseCompactResponse } from '@/lib/compact-parser'
import { OLLAMA_BASE_URL } from '@/lib/ollama'

const HEARTH_MD_PATH = path.join(os.homedir(), '.hearth', 'memory', 'hearth.md')

function loadHearthMd(): string {
  try {
    const content = fs.readFileSync(HEARTH_MD_PATH, 'utf-8')
    if (content.length > 2000) return content.slice(0, 2000) + '\n…(truncated)'
    return content
  } catch { return '' }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { model, messages, memoryThreshold } = body as {
    model: string
    messages: ChatMessage[]
    memoryThreshold?: number
  }

  if (!model || !Array.isArray(messages)) {
    return Response.json({ error: 'model and messages are required' }, { status: 400 })
  }

  const adapter = getModelAdapter()
  const ollamaUrl = OLLAMA_BASE_URL

  // ─── Build memory snapshot (same logic as /api/chat) ──────────────────────
  const contextLength = (await adapter.getContextLength?.(model)) ?? 4096
  const threshold = typeof memoryThreshold === 'number' ? memoryThreshold : 0.20
  const AVG_CHARS_PER_TOKEN = 4
  const totalCharBudget = Math.floor(contextLength * threshold * AVG_CHARS_PER_TOKEN)
  const perFileBudget = Math.floor(totalCharBudget / 2)

  const hearthMd  = loadHearthMd()
  const userBlock = readMemoryTrimmed('user', perFileBudget)

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const memoryEntries = readMemoryEntries('memory')
  const relevantEntries = await retrieveRelevantMemory(lastUserMsg, memoryEntries, 5, ollamaUrl, model)
  const memBlock = relevantEntries.join('\n§\n')

  const memorySnapshot = [
    hearthMd  ? `<hearth>\n${hearthMd}\n</hearth>`              : '',
    userBlock ? `<user_profile>\n${userBlock}\n</user_profile>` : '',
    memBlock  ? `<memory>\n${memBlock}\n</memory>`              : '',
  ].filter(Boolean).join('\n\n')

  // ─── Build compact prompt ─────────────────────────────────────────────────
  const transcript = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const compactPrompt: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a helpful assistant. Produce compact output only — no preamble or explanation.',
    },
    {
      role: 'user',
      content: `Below is a conversation that needs to be compacted. Write two sections:

SUMMARY:
A concise narrative paragraph summarising what was discussed, decided, and accomplished.

FACTS:
Up to 5 declarative facts worth remembering long-term (one per line, starting with "- ", each under 280 chars, no transient time references).

Conversation:
${transcript}`,
    },
  ]

  try {
    const result = await adapter.chat({ model, messages: compactPrompt })
    const { summary, facts } = parseCompactResponse(result.content)

    // Save extracted facts to cross-session memory
    for (const fact of facts) {
      queueMemoryWrite('memory', 'add', fact, ollamaUrl, model)
    }
    if (facts.length > 0) {
      await flushMemoryQueue(ollamaUrl, model)
    }

    return Response.json({ summary, facts, memorySnapshot })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Compact failed' },
      { status: 500 }
    )
  }
}
