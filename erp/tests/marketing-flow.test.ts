import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calendarDays, shiftWeek, weekLabel, deltaPct, flowKpis, flowSteps, shareWidths, taggedRate, trendScale, weekDays, type FlowTrend, type MarketingFlow } from '../src/lib/marketingFlow.ts'

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

const trend: FlowTrend = {
  daily: [{ d: '2026-11-26', total: 3, direct: 1, ads: 1 }, { d: '2026-11-27', total: 9, direct: 2, ads: 4 }],
  prev: { total: 61, direct: 9, ads: 0, tagged: 19 },
  by_source: [], by_kind: [], week_start: '2026-11-23',
  week: [{ id: 'a', type: 'content', title: '글', status: '작성 중', at: '2026-11-26T16:30:00Z', channels: ['블로그'] }],
}

test('숫자 띠: 앞 30일과 견준 변화 · 앞 기간이 0이면 견주지 않는다', () => {
  const k = flowKpis(base, trend)
  assert.deepEqual(k.map(x => x.key), ['total', 'direct', 'ads', 'tagged', 'new', 'deals'])
  assert.equal(k[0].delta, 30)
  assert.equal(k[2].delta, null)
  assert.equal(k[3].value, '38%')
  assert.equal(k[3].delta, 38 - 31)
  assert.equal(deltaPct(5, undefined), null)
  assert.equal(flowKpis(base, null)[0].delta, null)
})

test('그래프 눈금과 막대 폭', () => {
  assert.deepEqual(trendScale(trend.daily), { max: 10, ticks: [0, 2, 4, 6, 8, 10] })
  assert.equal(trendScale([]).max, 1)
  assert.deepEqual(shareWidths([10, 5, 0]), [100, 50, 2])
  assert.deepEqual(shareWidths([0, 0]), [0, 0])
})

test('이번 주 달력: 월~일 일곱 칸 · 한국 날짜로 그날 칸에 놓는다', () => {
  const days = weekDays(trend, Date.parse('2026-11-27T09:00:00Z'))
  assert.deepEqual(days.map(d => d.name), ['월', '화', '수', '목', '금', '토', '일'])
  assert.equal(days[0].date, '2026-11-23')
  assert.equal(days[4].today, true)
  assert.equal(days[4].items.length, 1) // 11-26 16:30 UTC = 한국 11-27 01:30
  assert.equal(days[3].items.length, 0)
})

test('추이 DB 함수도 읽기만 · 호출한 사람 권한 · 로그인 없는 사람에게 닫힘 · 시험 문의 제외', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261127190000_marketing_flow_trend.sql', import.meta.url), 'utf8')
  assert.match(sql, /stable security invoker/)
  assert.match(sql, /revoke all on function public\.marketing_flow_trend\(\) from public, anon/)
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop)\b/i)
  assert.match(sql, /not coalesce\(is_test, false\)/)
})

test('주간 달력: 예정일이 있으면 그날 칸 · 주 옮기기 · 지난 날 표시', () => {
  const cal = { week_start: '2026-11-23', unplanned: [], items: [
    { id: 'a', type: 'content' as const, title: '가', status: '작성 중', day: '2026-11-28', planned: true, channels: [] },
    { id: 'b', type: 'video' as const, title: '나', status: '완료', day: '2026-11-25', planned: false, channels: ['영상'] },
  ] }
  const days = calendarDays(cal, Date.parse('2026-11-27T09:00:00Z'))
  assert.equal(days[5].items[0].id, 'a')
  assert.equal(days[2].items[0].id, 'b')
  assert.equal(days[2].past, true)
  assert.equal(days[4].today, true)
  assert.equal(shiftWeek('2026-11-23', 1), '2026-11-30')
  assert.equal(shiftWeek('2026-11-30', -1), '2026-11-23')
  assert.equal(weekLabel('2026-11-30'), '11.30 ~ 12.6')
})

test('게시 예정일 표: 활성 팀원만 · 로그인 없는 사람에게 닫힘 · 달력 함수는 읽기만', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261127201500_growth_schedule.sql', import.meta.url), 'utf8')
  assert.match(sql, /enable row level security/)
  assert.equal((sql.match(/is_active_member\(\)/g) ?? []).length, 5)
  assert.match(sql, /revoke all on public\.growth_schedule from anon/)
  assert.match(sql, /revoke all on function public\.marketing_calendar\(date\) from public, anon/)
  assert.match(sql, /stable security invoker/)
  assert.doesNotMatch(sql, /using \(true\)/)
})
