import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { GovApi, GovCompany, GovProgram } from './gov'

const fail = (e: { message: string; code?: string } | null) => {
  if (!e) return
  if (['PGRST202', 'PGRST205', '42P01'].includes(e.code ?? '')) throw new ApiError('정부지원사업 서버를 준비 중입니다. 잠시 뒤 다시 열어 주세요.')
  if (e.code === '42501') throw new ApiError('정부지원사업은 관리자만 볼 수 있습니다.')
  throw new ApiError(e.message)
}

const COLS = 'id,source,title,org,supervising,category,region,target,target_detail,biz_years,summary,support_content,exclude_detail,apply_start,apply_end,detail_url,apply_url,contact,fit,fit_score,fit_company,fits,status,owner_id,decision_note,first_seen_at'

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
    updateGovProgram: none,
    saveGovCompany: none,
    refreshGovPrograms: none,
  }
}
