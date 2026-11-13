import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from './types'
import { ApiError } from './api'
import { saveSalesWithRecovery } from './salesSaveRecovery'
import { checkSalesActivity, isSalesActivityUnconfirmed, normalizeSalesActivityBody, saveSalesActivityWithRecovery } from './salesActivityRecovery'
import { SALES_PAGE_SIZE, SALES_SOURCES, canEditSales, needsFollowup, salesSummary, validateSales, type SalesActivity, type SalesApi, type SalesOpportunity, type SalesOrigin } from './sales'

function fail(error: { message: string; code?: string } | null) {
  if (!error) return
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) throw new ApiError('영업 공용 저장소가 아직 준비되지 않았습니다. 관리자에게 신규 DB 적용 상태를 확인해 주세요.')
  throw new ApiError(error.message)
}
function validateWorkFilter(work: unknown) {
  if (work !== undefined && work !== '' && work !== 'unscheduled' && work !== 'handoff') throw new ApiError('업무 목록 조건을 다시 선택해 주세요.')
}
function validateSourceFilter(source: unknown) {
  if (source !== undefined && source !== '' && !(SALES_SOURCES as readonly unknown[]).includes(source)) throw new ApiError('유입 경로 검색 조건을 다시 선택해 주세요.')
}
const SUMMARY = 'id,title,division,client_id,contact_id,owner_id,stage,source,expected_amount,next_action,next_date,project_id,revision,created_by,updated_by,created_at,updated_at'

export function createSupabaseSalesApi(sb: SupabaseClient): SalesApi {
  const activityStore = {
    read: async (id: string): Promise<SalesActivity | null> => {
      const result = await sb.from('sales_activities').select('*').eq('id', id).maybeSingle().retry(false)
      fail(result.error)
      return result.data as SalesActivity | null
    },
    confirmActor: async () => {
      const auth = await sb.auth.getUser()
      return auth.error ? null : auth.data.user?.id ?? null
    },
  }
  return {
    async listSales(f) {
      validateSourceFilter(f.source)
      validateWorkFilter(f.work)
      let q = sb.from('sales_opportunities').select(SUMMARY).order('updated_at', { ascending: false }).order('id')
      if (f.ownerId) q = q.eq('owner_id', f.ownerId)
      if (f.work === 'unscheduled') q = q.is('next_date', null).not('stage', 'in', '(수주,실주,보류)')
      if (f.work === 'handoff') q = q.eq('stage', '수주').is('project_id', null)
      if (f.source) q = q.eq('source', f.source)
      if (f.stage) q = q.eq('stage', f.stage)
      if (f.division) q = q.eq('division', f.division)
      if (f.search?.trim()) q = q.ilike('title', `%${f.search.trim().replace(/[\\%_]/g, '\\$&')}%`)
      if (f.dueBefore) q = q.lte('next_date', f.dueBefore).not('stage', 'in', '(수주,실주,보류)')
      const start = Math.max(0, Math.trunc(f.page)) * SALES_PAGE_SIZE
      const r = await q.range(start, start + SALES_PAGE_SIZE)
      fail(r.error)
      return { items: (r.data ?? []).slice(0, SALES_PAGE_SIZE), hasMore: (r.data?.length ?? 0) > SALES_PAGE_SIZE }
    },
    async listSalesOrigins(id) {
      const r = await sb.from('growth_items').select('id,kind,title,status,document,updated_at').eq('linked_sales_id', id).in('kind', ['contact', 'tender']).order('updated_at', { ascending: false }).order('id').limit(20)
      fail(r.error)
      return (r.data ?? []) as SalesOrigin[]
    },
    async getSales(id) {
      const r = await sb.from('sales_opportunities').select('*').eq('id', id).single()
      fail(r.error)
      return r.data as SalesOpportunity
    },
    async saveSales(id, draft, expectedRevision) {
      const submitted = structuredClone(draft)
      const error = validateSales(submitted)
      if (error) throw new ApiError(error)
      const session = await sb.auth.getSession()
      const actor = session.data.session?.user.id
      if (session.error || !actor) throw new ApiError('로그인이 필요합니다.')
      try {
        return await saveSalesWithRecovery({
          write: async document => await sb.rpc('sales_save_opportunity', { p_id: id, p_document: document, p_expected_revision: expectedRevision }).retry(false),
          read: async sameId => {
            const result = await sb.from('sales_opportunities').select('*').eq('id', sameId).single().retry(false)
            fail(result.error)
            return result.data as SalesOpportunity | null
          },
          confirmActor: async () => {
            const auth = await sb.auth.getUser()
            return auth.error ? null : auth.data.user?.id ?? null
          },
        }, id, submitted, expectedRevision, actor)
      } catch (e) {
        if (e && typeof e === 'object' && 'message' in e) fail(e as { message: string; code?: string })
        throw e
      }
    },
    async listSalesActivities(id) {
      const r = await sb.from('sales_activities').select('*').eq('opportunity_id', id).order('created_at', { ascending: false }).order('id').limit(50)
      fail(r.error)
      return (r.data ?? []) as SalesActivity[]
    },
    async addSalesActivity(id, opportunityId, kind, body, actorId) {
      const session = await sb.auth.getSession(), actor = session.data.session?.user.id
      if (session.error || !actor) throw new ApiError('로그인이 필요합니다.')
      if (actorId && actor !== actorId) throw new ApiError('활동을 입력한 계정으로 다시 로그인해 주세요.')
      try {
        await saveSalesActivityWithRecovery({
          ...activityStore,
          write: async request => await sb.rpc('sales_add_activity', { p_id: request.id, p_opportunity_id: request.opportunityId, p_kind: request.kind, p_body: request.body }).retry(false),
        }, { id, opportunityId, kind, body, actorId: actor })
      } catch (e) {
        if (isSalesActivityUnconfirmed(e)) throw e
        if (e && typeof e === 'object' && 'message' in e) fail(e as { message: string; code?: string })
        throw e
      }
    },
    async checkSalesActivity(id, opportunityId, kind, body, actorId) {
      return checkSalesActivity(activityStore, { id, opportunityId, kind, body, actorId })
    },
  }
}

