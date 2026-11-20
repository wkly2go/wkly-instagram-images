import test from 'node:test'
import assert from 'node:assert/strict'
import { canExecute, cleanAccountId, daysLeftInMonth, DEFAULT_SETTINGS, judge, leadsOf, roundBudget, type InsightDay, type MetaCampaign } from '../supabase/functions/ad-autopilot/rules.ts'

const today = '2026-11-20'
/** 어제까지 7일 동안 매일 같은 숫자 */
const week = (id: string, d: { imp: number; clk: number; spend: number; leads: number }): InsightDay[] =>
  Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${String(13 + i).padStart(2, '0')}`, campaign_id: id, campaign_name: id, impressions: d.imp, clicks: d.clk, spend: d.spend, leads: d.leads }))
const camp = (id: string, budget: number | null = 20000, status = 'ACTIVE'): MetaCampaign => ({ id, name: id, status, daily_budget: budget })
const S = { ...DEFAULT_SETTINGS, monthly_cap: 2_000_000, daily_cap: 80_000, target_cpl: 20000 }

test('클릭 없이 돈만 쓰면 멈춤', () => {
  const p = judge(today, [camp('a')], week('a', { imp: 2000, clk: 0, spend: 10000, leads: 0 }), { ...S, target_cpl: null }, 0)
  assert.equal(p.length, 1)
  assert.equal(p[0].kind, 'pause')
  assert.match(p[0].reason, /클릭이 없습니다/)
})

test('자료 부족 · 꺼진 캠페인은 판단하지 않음', () => {
  assert.deepEqual(judge(today, [camp('a')], week('a', { imp: 100, clk: 0, spend: 1000, leads: 0 }), S, 0), [])
  assert.deepEqual(judge(today, [camp('a', 20000, 'PAUSED')], week('a', { imp: 5000, clk: 0, spend: 20000, leads: 0 }), S, 0), [])
})

test('목표 문의당 비용: 2배 넘으면 멈춤 · 1.3배 넘으면 줄임 · 0.8배 이하면 늘림', () => {
  const days = [
    ...week('bad', { imp: 3000, clk: 30, spend: 10000, leads: 0 }), // 7만 원 · 문의 0 → 목표 2배 이상 씀
    ...week('mid', { imp: 3000, clk: 30, spend: 10000, leads: 0 }).map((d, i) => ({ ...d, leads: i < 3 ? 1 : 0 })), // 7만 / 3 = 23,333 > 26,000? 아님
    ...week('good', { imp: 3000, clk: 40, spend: 10000, leads: 1 }), // 7만 / 7 = 1만 ≤ 1.6만
  ]
  const mid2 = week('mid2', { imp: 3000, clk: 30, spend: 10000, leads: 0 }).map((d, i) => ({ ...d, leads: i < 2 ? 1 : 0 })) // 3.5만 > 2.6만 → 줄임
  const p = judge(today, [camp('bad'), camp('mid'), camp('mid2'), camp('good')], [...days, ...mid2], S, 300_000)
  const by = Object.fromEntries(p.map(x => [x.campaign_id, x]))
  assert.equal(by.bad.kind, 'pause')
  assert.equal(by.mid, undefined)
  assert.equal(by.mid2.kind, 'scale_down')
  assert.equal(by.mid2.to_budget, 16000)
  assert.equal(by.good.kind, 'scale_up')
  assert.equal(by.good.to_budget, 24000)
  assert.deepEqual(p.map(x => x.kind), ['pause', 'scale_down', 'scale_up'])
})

test('증액은 한도 안에서만: 하루 합계 · 이번 달 남은 예상 · 한도 미설정이면 안 함', () => {
  const days = week('good', { imp: 3000, clk: 40, spend: 10000, leads: 1 })
  assert.equal(judge(today, [camp('good')], days, { ...S, daily_cap: 22000 }, 0).length, 0)
  assert.equal(judge(today, [camp('good')], days, { ...S, monthly_cap: 0 }, 0).length, 0)
  // 남은 11일 × 2.4만 = 26.4만 + 이미 쓴 180만 > 200만
  assert.equal(judge(today, [camp('good')], days, S, 1_800_000).length, 0)
  assert.equal(judge(today, [camp('good')], days, S, 1_700_000)[0].kind, 'scale_up')
})

test('월 한도에 닿으면 켜진 캠페인 모두 멈춤', () => {
  const p = judge(today, [camp('a'), camp('b'), camp('c', 1000, 'PAUSED')], [], S, 2_000_000)
  assert.deepEqual(p.map(x => [x.campaign_id, x.kind]), [['a', 'pause'], ['b', 'pause']])
})

test('목표가 없으면 계정 평균과 비교', () => {
  const days = [
    ...week('hi', { imp: 2000, clk: 60, spend: 6000, leads: 0 }), // 클릭률 3% · 100원
    ...week('lo', { imp: 4000, clk: 20, spend: 8000, leads: 0 }), // 0.5% · 400원
    ...week('mid', { imp: 4000, clk: 60, spend: 12000, leads: 0 }),
  ]
  const p = judge(today, [camp('hi'), camp('lo'), camp('mid')], days, { ...S, target_cpl: null }, 0)
  const by = Object.fromEntries(p.map(x => [x.campaign_id, x.kind]))
  assert.equal(by.lo, 'pause')
  assert.equal(by.hi, 'scale_up')
  assert.equal(by.mid, undefined)
})

test('예산이 광고 세트에 있는 캠페인(daily_budget 없음)은 예산을 바꾸지 않음', () => {
  const p = judge(today, [camp('g', null)], week('g', { imp: 3000, clk: 40, spend: 10000, leads: 1 }), S, 0)
  assert.deepEqual(p, [])
})

test('실행 여부: 긴급 정지 · 모드 · 승인', () => {
  assert.equal(canExecute({ mode: 'auto', kill_switch: true }, true), false)
  assert.equal(canExecute({ mode: 'auto', kill_switch: false }, false), true)
  assert.equal(canExecute({ mode: 'approve', kill_switch: false }, false), false)
  assert.equal(canExecute({ mode: 'approve', kill_switch: false }, true), true)
  assert.equal(canExecute({ mode: 'suggest', kill_switch: false }, true), false)
})

test('도움 함수: 문의 수 · 계정 번호 · 남은 날 · 천 원 단위', () => {
  assert.equal(leadsOf([{ action_type: 'lead', value: '3' }, { action_type: 'onsite_conversion.lead_grouped', value: '3' }]), 3)
  assert.equal(leadsOf([{ action_type: 'onsite_conversion.lead_grouped', value: '2' }, { action_type: 'link_click', value: 9 }]), 2)
  assert.equal(leadsOf(undefined), 0)
  assert.equal(cleanAccountId('act_1234567890'), '1234567890')
  assert.equal(cleanAccountId('abc'), null)
  assert.equal(daysLeftInMonth('2026-11-20'), 11)
  assert.equal(roundBudget(23456), 23000)
  assert.equal(roundBudget(300), 1000)
})
