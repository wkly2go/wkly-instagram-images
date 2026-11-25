import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 광고 자동화 AI (API 에이전트 코드 AD · 2026-11-23): 읽고 판단 · 초안만. 메타 · 예산 · 발송은 못 건드린다
const sql = readFileSync(new URL('../supabase/migrations/20261123100000_ad_agent.sql', import.meta.url), 'utf8')
const fn = (name: string) => sql.slice(sql.indexOf(`function public.${name}`), sql.indexOf('end $$;', sql.indexOf(`function public.${name}`)))

test('지우는 것 없음 · 새 RPC 는 서버만 부름', () => {
  assert.doesNotMatch(sql, /\bdrop\s/i)
  for (const f of ['agent_ad_ops_context(text)', 'agent_ad_ops_save(text, jsonb)']) {
    assert.ok(sql.includes(`revoke all on function public.${f} from public, anon, authenticated;`), f)
    assert.ok(sql.includes(`grant execute on function public.${f} to service_role;`), f)
  }
  assert.doesNotMatch(sql, /grant execute[^;]*to[^;]*\banon\b/i)
})

test('에이전트는 읽기 · 일지 저장 RPC 두 개만 · 매일 07:23 · 웹 검색 없음', () => {
  assert.match(sql, /array\['agent_ad_ops_context', 'agent_ad_ops_save'\], false, 0, array\['07:23'\], null, true\)/)
  assert.match(sql, /on conflict \(code\) do nothing/)
  assert.match(sql, /You cannot change Meta or Naver/)
})

test('읽기: 토큰 확인 · 열쇠 · 계정 번호는 주지 않음', () => {
  const ctx = fn('agent_ad_ops_context')
  assert.match(ctx, /perform public\.agent_token_check\(p_token, 'task'\)/)
  assert.doesNotMatch(ctx, /'meta_account_id'|'naver_customer_id'|vault|decrypted|token_get|keys_get/)
  assert.match(ctx, /'meta_connected', s\.meta_account_id is not null/)
  assert.doesNotMatch(ctx, /\b(email|phone)\b/)
})

test('쓰기: 메타 · 설정 · 제안 표는 안 건드리고, 초안은 예산 없이 초안 상태로 하루 한 건', () => {
  const save = fn('agent_ad_ops_save')
  assert.match(save, /agent_token_check\(p_token, 'task'\)/)
  assert.doesNotMatch(save, /ad_autopilot_settings|ad_autopilot_actions|ad_meta_|net\.http|approvals/)
  assert.match(save, /'dailyBudget', null, 'totalBudget', null/)
  assert.match(save, /'status', 'draft'\)/)
  assert.match(save, /'reviews', jsonb_build_object\('content', false, 'rights', false, 'budget', false\)/)
  assert.match(save, /v_today_drafts > 0/)
  assert.match(save, /v_open >= 3/)
  assert.match(save, /thewklyn\\\.com/)
  // 주민번호 형식 거절 · 알림 제목에 금액 없음(고정 문구)
  assert.match(save, /주민등록번호 형식/)
  assert.match(save, /'\[광고 자동화\] 새 캠페인 초안이 준비됐습니다'/)
  assert.match(save, /'\[광고 자동화\] 오늘 확인할 것이 있습니다'/)
})

test('화면: 자동 운영 탭에 AI 일지 · 지금 맡기기', () => {
  const ui = readFileSync(new URL('../src/components/AdAutopilot.tsx', import.meta.url), 'utf8')
  const api = readFileSync(new URL('../src/lib/adAutopilotApi.ts', import.meta.url), 'utf8')
  assert.match(ui, /api\.adAgentLogs\(\)/)
  assert.match(ui, /api\.apiAgentRunNow\(AD_AGENT_CODE\)/)
  assert.match(api, /export const AD_AGENT_JOB = 'AD 광고 자동화'/)
  assert.ok(sql.includes("'AD 광고 자동화'"))
})
