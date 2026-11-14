import type { SupabaseClient } from '@supabase/supabase-js'
import type { Client, Contact, Project, ResearchSummary } from './types'
import type { SalesSummary } from './sales'

export const COMPANY_CONTEXT_PAGE_SIZE = 10
export const COMPANY_CONTEXT_PAGES = { contacts: 0, research: 0, sales: 0, projects: 0 }
export type CompanyContextPages = typeof COMPANY_CONTEXT_PAGES
export interface CompanyRecordPage<T> { items: T[]; total: number | null; error: string | null }
export type CompanyResearch = Pick<ResearchSummary, 'id' | 'client_id' | 'title' | 'kind' | 'summary' | 'status' | 'updated_at'>
export type CompanySales = Pick<SalesSummary, 'id' | 'client_id' | 'title' | 'stage' | 'owner_id' | 'next_action' | 'next_date' | 'updated_at'>
export type CompanyProject = Pick<Project, 'id' | 'client_id' | 'code' | 'name' | 'status' | 'description' | 'owner_id' | 'start_date' | 'end_date' | 'updated_at'>
export interface SalesCompanyContext {
  company: Pick<Client, 'id' | 'name' | 'category' | 'phone' | 'email' | 'address' | 'website' | 'memo' | 'updated_at'>
  contacts: CompanyRecordPage<Contact>
  research: CompanyRecordPage<CompanyResearch>
  sales: CompanyRecordPage<CompanySales>
  projects: CompanyRecordPage<CompanyProject>
}

/** Only explicit client links are used. RLS on each existing table remains in effect. */
export async function readSalesCompanyContext(sb: SupabaseClient, clientId: string, pages: CompanyContextPages): Promise<SalesCompanyContext | null> {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(clientId)) throw new Error('연결된 거래처를 확인해 주세요.')
  for (const key of Object.keys(COMPANY_CONTEXT_PAGES) as (keyof CompanyContextPages)[]) {
    if (!Number.isSafeInteger(pages[key]) || pages[key] < 0 || pages[key] > 100000) throw new Error('자료 목록의 페이지를 다시 선택해 주세요.')
  }
  const company = await sb.from('clients').select('id,name,category,phone,email,address,website,memo,updated_at').eq('id', clientId).maybeSingle()
  if (company.error) throw new Error(company.error.message)
  if (!company.data) return null

  async function page<T>(table: string, columns: string, sort: string, index: number): Promise<CompanyRecordPage<T>> {
    try {
      const start = index * COMPANY_CONTEXT_PAGE_SIZE
      const result = await sb.from(table).select(columns, { count: 'exact' }).eq('client_id', clientId)
        .order(sort, { ascending: false }).order('id').range(start, start + COMPANY_CONTEXT_PAGE_SIZE - 1)
      if (result.error) throw new Error(result.error.message)
      if (result.count === null) throw new Error('자료 건수를 확인하지 못했습니다. 다시 불러와 주세요.')
      return { items: (result.data ?? []) as unknown as T[], total: result.count, error: null }
    } catch (e) {
      return { items: [], total: null, error: e instanceof Error ? e.message : '자료를 불러오지 못했습니다.' }
    }
  }
  const [contacts, research, sales, projects] = await Promise.all([
    page<Contact>('contacts', 'id,client_id,name,title,phone,email,memo,is_primary,created_at', 'is_primary', pages.contacts),
    page<CompanyResearch>('research_items', 'id,client_id,title,kind,summary,status,updated_at', 'updated_at', pages.research),
    page<CompanySales>('sales_opportunities', 'id,client_id,title,stage,owner_id,next_action,next_date,updated_at', 'updated_at', pages.sales),
    page<CompanyProject>('projects', 'id,client_id,code,name,status,description,owner_id,start_date,end_date,updated_at', 'updated_at', pages.projects),
  ])
  return { company: company.data, contacts, research, sales, projects }
}
