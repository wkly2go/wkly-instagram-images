// 인트라넷 API 에이전트 (2026-11-22 · Claude 예약 작업 대신 인트라넷 서버가 Claude 콘솔 API 로 돌림)
// 표 api_agents · api_agent_runs (관리자만 읽기) · 서버 함수 api-agents (지금 실행)
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'

export interface ApiAgent {
  id: string; code: string; name: string; group_name: string; model: string; effort: string
  instructions: string; rpcs: string[]; web_search: boolean; web_max: number; times: string[]; weekdays: number[] | null
  enabled: boolean; last_run_at: string | null; last_status: string | null; last_summary: string | null
}
export interface ApiAgentRun {
  id: string; agent_id: string; slot: string | null; started_at: string; finished_at: string | null; status: string
  model: string | null; input_tokens: number; output_tokens: number; web_searches: number; tool_calls: number; usd: number
  result: string | null; error: string | null
}
export interface ApiAgentBudget { month_usd: number; cap_usd: number }

export interface ApiAgentsApi {
  apiAgents(): Promise<ApiAgent[]>
  apiAgentRuns(limit?: number): Promise<ApiAgentRun[]>
  apiAgentBudget(): Promise<ApiAgentBudget>
  apiAgentUpdate(id: string, patch: Partial<Pick<ApiAgent, 'enabled' | 'model' | 'times' | 'instructions' | 'web_search'>>): Promise<void>
  apiAgentRunNow(code: string): Promise<void>
}

export const MODEL_LABEL: Record<string, string> = { 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5', 'claude-opus-5-5': 'Opus 5.5' }
const DOW = ['', '월', '화', '수', '목', '금', '토', '일']
export const scheduleLabel = (a: Pick<ApiAgent, 'times' | 'weekdays'>) =>
  `${a.weekdays?.length ? (a.weekdays.join() === '1,2,3,4,5' ? '평일' : a.weekdays.map(d => DOW[d]).join('·')) : '매일'} ${a.times.join(' · ') || '시각 없음'}`

export function createSupabaseApiAgentsApi(sb: SupabaseClient): ApiAgentsApi {
  const ok = <T>(r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error) throw new ApiError(r.error.message)
    return r.data as T
  }
  return {
    async apiAgents() { return ok(await sb.from('api_agents').select('*').order('group_name').order('code')) as ApiAgent[] },
    async apiAgentRuns(limit = 40) { return ok(await sb.from('api_agent_runs').select('*').order('started_at', { ascending: false }).limit(limit)) as ApiAgentRun[] },
    async apiAgentBudget() { return ok(await sb.rpc('api_agent_budget')) as ApiAgentBudget },
    async apiAgentUpdate(id, patch) { ok(await sb.rpc('api_agent_update', { p_id: id, p: patch })) },
    async apiAgentRunNow(code) {
      const { data, error } = await sb.functions.invoke('api-agents', { body: { action: 'run', code } })
      if (error) {
        let msg = error.message
        try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* 그대로 */ }
        throw new ApiError(msg)
      }
      if (data?.error) throw new ApiError(data.error)
    },
  }
}

// 체험 모드: 자료 없음 · 화면 확인은 VITE_API_AGENT_HARNESS=1 (지어낸 [시험] 줄)
export function createDemoApiAgentsApi(): ApiAgentsApi {
  const harness = import.meta.env.DEV && import.meta.env.VITE_API_AGENT_HARNESS === '1'
  const agents: ApiAgent[] = harness ? [
    { id: 'a1', code: 'TREND', name: '[시험] 트렌드 리서치 AI', group_name: '리서치', model: 'claude-sonnet-5-5', effort: 'medium', instructions: '[시험] 지시문', rpcs: ['agent_submit', 'agent_fleet_report'], web_search: true, web_max: 10, times: ['01:03'], weekdays: null, enabled: true, last_run_at: new Date().toISOString(), last_status: '완료', last_summary: '저장 5건' },
    { id: 'a2', code: 'SYS', name: '[시험] 시스템 점검 AI', group_name: '시스템', model: 'claude-haiku-5-5', effort: 'low', instructions: '[시험] 지시문', rpcs: ['agent_system_health', 'agent_fleet_report'], web_search: false, web_max: 0, times: ['05:09'], weekdays: [1, 2, 3, 4, 5], enabled: true, last_run_at: null, last_status: null, last_summary: null },
  ] : []
  const runs: ApiAgentRun[] = harness ? [{ id: 'r1', agent_id: 'a1', slot: '2026-11-22 01:03', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), status: '완료', model: 'claude-sonnet-5-5', input_tokens: 84000, output_tokens: 6200, web_searches: 9, tool_calls: 6, usd: 0.32, result: '저장 5건', error: null }] : []
  return {
    async apiAgents() { return agents },
    async apiAgentRuns() { return runs },
    async apiAgentBudget() { return { month_usd: runs.reduce((s, r) => s + r.usd, 0), cap_usd: 30 } },
    async apiAgentUpdate(id, patch) { const a = agents.find(x => x.id === id); if (a) Object.assign(a, patch) },
    async apiAgentRunNow() { throw new ApiError('체험 모드에서는 실행하지 않습니다.') },
  }
}
