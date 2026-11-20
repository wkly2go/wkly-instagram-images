// 광고 자동 운영 API (2026-11-20 · DB 20261120210000_ad_autopilot · 서버 함수 ad-autopilot)
//  - 설정 · 현황 · 기록 읽기는 DB(관리자 RLS · RPC), 지금 받기 · 승인 실행 · 계정 확인은 서버 함수
//  - 판단 규칙은 서버 함수 rules.ts 하나 (화면은 결과만 보여 줌)
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'

export type AutopilotMode = 'off' | 'suggest' | 'approve' | 'auto'
export interface AutopilotSettings {
  mode: AutopilotMode
  monthly_cap: number
  daily_cap: number
  max_step_pct: number
  kill_switch: boolean
  target_cpl: number | null
  min_spend: number
  meta_account_id: string | null
  /** 네이버 검색광고 고객 번호 (4단계) */
  naver_customer_id?: string | null
  updated_at?: string
}
export interface AutopilotInfo { platform_errors?: string | null; ads?: number; evaluated?: number; ad_error?: string | null; ran_at?: string; ok?: boolean; error?: string | null; saved_rows?: number; campaigns?: number; active?: number; proposals?: number; executed?: number; failed?: number; mtd_spend?: number }
export interface AutopilotStatus { settings: AutopilotSettings; token: boolean; naver_token?: boolean; info: AutopilotInfo | null; mtd_spend: number; waiting: number }
export interface AutopilotAction {
  id: string; created_at: string; day: string; campaign_id: string; campaign_name: string
  kind: 'pause' | 'scale_up' | 'scale_down'; from_budget: number | null; to_budget: number | null
  reason: string; metrics: { spend?: number; impressions?: number; clicks?: number; leads?: number; ctr?: number | null; cpc?: number | null; cpl?: number | null; prev_spend?: number; prev_leads?: number }
  status: '제안' | '실행' | '거절' | '실패' | '만료'; auto: boolean; decided_at: string | null; executed_at: string | null; result: string | null
  /** 소재 멈춤이면 그 소재 */
  ad_id?: string | null; ad_name?: string | null
  platform?: 'meta' | 'naver'
  /** 실행 7일 뒤 효과 */
  effect?: '좋아짐' | '나빠짐' | '비슷' | null; effect_note?: string | null
}
export interface MetaCampaignRow { id: string; name: string; status: string; effective_status: string | null; objective: string | null; daily_budget: number | null; lifetime_budget: number | null; synced_at: string }

export interface AdAutopilotApi {
  autopilotStatus(): Promise<AutopilotStatus | null>
  saveAutopilot(s: AutopilotSettings): Promise<void>
  autopilotKill(on: boolean): Promise<void>
  setMetaAdsToken(value: string): Promise<void>
  autopilotActions(): Promise<AutopilotAction[]>
  metaCampaigns(): Promise<MetaCampaignRow[]>
  autopilotCheck(): Promise<{ name: string; currency: string; status: number | null; timezone: string }>
  setNaverAdsKeys(key: string, secret: string): Promise<void>
  autopilotCheckNaver(): Promise<{ campaigns: number; active: number }>
  autopilotRun(): Promise<{ skipped?: string; proposals?: number; saved_rows?: number; campaigns?: number }>
  autopilotDecide(id: string, approve: boolean): Promise<{ ok: boolean; status: string; result?: string }>
}

export const MODE_LABEL: Record<AutopilotMode, string> = { off: '끔', suggest: '제안만', approve: '승인 뒤 실행', auto: '자동 실행' }
export const MODE_HELP: Record<AutopilotMode, string> = {
  off: '매일 아침 받기 · 판단을 하지 않습니다.',
  suggest: '매일 아침 수치를 받아 판단하고 제안만 남깁니다. 메타는 바꾸지 않습니다.',
  approve: '제안을 대표가 승인하면 그 자리에서 메타에 반영합니다.',
  auto: '규칙과 한도 안에서 바로 반영하고 결과를 알립니다. 증액은 월 · 하루 한도 안에서만.',
}
export const KIND_LABEL: Record<AutopilotAction['kind'], string> = { pause: '멈춤', scale_up: '예산 늘림', scale_down: '예산 줄임' }

export function createSupabaseAdAutopilotApi(sb: SupabaseClient): AdAutopilotApi {
  const call = async <T>(action: string, body: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await sb.functions.invoke('ad-autopilot', { body: { action, ...body } })
    if (error) {
      let msg = error.message
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* 그대로 */ }
      if (/Failed to send|FunctionsFetchError|not found/i.test(msg)) msg = '광고 자동 운영 서버를 준비 중입니다. 잠시 뒤 다시 해 주세요.'
      throw new ApiError(msg)
    }
    if (data?.error) throw new ApiError(data.error)
    return data as T
  }
  const rpc = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const r = await sb.rpc(fn, args)
    if (r.error) throw new ApiError(r.error.message)
    return r.data as T
  }
  return {
    async autopilotStatus() { return await rpc<AutopilotStatus | null>('ad_autopilot_status') },
    async saveAutopilot(s) { await rpc('ad_autopilot_save', { p: s }) },
    async autopilotKill(on) { await rpc('ad_autopilot_kill', { p_on: on }) },
    async setMetaAdsToken(value) { await rpc('ad_meta_token_set', { p_value: value }) },
    async autopilotActions() {
      const r = await sb.from('ad_autopilot_actions').select('id,created_at,day,campaign_id,campaign_name,kind,from_budget,to_budget,reason,metrics,status,auto,decided_at,executed_at,result,ad_id,ad_name,effect,effect_note,platform').order('created_at', { ascending: false }).limit(60)
      if (r.error) throw new ApiError(r.error.message)
      return (r.data ?? []) as AutopilotAction[]
    },
    async metaCampaigns() {
      const r = await sb.from('ad_meta_campaigns').select('*').order('status').order('name')
      if (r.error) throw new ApiError(r.error.message)
      return (r.data ?? []) as MetaCampaignRow[]
    },
    async autopilotCheck() { return await call('check') },
    async setNaverAdsKeys(key, secret) { await rpc('ad_naver_keys_set', { p_key: key, p_secret: secret }) },
    async autopilotCheckNaver() { return await call('check_naver') },
    async autopilotRun() { return await call('run') },
    async autopilotDecide(id, approve) { return await call('decide', { id, approve }) },
  }
}

