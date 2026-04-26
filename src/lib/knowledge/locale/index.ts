import type { KnowledgeLocale } from './types'
import { enLocale } from './en'
import { zhLocale } from './zh'

export type { KnowledgeLocale }

const CJK_RE = /[一-鿿]/

export function getLocaleForText(text: string): KnowledgeLocale {
  return CJK_RE.test(text) ? zhLocale : enLocale
}

/** Stable locale for a user session — reads HEARTH_LOCALE env or falls back to text detection */
export function getLocaleForSession(sampleText: string): KnowledgeLocale {
  const env = process.env.HEARTH_LOCALE
  if (env === 'zh') return zhLocale
  if (env === 'en') return enLocale
  return getLocaleForText(sampleText)
}
