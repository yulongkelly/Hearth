// Query compiler: converts Gmail-format query strings to provider-specific formats.
// Gmail syntax is used as the source of truth by the planner.

export type OutlookQuery = { search?: string; filter?: string }
export type ImapCriteria = object

// Compile a Gmail query to Outlook OData ($search + $filter).
export function compileForOutlook(query: string): OutlookQuery {
  let q = query
    .replace(/\bcategory:purchases?\b/gi, 'invoice OR receipt OR order')
    .replace(/\b(?:has|label|is|in|category):\S+/gi, '')

  const afterMatch  = q.match(/\bafter:(\d{4}\/\d{2}\/\d{2})/i)
  const beforeMatch = q.match(/\bbefore:(\d{4}\/\d{2}\/\d{2})/i)
  if (afterMatch)  q = q.replace(afterMatch[0], '')
  if (beforeMatch) q = q.replace(beforeMatch[0], '')

  const filters: string[] = []
  if (afterMatch)  filters.push(`receivedDateTime ge ${afterMatch[1].replace(/\//g, '-')}T00:00:00Z`)
  if (beforeMatch) filters.push(`receivedDateTime lt ${beforeMatch[1].replace(/\//g, '-')}T00:00:00Z`)

  // Unwrap subject:(...) and subject:word
  q = q.replace(/\bsubject:\(([^)]+)\)/gi, '$1').replace(/\bsubject:(\S+)/gi, '$1')

  // Normalize OR / AND and strip parens
  q = q.replace(/[()'"]/g, '').trim()

  return {
    search: q || undefined,
    filter: filters.length ? filters.join(' and ') : undefined,
  }
}

// Compile a Gmail-style query string to an ImapFlow SearchObject.
export function compileQueryToImap(query: string): ImapCriteria {
  let q = query
    .replace(/\bcategory:purchases?\b/gi, 'receipt OR invoice OR order')
    .replace(/\b(?:has|label|is|in|category):\S+/gi, '')

  const fromMatch  = q.match(/\bfrom:(\S+)/i)
  const fromVal    = fromMatch?.[1]
  if (fromMatch)   q = q.replace(fromMatch[0], '')

  const afterMatch  = q.match(/\bafter:(\d{4}\/\d{2}\/\d{2})/i)
  const afterVal    = afterMatch?.[1]
  if (afterMatch)   q = q.replace(afterMatch[0], '')

  const beforeMatch = q.match(/\bbefore:(\d{4}\/\d{2}\/\d{2})/i)
  const beforeVal   = beforeMatch?.[1]
  if (beforeMatch)  q = q.replace(beforeMatch[0], '')

  q = q.replace(/\bsubject:\(([^)]+)\)/gi, '$1').replace(/\bsubject:(\S+)/gi, '$1')

  const terms = q.split(/ OR /i).map(t => t.trim().replace(/[()'"]/g, '')).filter(Boolean)

  const base: Record<string, unknown> = {}
  if (fromVal)   base.from   = fromVal
  if (afterVal)  base.since  = new Date(afterVal.replace(/\//g, '-'))
  if (beforeVal) base.before = new Date(beforeVal.replace(/\//g, '-'))

  if (terms.length === 0) return base
  if (terms.length === 1) return { ...base, text: terms[0] }
  return { ...base, or: terms.map(t => ({ text: t })) as [object, object, ...object[]] }
}
