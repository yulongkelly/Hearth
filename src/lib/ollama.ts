export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

export interface OllamaModel {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

export interface OllamaRunningModel {
  name: string
  model: string
  size: number
  digest: string
  details: OllamaModel['details']
  expires_at: string
  size_vram: number
}

export interface OllamaTagsResponse {
  models: OllamaModel[]
}

export interface OllamaPsResponse {
  models: OllamaRunningModel[]
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OllamaChatChunk {
  model: string
  created_at: string
  message: {
    role: string
    content: string
  }
  done: boolean
  done_reason?: string
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  eval_count?: number
}

export interface OllamaPullChunk {
  status: string
  digest?: string
  total?: number
  completed?: number
}

export async function checkOllamaStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function listModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`)
  if (!res.ok) throw new Error('Failed to fetch models')
  const data: OllamaTagsResponse = await res.json()
  return data.models || []
}

export async function listRunningModels(): Promise<OllamaRunningModel[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/ps`)
  if (!res.ok) throw new Error('Failed to fetch running models')
  const data: OllamaPsResponse = await res.json()
  return data.models || []
}

export async function deleteModel(name: string): Promise<void> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to delete model')
}

export const RECOMMENDED_MODELS = [
  {
    name: 'llama3.2:3b',
    label: 'Llama 3.2 (3B)',
    description: 'Fast and capable. Best for most users.',
    size: '2 GB',
    tags: ['Recommended', 'English'],
  },
  {
    name: 'qwen2.5:3b',
    label: 'Qwen 2.5 (3B)',
    description: 'Excellent Chinese and English support.',
    size: '2 GB',
    tags: ['Recommended', '中文'],
  },
  {
    name: 'llama3.2:1b',
    label: 'Llama 3.2 (1B)',
    description: 'Smallest model, runs on any machine.',
    size: '1.3 GB',
    tags: ['Fastest'],
  },
  {
    name: 'qwen2.5:7b',
    label: 'Qwen 2.5 (7B)',
    description: 'High quality Chinese and English. Needs 8GB RAM.',
    size: '4.7 GB',
    tags: ['High Quality', '中文'],
  },
  {
    name: 'mistral:7b',
    label: 'Mistral (7B)',
    description: 'Strong reasoning and coding. Needs 8GB RAM.',
    size: '4.1 GB',
    tags: ['Coding'],
  },
  {
    name: 'deepseek-r1:7b',
    label: 'DeepSeek R1 (7B)',
    description: 'Chain-of-thought reasoning. Needs 8GB RAM.',
    size: '4.7 GB',
    tags: ['Reasoning'],
  },
] as const
