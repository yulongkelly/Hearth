// Single source of truth for UI schema (v1)
// LLM produces one of these 3 types. Renderer handles all 3. No other render paths.

export type BadgeVariant = 'default' | 'success' | 'destructive' | 'warning'

export interface CardItem {
  headline: string
  subtext?: string
  tags?: string[]
  note?: string
}

export interface ListItem {
  text: string
  detail?: string
  tags?: string[]
}

export interface CardPage {
  type: 'card_page'
  title?: string
  badge?: { text: string; variant: BadgeVariant }
  cards: CardItem[]
}

export interface ListPage {
  type: 'list_page'
  title?: string
  badge?: { text: string; variant: BadgeVariant }
  items: ListItem[]
}

export interface TextPage {
  type: 'text_page'
  title?: string
  body: string
}

export type UIPage = CardPage | ListPage | TextPage

// Always returns a valid UIPage — never throws. Degrades tier on bad input.
export function validatePage(raw: string): UIPage {
  try {
    const obj = JSON.parse(raw)
    if (obj?.type === 'card_page' && Array.isArray(obj.cards) && obj.cards.length > 0)
      return obj as CardPage
    if (obj?.type === 'list_page' && Array.isArray(obj.items) && obj.items.length > 0)
      return obj as ListPage
    if (obj?.type === 'text_page' && typeof obj.body === 'string')
      return obj as TextPage
    // Legacy: {items:[{headline,...}]} — treat as card_page
    if (Array.isArray(obj?.items) && obj.items.length > 0) {
      return {
        type: 'card_page',
        title: obj.title,
        badge: obj.badge,
        cards: obj.items.map((i: Record<string, unknown>) => ({
          headline: String(i.headline ?? i.text ?? ''),
          subtext:  i.subtext ? String(i.subtext) : undefined,
          tags:     Array.isArray(i.tags) ? i.tags.map(String) : undefined,
          note:     i.note ? String(i.note) : undefined,
        })),
      }
    }
  } catch {}
  // Final fallback: text_page
  return { type: 'text_page', body: raw }
}
