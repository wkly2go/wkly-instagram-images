import type { SupabaseClient } from '@supabase/supabase-js'
import { literalSearchFilter } from './growthSearch.ts'
import { safeWebUrl } from './growth.ts'
import type { Client, ClientCategory, Contact } from './types'

const RESULT_LIMIT = 8
const RESULT_CLIENT_COLUMNS = 'id,name,category,website'
type ClientMatch = Pick<Client, 'id' | 'name' | 'category' | 'website'>
type ContactMatch = Pick<Contact, 'id' | 'name' | 'title'>
type JoinedContactMatch = ContactMatch & { client: ClientMatch | null }

export interface ProspectingClientResult {
  clientId: string
  clientName: string
  category: ClientCategory
  website?: string
  contactId?: string
  contactName?: string
  contactTitle?: string
}

function searchTerm(query: string): string {
  const term = query.trim()
  if (!term || term.length > 100 || /[\u0000-\u001f\u007f]/.test(term)) throw new Error('거래처·담당자 검색어를 1~100자로 입력해 주세요.')
  return term
}

function resultFrom(client: ClientMatch, contact?: ContactMatch): ProspectingClientResult {
  return {
    clientId: client.id,
    clientName: client.name,
    category: client.category,
    ...(client.website && safeWebUrl(client.website) ? { website: client.website } : {}),
    ...(contact && { contactId: contact.id, contactName: contact.name, ...(contact.title && { contactTitle: contact.title }) }),
  }
}

/** Use the signed-in Supabase client and the existing clients/contacts SELECT policies. */
export async function searchSupabaseProspectingClients(client: SupabaseClient, query: string): Promise<ProspectingClientResult[]> {
  const term = searchTerm(query)
  const [clients, contacts] = await Promise.all([
    client.from('clients').select(RESULT_CLIENT_COLUMNS).or(literalSearchFilter(['name'], term)).order('name').order('id').limit(RESULT_LIMIT),
    client.from('contacts').select(`id,name,title,client:clients!inner(${RESULT_CLIENT_COLUMNS})`)
      .or(literalSearchFilter(['name', 'title'], term)).order('name').order('id').limit(RESULT_LIMIT),
  ])
  if (clients.error || contacts.error) throw new Error('기존 거래처·담당자를 조회하지 못했습니다. 다시 조회해 주세요.')
  const clientRows = (clients.data ?? []) as ClientMatch[]
  const contactRows = (contacts.data ?? []) as unknown as JoinedContactMatch[]
  return [
    ...clientRows.slice(0, RESULT_LIMIT).map(row => resultFrom(row)),
    ...contactRows.slice(0, RESULT_LIMIT).flatMap(row => row.client ? [resultFrom(row.client, row)] : []),
  ]
}

export function searchDemoProspectingClients(clients: readonly Client[], contacts: readonly Contact[], query: string): ProspectingClientResult[] {
  const term = searchTerm(query).toLowerCase()
  const matches = (value: string | null) => !!value?.toLowerCase().includes(term)
  const order = (a: { name: string; id: string }, b: { name: string; id: string }) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id)
  const existing = new Map(clients.map(row => [row.id, row]))
  return [
    ...clients.filter(row => matches(row.name)).sort(order).slice(0, RESULT_LIMIT).map(row => resultFrom(row)),
    ...contacts.filter(row => (matches(row.name) || matches(row.title)) && existing.has(row.client_id)).sort(order).slice(0, RESULT_LIMIT)
      .map(row => resultFrom(existing.get(row.client_id)!, row)),
  ]
}
