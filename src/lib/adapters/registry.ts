import type { ModelAdapter } from '@/lib/model-adapter'
import { OllamaAdapter } from './ollama-adapter'
import { OpenAIAdapter } from './openai-adapter'

export type Provider = 'ollama' | 'openai' | 'lmstudio'

const LM_STUDIO_DEFAULT_BASE = 'http://localhost:1234/v1'
const OPENAI_DEFAULT_BASE    = 'https://api.openai.com/v1'

export function getModelAdapter(provider?: Provider): ModelAdapter {
  const p = (provider ?? process.env.HEARTH_LLM_PROVIDER ?? 'ollama') as Provider

  switch (p) {
    case 'ollama':
      return new OllamaAdapter()

    case 'lmstudio':
      return new OpenAIAdapter(
        process.env.HEARTH_LLM_BASE_URL ?? LM_STUDIO_DEFAULT_BASE,
        ''
      )

    case 'openai':
      return new OpenAIAdapter(
        process.env.HEARTH_LLM_BASE_URL ?? OPENAI_DEFAULT_BASE,
        process.env.HEARTH_LLM_API_KEY ?? ''
      )

    default:
      throw new Error(`Unknown HEARTH_LLM_PROVIDER: "${p}". Valid values: ollama, openai, lmstudio`)
  }
}
