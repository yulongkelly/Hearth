import { getModelAdapter } from '@/lib/adapters/registry'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedEvent {
  type: 'purchase' | 'travel' | 'subscription' | 'task' | 'unknown'
  timestamp: number
  data: Record<string, unknown>
  source: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getModel(): string {
  return process.env.HEARTH_LLM_MODEL ?? 'llama3.2'
}

function score(text: string, keywords: string[]): number {
  const lower = text.toLowerCase()
  return keywords.filter(k => lower.includes(k)).length
}

function extractJsonFromText(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first !== -1 && last > first) return raw.slice(first, last + 1)
  return raw.trim()
}

async function llmJson(systemPrompt: string, userContent: string): Promise<unknown> {
  const adapter = getModelAdapter()
  const result = await adapter.chat({
    model: getModel(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    signal: AbortSignal.timeout(60_000),
  })
  try {
    return JSON.parse(extractJsonFromText(result.content))
  } catch {
    return null
  }
}

// ─── Layer 1: Raw tools (no LLM) ─────────────────────────────────────────────

function execParseHtml(args: Record<string, unknown>): string {
  const html = String(args.html ?? args.text ?? args.input ?? '')
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text
}

function execExtractText(args: Record<string, unknown>): string {
  const input = args.input ?? args.text ?? args.document ?? ''
  if (typeof input === 'string') {
    // Strip HTML if it looks like HTML
    if (input.includes('<') && input.includes('>')) {
      return execParseHtml({ html: input })
    }
    return input.trim()
  }
  if (typeof input === 'object' && input !== null) {
    const doc = input as Record<string, unknown>
    const content = doc.content ?? doc.body ?? doc.text ?? doc.html ?? ''
    return execExtractText({ input: content })
  }
  return String(input)
}

const RECEIPT_KEYWORDS = [
  'receipt', 'invoice', 'payment received', 'order confirmation',
  'thank you for your purchase', 'your purchase', 'amount charged',
  'total:', 'subtotal:', 'amount due', 'billing', 'charged to',
  'transaction id', 'payment method', 'order total',
]

const ORDER_KEYWORDS = [
  'order confirmation', 'order number', 'order #', 'your order',
  'has been shipped', 'has shipped', 'item(s)', 'quantity',
  'estimated delivery', 'tracking number', 'dispatched', 'placed an order',
]

const SUBSCRIPTION_KEYWORDS = [
  'subscription', 'renewal', 'auto-renew', 'auto renew', 'recurring',
  'next charge', 'next billing', 'billing date', 'subscription renewed',
  'your plan', 'membership', 'free trial ends', 'trial expired',
]

function detectKeywords(text: string, keywords: string[]): { matched: string[]; confidence: number } {
  const lower = text.toLowerCase()
  const matched = keywords.filter(k => lower.includes(k))
  const raw = matched.length / Math.min(keywords.length, 5)
  const confidence = Math.min(raw, 1)
  return { matched, confidence }
}

function execDetectReceipt(args: Record<string, unknown>): string {
  const text = String(args.text ?? args.input ?? '')
  const { matched, confidence } = detectKeywords(text, RECEIPT_KEYWORDS)
  const crossCheck = score(text, ORDER_KEYWORDS) + score(text, SUBSCRIPTION_KEYWORDS)
  const adjusted = matched.length > 0 ? Math.max(confidence - crossCheck * 0.05, 0.1) : 0
  return JSON.stringify({
    isReceipt: matched.length >= 2 || (matched.length === 1 && confidence > 0.15),
    confidence: parseFloat(adjusted.toFixed(2)),
    reason: matched.length > 0 ? `Matched: ${matched.slice(0, 3).join(', ')}` : 'No receipt keywords found',
  })
}

function execDetectOrder(args: Record<string, unknown>): string {
  const text = String(args.text ?? args.input ?? '')
  const { matched, confidence } = detectKeywords(text, ORDER_KEYWORDS)
  return JSON.stringify({
    isOrder: matched.length >= 2 || (matched.length === 1 && confidence > 0.15),
    confidence: parseFloat(confidence.toFixed(2)),
    reason: matched.length > 0 ? `Matched: ${matched.slice(0, 3).join(', ')}` : 'No order keywords found',
  })
}

function execDetectSubscription(args: Record<string, unknown>): string {
  const text = String(args.text ?? args.input ?? '')
  const { matched, confidence } = detectKeywords(text, SUBSCRIPTION_KEYWORDS)
  return JSON.stringify({
    isSubscription: matched.length >= 2 || (matched.length === 1 && confidence > 0.15),
    confidence: parseFloat(confidence.toFixed(2)),
    reason: matched.length > 0 ? `Matched: ${matched.slice(0, 3).join(', ')}` : 'No subscription keywords found',
  })
}

// ─── Layer 2: LLM-powered ─────────────────────────────────────────────────────

async function execClassify(args: Record<string, unknown>): Promise<string> {
  const text = String(args.text ?? args.input ?? '').slice(0, 3000)
  const labels = Array.isArray(args.labels) ? (args.labels as string[]) : []
  if (labels.length === 0) return JSON.stringify({ error: 'labels array is required' })

  const result = await llmJson(
    `Classify the given text into exactly one of the provided labels. Return ONLY valid JSON: {"label":"<label>","confidence":0.0}`,
    `Labels: ${JSON.stringify(labels)}\n\nText:\n${text}`,
  )
  return result ? JSON.stringify(result) : JSON.stringify({ label: labels[0], confidence: 0.5 })
}

async function execExtractStructured(args: Record<string, unknown>): Promise<string> {
  const text = String(args.text ?? args.input ?? '').slice(0, 4000)
  const schema = args.schema ?? {}

  const result = await llmJson(
    `Extract structured information from the text. Return ONLY valid JSON matching the provided schema. If a field is not found, use null.`,
    `Schema: ${JSON.stringify(schema)}\n\nText:\n${text}`,
  )
  return result ? JSON.stringify(result) : JSON.stringify({ error: 'extraction failed', raw: text.slice(0, 200) })
}

const RECEIPT_SCHEMA = {
  vendor: 'string — merchant or store name',
  price: 'number — total amount paid',
  currency: 'string — currency code, e.g. USD, CNY',
  date: 'string — purchase date in YYYY-MM-DD format if found',
  items: 'array of {name: string, quantity: number, price: number}',
}

async function execParseReceipt(args: Record<string, unknown>): Promise<string> {
  const text = String(args.text ?? args.input ?? '').slice(0, 4000)
  return execExtractStructured({ text, schema: RECEIPT_SCHEMA })
}

const TRAVEL_SCHEMA = {
  departure: 'string — departure city or airport',
  destination: 'string — destination city or airport',
  date: 'string — travel date in YYYY-MM-DD',
  return_date: 'string — return date if round trip, else null',
  confirmation_code: 'string — booking/confirmation number',
  airline_or_carrier: 'string — airline, train, or carrier name',
  price: 'number — total price paid, or null',
  currency: 'string — currency code',
}

async function execParseTravel(args: Record<string, unknown>): Promise<string> {
  const text = String(args.text ?? args.input ?? '').slice(0, 4000)
  return execExtractStructured({ text, schema: TRAVEL_SCHEMA })
}

const EMAIL_EVENT_SCHEMA = {
  type: 'one of: purchase, travel, subscription, task, unknown',
  timestamp: 'number — unix timestamp in ms if date found, else 0',
  summary: 'string — one sentence summary of the email',
  data: 'object — key facts extracted (vendor, price, date, items, etc.)',
  source: 'string — sender email or domain if found',
}

async function execParseEmailToEvent(args: Record<string, unknown>): Promise<string> {
  const text = String(args.text ?? args.input ?? args.email ?? '').slice(0, 4000)
  return execExtractStructured({ text, schema: EMAIL_EVENT_SCHEMA })
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function executeContentTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'content_parse_html':           return execParseHtml(args)
    case 'content_extract_text':         return execExtractText(args)
    case 'content_detect_receipt':       return execDetectReceipt(args)
    case 'content_detect_order':         return execDetectOrder(args)
    case 'content_detect_subscription':  return execDetectSubscription(args)
    case 'content_classify':             return execClassify(args)
    case 'content_extract_structured':   return execExtractStructured(args)
    case 'content_parse_receipt':        return execParseReceipt(args)
    case 'content_parse_travel':         return execParseTravel(args)
    case 'content_parse_email_to_event': return execParseEmailToEvent(args)
    default:                             return `Error: unknown content tool "${name}"`
  }
}