/** 체험 모드: 연결 전 화면만 (지어낸 광고 수치는 두지 않음). 화면 확인용 시험 자료는 VITE_AUTOPILOT_HARNESS=1 개발 서버에서만 */
export function createDemoAdAutopilotApi(): AdAutopilotApi {
  const harness = import.meta.env.DEV && import.meta.env.VITE_AUTOPILOT_HARNESS === '1'
  let s: AutopilotSettings = { mode: 'suggest', monthly_cap: harness ? 1_500_000 : 0, daily_cap: harness ? 60_000 : 0, max_step_pct: 20, kill_switch: false, target_cpl: harness ? 25000 : null, min_spend: 30000, meta_account_id: harness ? '1234567890' : null }
  const sample: AutopilotAction[] = harness ? [
    { id: 'h1', created_at: new Date().toISOString(), day: '2026-11-20', campaign_id: '1', campaign_name: '[시험] 성수 대관 리드', kind: 'pause', from_budget: 20000, to_budget: null, reason: '7일 동안 63,000원 (목표 문의당 비용의 2배 이상)를 썼는데 문의가 없습니다.', metrics: { spend: 63000, impressions: 9100, clicks: 88, leads: 0, ctr: 0.97, cpc: 716, cpl: null }, status: '제안', auto: false, decided_at: null, executed_at: null, result: null },
    { id: 'h2', created_at: new Date().toISOString(), day: '2026-11-20', campaign_id: '2', platform: 'naver', campaign_name: '[시험] 파워링크 · 팝업 대행', kind: 'scale_up', from_budget: 20000, to_budget: 24000, reason: '문의 6건 · 문의당 비용 14,500원이 목표 25,000원보다 20% 이상 낮습니다. 하루 예산을 20% 늘립니다 (하루 합계 44,000원 · 한도 60,000원).', metrics: { spend: 87000, impressions: 15200, clicks: 240, leads: 6, ctr: 1.58, cpc: 362, cpl: 14500 }, status: '제안', auto: false, decided_at: null, executed_at: null, result: null },
    { id: 'h4', created_at: new Date().toISOString(), day: '2026-11-20', campaign_id: '4', campaign_name: '[시험] 매거진 구독', kind: 'pause', from_budget: null, to_budget: null, ad_id: 'ad9', ad_name: '카드뉴스 A안', reason: '소재 피로: 클릭률이 앞 주보다 46% 떨어졌습니다 (한 사람에게 7일 평균 3.8번 노출). 같은 캠페인의 다른 소재 2개는 그대로 돕니다. 새 소재는 \'한 번에 만들기\'로 채워 주세요.', metrics: { spend: 41000, impressions: 8800, clicks: 61, leads: 1, ctr: 0.69, cpc: 672, cpl: 41000 }, status: '제안', auto: false, decided_at: null, executed_at: null, result: null },
    { id: 'h3', created_at: new Date(Date.now() - 86400000).toISOString(), day: '2026-11-19', campaign_id: '3', campaign_name: '[시험] 아트리어 포트폴리오', kind: 'scale_down', from_budget: 15000, to_budget: 12000, reason: '문의당 비용 34,000원이 목표 25,000원보다 30% 이상 높아 하루 예산을 20% 줄입니다.', metrics: { spend: 68000, impressions: 12000, clicks: 130, leads: 2, ctr: 1.08, cpc: 523, cpl: 34000 }, status: '실행', auto: true, decided_at: null, executed_at: new Date(Date.now() - 86000000).toISOString(), result: '메타에서 하루 예산을 15,000원 → 12,000원으로 바꿨습니다.', effect: '좋아짐', effect_note: '문의당 비용 34,000원 → 22,600원 (-34%) · 문의 2 → 3건.' },
  ] : []
  return {
    async autopilotStatus() { return { settings: s, token: harness, info: harness ? { ran_at: new Date().toISOString(), ok: true, saved_rows: 42, campaigns: 5, active: 3, proposals: 2, executed: 0 } : null, mtd_spend: harness ? 812_000 : 0, waiting: sample.filter(a => a.status === '제안').length } },
    async saveAutopilot(n) { s = { ...n } },
    async autopilotKill(on) { s = { ...s, kill_switch: on } },
    async setMetaAdsToken() { throw new ApiError('체험 모드에서는 열쇠를 넣을 수 없습니다.') },
    async autopilotActions() { return sample },
    async metaCampaigns() { return [] },
    async autopilotCheck() { throw new ApiError('체험 모드에서는 계정을 확인할 수 없습니다.') },
    async setNaverAdsKeys() { throw new ApiError('체험 모드에서는 열쇠를 넣을 수 없습니다.') },
    async autopilotCheckNaver() { throw new ApiError('체험 모드에서는 계정을 확인할 수 없습니다.') },
    async autopilotRun() { throw new ApiError('체험 모드에서는 수치를 받을 수 없습니다.') },
    async autopilotDecide(id, approve) { const a = sample.find(x => x.id === id); if (a) a.status = approve ? '실행' : '거절'; return { ok: true, status: approve ? '실행' : '거절' } },
  }
}
