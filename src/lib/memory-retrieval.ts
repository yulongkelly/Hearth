import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

const EMBEDDINGS_FILE = path.join(os.homedir(), '.hearth', 'memory', 'embeddings.json')

type EmbeddingCache = Record<string, number[]>

let embeddingCache: EmbeddingCache | null = null

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function loadEmbeddingCache(): EmbeddingCache {
  if (embeddingCache !== null) return embeddingCache
  try {
    const raw = fs.readFileSync(EMBEDDINGS_FILE, 'utf-8')
    embeddingCache = JSON.parse(raw) as EmbeddingCache
  } catch {
    embeddingCache = {}
  }
  return embeddingCache
}

function saveEmbeddingCache(cache: EmbeddingCache): void {
  try {
    const dir = path.dirname(EMBEDDINGS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(EMBEDDINGS_FILE, JSON.stringify(cache), { encoding: 'utf-8' })
  } catch {}
}

async function fetchEmbedding(
  text: string,
  ollamaUrl: string,
  model: string,
): Promise<number[] | null> {
  try {
    const res = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { embedding?: number[] }
    return Array.isArray(data.embedding) ? data.embedding : null
  } catch {
    return null
  }
}

async function getEmbedding(
  text: string,
  ollamaUrl: string,
  model: string,
): Promise<number[] | null> {
  const cache = loadEmbeddingCache()
  const key = sha256(text)
  if (cache[key]) return cache[key]

  const embedding = await fetchEmbedding(text, ollamaUrl, model)
  if (embedding) {
    cache[key] = embedding
    saveEmbeddingCache(cache)
  }
  return embedding
}

export async function retrieveRelevantMemory(
  query: string,
  entries: string[],
  topK = 5,
  ollamaUrl: string,
  model: string,
): Promise<string[]> {
  if (entries.length === 0) return []

  const queryEmb = await fetchEmbedding(query, ollamaUrl, model)
  if (!queryEmb) return entries.slice(-topK)

  const scored: { entry: string; score: number }[] = []
  for (const entry of entries) {
    const emb = await getEmbedding(entry, ollamaUrl, model)
    if (!emb) continue
    scored.push({ entry, score: cosineSimilarity(queryEmb, emb) })
  }

  const filtered = scored
    .filter(s => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.entry)

  return filtered.length > 0 ? filtered : entries.slice(-topK)
}

export async function isSemanticDuplicate(
  candidate: string,
  existingEntries: string[],
  ollamaUrl: string,
  model: string,
  threshold = 0.85,
): Promise<{ isDuplicate: boolean; matchedEntry: string | null }> {
  if (existingEntries.length === 0) return { isDuplicate: false, matchedEntry: null }

  const candidateEmb = await getEmbedding(candidate, ollamaUrl, model)
  if (!candidateEmb) return { isDuplicate: false, matchedEntry: null }

  for (const entry of existingEntries) {
    const entryEmb = await getEmbedding(entry, ollamaUrl, model)
    if (!entryEmb) continue
    if (cosineSimilarity(candidateEmb, entryEmb) >= threshold) {
      return { isDuplicate: true, matchedEntry: entry }
    }
  }
  return { isDuplicate: false, matchedEntry: null }
}
