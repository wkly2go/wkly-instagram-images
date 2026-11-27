import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { flowSteps, taggedRate, type MarketingFlow } from '../src/lib/marketingFlow.ts'

const base: MarketingFlow = {
  at: '2026-11-27T07:00:00Z',
  analyze: { competitor_posts_7d: 2, competitors: 7, research_7d: { '트렌드·밈': 14 }, latest_trend: null },
  create: { campaigns_14d: 1, campaign_status: { draft: 2 }, ai_drafts: 0, video: { 완료: 2 } },
  publish: { content_status: { '작성 중': 2 }, content_14d: 2 },
  ads: { settings: { mode: 'suggest', monthly_cap: 0, daily_cap: 0, kill_switch: false }, proposals: 0, meta_drafts: {} },
  inquiries: { total_30d: 79, new: 13, from_ads_30d: 18, tagged_30d: 30, direct_30d: 12 },
  deals: { linked_90d: 1, by_status: { 문의: 1 } },
  by_campaign: [],
}

test('여섯 단계가 순서대로 나오고 할 일이 있는 단계만 표시된다', () => {
  const steps = flowSteps(base)
  assert.deepEqual(steps.map(s => s.key), ['analyze', 'create', 'publish', 'ads', 'inquiries', 'deals'])
  assert.equal(steps[0].todo, null)
  assert.match(steps[1].todo!, /캠페인 2건/)
  assert.match(steps[3].todo!, /한도/)
  assert.match(steps[4].todo!, /새 문의 13건/)
  assert.equal(steps[5].tone, 'idle')
})

test('한도가 있고 제안이 없으면 광고 단계는 할 일이 없다 · 관리자가 아니면 설정이 안 보여도 멈추지 않는다', () => {
  const ok = flowSteps({ ...base, ads: { ...base.ads, settings: { mode: 'approve', monthly_cap: 600000, daily_cap: 20000, kill_switch: false } } })
  assert.equal(ok[3].todo, null)
  assert.equal(flowSteps({ ...base, ads: { ...base.ads, settings: null } })[3].tone, 'idle')
})

test('꼬리표 비율', () => {
  assert.equal(taggedRate(base), 38)
  assert.equal(taggedRate({ ...base, inquiries: { ...base.inquiries, total_30d: 0 } }), null)
})

test('DB 함수는 읽기만 · 호출한 사람 권한 · 로그인 없는 사람에게 닫힘 · 시험 문의 제외', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261127170000_marketing_flow.sql', import.meta.url), 'utf8')
  assert.match(sql, /stable security invoker/)
  assert.match(sql, /revoke all on function public\.marketing_flow\(\) from public, anon/)
  assert.doesNotMatch(sql, /\b(insert|update|delete)\b/i)
  assert.match(sql, /not coalesce\(w?\.?is_test, false\)/)
})
