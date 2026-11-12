import type { GrowthItem, GrowthKind } from './growth'

const documentFields = {
  contact: ['email', 'instagram', 'brand', 'name'],
  tender: ['number', 'agency'],
  content: [],
} as const

/** Literal, case-insensitive substring search, including JSON contact/tender fields. */
export function growthSearchFilter(kind: GrowthKind, search: string): string | null {
  const term = search.trim()
  if (!term) return null
  // imatch avoids PostgREST's ilike '*' alias; user input must never become a regex.
  const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // OR values have their own grammar; quote commas/parens and escape quotes/backslashes.
  // https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters
  const value = `"${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return ['title', ...documentFields[kind].map(field => `document->>${field}`)]
    .map(field => `${field}.imatch.${value}`).join(',')
}

export function matchesGrowthSearch(item: GrowthItem, search: string): boolean {
  const term = search.trim().toLowerCase()
  return [item.title, ...documentFields[item.kind].map(field => item.document[field])]
    .some(value => typeof value === 'string' && value.toLowerCase().includes(term))
}
