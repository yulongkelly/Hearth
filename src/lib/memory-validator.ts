export interface ValidationResult {
  valid: boolean
  reason: string
}

export const TRANSIENT_PATTERN =
  /\b(today|this session|just now|currently|yesterday|this morning|we completed|i helped|task done|finished)\b/i

export const RAW_DATA_PATTERNS = [
  /[{[]/, // JSON-like structures
  /\d{3,}/, // 3+ consecutive digits (IDs, phone numbers, raw values)
]

export function validateMemoryEntry(content: string): ValidationResult {
  if (!content.trim())
    return { valid: false, reason: 'Entry is empty.' }

  if (content.includes('\n'))
    return { valid: false, reason: 'Entry must be a single line — split into separate facts.' }

  if (content.trim().length > 280)
    return { valid: false, reason: 'Entry exceeds 280 characters — distill to the key fact.' }

  if (/^(I |We )/i.test(content.trim()))
    return { valid: false, reason: 'Entry describes an action — rephrase as a declarative fact (e.g. "User prefers X").' }

  if (TRANSIENT_PATTERN.test(content))
    return { valid: false, reason: 'Entry contains a transient time reference — save stable facts only.' }

  if (/[{[]/.test(content))
    return { valid: false, reason: 'Entry appears to contain JSON or structured data — save the conclusion only.' }

  if (/\d{3,}/.test(content))
    return { valid: false, reason: 'Entry contains a long numeric sequence — save the conclusion only.' }

  return { valid: true, reason: '' }
}
