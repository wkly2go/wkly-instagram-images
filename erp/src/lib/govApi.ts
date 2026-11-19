import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { GovApi, GovCompany, GovDoc, GovDocVersion, GovOverview, GovPlanDraft, GovProgram, GovSuggestion } from './gov'

const fail = (e: { message: string; code?: string } | null) => {
  if (!e) return
  if (['PGRST202', 'PGRST205', '42P01'].includes(e.code ?? '')) throw new ApiError('정부지원사업 서버를 준비 중입니다. 잠시 뒤 다시 열어 주세요.')
  if (e.code === '42501') throw new ApiError('정부지원사업은 관리자만 볼 수 있습니다.')
  throw new ApiError(e.message)
}

const COLS = 'id,source,title,org,supervising,category,region,target,target_detail,biz_years,summary,support_content,exclude_detail,apply_start,apply_end,detail_url,apply_url,contact,fit,fit_score,fit_company,fits,track,status,owner_id,decision_note,first_seen_at'

export function createSupabaseGovApi(sb: SupabaseClient): GovApi {
  return {
    async listGovPrograms() {
      const r = await sb.from('gov_programs').select(COLS).order('apply_end', { ascending: true, nullsFirst: false }).limit(1000)
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return (r.data ?? []) as unknown as GovProgram[]
    },
    async listGovCompanies() {
      const r = await sb.from('gov_companies').select('key,name,short,founded,region,industries,certifications,cert_notes,include_keywords,exclude_keywords,sort').order('sort')
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return (r.data ?? []) as GovCompany[]
    },
    async listGovDocs() {
      const r = await sb.from('gov_docs').select('key,title,body,sort,updated_at').order('sort')
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return (r.data ?? []) as GovDoc[]
    },
    async saveGovDoc(key, body) {
      const me = (await sb.auth.getUser()).data.user?.id ?? null
      fail((await sb.from('gov_docs').update({ body, updated_by: me, updated_at: new Date().toISOString() }).eq('key', key)).error)
    },
    async govOverview() {
      const r = await sb.rpc('gov_overview')
      if (r.error && ['PGRST202', '42883'].includes(r.error.code ?? '')) return null
      fail(r.error)
      return (r.data ?? null) as GovOverview | null
    },
    async listGovSuggestions() {
      const r = await sb.from('gov_doc_suggestions').select('id,doc_key,title,before_text,after_text,reason,sources,status,created_at,decided_at').order('created_at', { ascending: false }).limit(60)
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return (r.data ?? []) as GovSuggestion[]
    },
    async decideGovSuggestion(id, accept) {
      const r = await sb.rpc('gov_suggestion_decide', { p_id: id, p_accept: accept })
      fail(r.error)
      return String(r.data ?? '')
    },
    async listGovDocVersions(key) {
      const r = await sb.from('gov_doc_versions').select('id,doc_key,note,saved_at,body').eq('doc_key', key).order('saved_at', { ascending: false }).limit(30)
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return ((r.data ?? []) as (Omit<GovDocVersion, 'chars'> & { body: string })[]).map(({ body, ...v }) => ({ ...v, chars: body.length }))
    },
    async restoreGovDoc(versionId) {
      fail((await sb.rpc('gov_doc_restore', { p_version: versionId })).error)
    },
    async askGovAgent(text) {
      fail((await sb.rpc('gov_agent_request', { p_text: text })).error)
    },
    async getGovPlanDraft(programId) {
      const r = await sb.from('gov_plan_drafts').select('id,program_id,company,title,inputs,sections,updated_at').eq('program_id', programId).order('updated_at', { ascending: false }).limit(1)
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return null
      fail(r.error)
      return ((r.data ?? [])[0] as GovPlanDraft | undefined) ?? null
    },
    async saveGovPlanDraft(draft) {
      const row = { program_id: draft.program_id, company: draft.company, title: draft.title, inputs: draft.inputs, sections: draft.sections, updated_at: new Date().toISOString() }
      const r = draft.id ? await sb.from('gov_plan_drafts').update(row).eq('id', draft.id).select('id').single() : await sb.from('gov_plan_drafts').insert(row).select('id').single()
      fail(r.error)
      return String(r.data?.id)
    },
    async updateGovProgram(id, patch) {
      fail((await sb.from('gov_programs').update(patch).eq('id', id)).error)
    },
    async saveGovCompany(key, patch) {
      fail((await sb.from('gov_companies').update({ ...patch, updated_at: new Date().toISOString() }).eq('key', key)).error)
      const r = await sb.rpc('gov_rescore_now')
      fail(r.error)
      return Number(r.data ?? 0)
    },
    async refreshGovPrograms() {
      const r = await sb.rpc('gov_refresh')
      fail(r.error)
      return Number((r.data as { upserted?: number } | null)?.upserted ?? 0)
    },
  }
}

/** 체험 모드에는 자료를 두지 않는다 — 개발 서버에서만 화면 확인용 지어낸 공고를 보여 준다 (배포 묶음에 안 들어감) */
export function createDemoGovApi(): GovApi {
  const none = async () => { throw new ApiError('체험 모드에서는 정부지원사업을 고칠 수 없습니다.') }
  const dev = import.meta.env?.DEV
  return {
    async listGovPrograms() { return dev ? (await import('../dev/govSample')).SAMPLE_PROGRAMS : [] },
    async listGovCompanies() { return dev ? (await import('../dev/govSample')).SAMPLE_COMPANIES : [] },
    async listGovDocs() { return dev ? (await import('../dev/govSample')).SAMPLE_DOCS : [] },
    saveGovDoc: none,
    async govOverview() { return dev ? (await import('../dev/govSample')).SAMPLE_OVERVIEW : null },
    async listGovSuggestions() { return dev ? (await import('../dev/govSample')).SAMPLE_SUGGESTIONS : [] },
    decideGovSuggestion: none,
    async listGovDocVersions() { return [] },
    restoreGovDoc: none,
    askGovAgent: none,
    async getGovPlanDraft() { return null },
    saveGovPlanDraft: none,
    updateGovProgram: none,
    saveGovCompany: none,
    refreshGovPrograms: none,
  }
}