export function createDemoSalesApi(viewer: () => Profile | undefined): SalesApi {
  const KEY = 'wkly-sales-demo-v1'
  const read = (): { items: SalesOpportunity[]; activities: SalesActivity[] } => JSON.parse(localStorage.getItem(KEY) ?? '{"items":[],"activities":[]}')
  const user = () => {
    const p = viewer()
    if (!p?.active) throw new ApiError('로그인이 필요합니다.')
    return p
  }
  return {
    async listSales(f) {
      user()
      validateSourceFilter(f.source)
      validateWorkFilter(f.work)
      const rows = read().items.filter(r => (!f.ownerId || r.owner_id === f.ownerId) && (!f.work || (f.work === 'unscheduled' ? !r.next_date && !['수주','실주','보류'].includes(r.stage) : r.stage === '수주' && !r.project_id)) && (!f.source || r.source === f.source) && (!f.stage || r.stage === f.stage) && (!f.division || r.division === f.division) && (!f.search || r.title.toLowerCase().includes(f.search.trim().toLowerCase())) && (!f.dueBefore || needsFollowup(r, f.dueBefore))).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
      const offset = Math.max(0, Math.trunc(f.page)) * SALES_PAGE_SIZE
      return { items: rows.slice(offset, offset + SALES_PAGE_SIZE).map(salesSummary), hasMore: rows.length > offset + SALES_PAGE_SIZE }
    },
    async listSalesOrigins(id) {
      user()
      const items = JSON.parse(localStorage.getItem('wkly-growth-demo-v1') ?? '[]') as (SalesOrigin & { linked_sales_id: string | null })[]
      return items.filter(r => r.linked_sales_id === id && ['contact', 'tender'].includes(r.kind)).sort((a,b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)).slice(0,20).map(({id,kind,title,status,document,updated_at})=>({id,kind,title,status,document,updated_at}))
    },
    async getSales(id) {
      user()
      const r = read().items.find(x => x.id === id)
      if (!r) throw new ApiError('영업 건을 찾을 수 없습니다.')
      return r
    },
    async saveSales(id, draft, revision) {
      const me = user(), state = read(), prev = state.items.find(x => x.id === id)
      const error = validateSales(draft)
      if (error) throw new ApiError(error)
      if ((prev && !canEditSales(prev, me)) || (me.role !== 'admin' && draft.owner_id !== me.id)) throw new ApiError('담당자 또는 관리자만 수정할 수 있습니다.')
      if ((prev?.revision ?? 0) !== revision) throw new ApiError('다른 작업에서 변경되었습니다. 새로 불러와 주세요.')
      const now = new Date().toISOString()
      const saved: SalesOpportunity = { ...draft, title: draft.title.trim(), id, revision: revision + 1, created_by: prev?.created_by ?? me.id, updated_by: me.id, created_at: prev?.created_at ?? now, updated_at: now }
      state.items = [...state.items.filter(x => x.id !== id), saved]
      state.activities.push({ id: crypto.randomUUID(), opportunity_id: id, kind: prev ? '상태 변경' : '등록', body: prev ? `저장 ${revision + 1} · ${prev.stage} → ${saved.stage}` : `영업 건 등록 · ${saved.stage}`, created_by: me.id, created_at: now })
      localStorage.setItem(KEY, JSON.stringify(state))
      return saved
    },
    async listSalesActivities(id) {
      user()
      return read().activities.filter(x => x.opportunity_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50)
    },
    async addSalesActivity(id, opportunityId, kind, body, actorId) {
      const me = user(), state = read(), row = state.items.find(x => x.id === opportunityId)
      if (actorId && actorId !== me.id) throw new ApiError('활동을 입력한 계정으로 다시 로그인해 주세요.')
      if (!row || !canEditSales(row, me)) throw new ApiError('담당자 또는 관리자만 기록할 수 있습니다.')
      const normalized = normalizeSalesActivityBody(body)
      if (!['메모', '전화', '메일', '미팅'].includes(kind) || !normalized || [...normalized].length > 4000) throw new ApiError('활동 내용을 4,000자 이내로 적어 주세요.')
      const existing = state.activities.find(x => x.id === id)
      if (existing) {
        if (existing.opportunity_id !== opportunityId || existing.body !== normalized || existing.kind !== kind || existing.created_by !== me.id) throw new ApiError('같은 요청에 다른 내용이 있습니다.')
        return
      }
      state.activities.push({ id, opportunity_id: opportunityId, kind, body: normalized, created_by: me.id, created_at: new Date().toISOString() })
      localStorage.setItem(KEY, JSON.stringify(state))
    },
    async checkSalesActivity(id, opportunityId, kind, body, actorId) {
      return checkSalesActivity({
        confirmActor: async () => user().id,
        read: async sameId => read().activities.find(a => a.id === sameId) ?? null,
      }, { id, opportunityId, kind, body, actorId })
    },
  }
}
