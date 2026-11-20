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

// ── 2단계: 소재 피로 · 효과 확인 ──
import { evaluate, fatigue, type AdDay, type MetaAd } from '../supabase/functions/ad-autopilot/rules.ts'

const adWeek = (id: string, start: number, d: { imp: number; clk: number }): AdDay[] =>
  Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${String(start + i).padStart(2, '0')}`, ad_id: id, impressions: d.imp, clicks: d.clk, spend: 5000, leads: 0 }))
const ad = (id: string, cid = 'c', status = 'ACTIVE'): MetaAd => ({ id, name: `소재 ${id}`, campaign_id: cid, status })

test('소재 피로: 클릭률 30% 이상 하락 + 빈도 3 이상이면 가장 나쁜 소재 하나만 멈춤', () => {
  const days = [
    ...adWeek('x', 6, { imp: 1000, clk: 20 }), ...adWeek('x', 13, { imp: 1000, clk: 12 }), // 2% → 1.2% (-40%)
    ...adWeek('y', 6, { imp: 1000, clk: 20 }), ...adWeek('y', 13, { imp: 1000, clk: 8 }), // 2% → 0.8% (-60%)
    ...adWeek('z', 6, { imp: 1000, clk: 20 }), ...adWeek('z', 13, { imp: 1000, clk: 19 }),
  ]
  const p = fatigue(today, [camp('c')], [ad('x'), ad('y'), ad('z')], days, { x: 3.4, y: 1.2 }, new Set())
  assert.equal(p.length, 1)
  assert.equal(p[0].ad_id, 'y') // 빈도는 낮지만 절반 넘게 떨어짐 → 더 나쁨
  assert.match(p[0].reason, /60% 떨어졌습니다/)
  assert.ok(p[0].metrics.base_cpc != null)
})

test('소재 피로: 마지막 소재 · 이미 판단한 캠페인 · 빈도 낮고 덜 떨어진 소재는 그대로', () => {
  const one = [...adWeek('x', 6, { imp: 1000, clk: 20 }), ...adWeek('x', 13, { imp: 1000, clk: 5 })]
  assert.equal(fatigue(today, [camp('c')], [ad('x'), ad('w', 'c', 'PAUSED')], one, {}, new Set()).length, 0)
  const two = [...one, ...adWeek('w', 6, { imp: 1000, clk: 20 }), ...adWeek('w', 13, { imp: 1000, clk: 20 })]
  assert.equal(fatigue(today, [camp('c')], [ad('x'), ad('w')], two, {}, new Set(['c'])).length, 0)
  const mild = [...adWeek('x', 6, { imp: 1000, clk: 20 }), ...adWeek('x', 13, { imp: 1000, clk: 13 }), ...adWeek('w', 6, { imp: 1000, clk: 20 }), ...adWeek('w', 13, { imp: 1000, clk: 20 })]
  assert.equal(fatigue(today, [camp('c')], [ad('x'), ad('w')], mild, { x: 2 }, new Set()).length, 0) // -35% 지만 빈도 2
})

test('효과 확인: 7일이 지나야 · 늘림/줄임/멈춤 판정', () => {
  const after = (cid: string, spend: number, leads: number, clicks = 100): InsightDay[] =>
    Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${String(11 + i).padStart(2, '0')}`, campaign_id: cid, campaign_name: cid, impressions: 1000, clicks, spend, leads }))
  // 11/10 실행 → 11/11~17 이 지나야 함 (오늘 11/20 이면 됨 · 11/15 면 아직)
  assert.equal(evaluate('2026-11-15', { kind: 'scale_up', day: '2026-11-10', campaign_id: 'a', metrics: { cpl: 10000, leads: 5 } }, after('a', 10000, 1)), null)
  const up = evaluate(today, { kind: 'scale_up', day: '2026-11-10', campaign_id: 'a', metrics: { cpl: 10000, leads: 5 } }, after('a', 10000, 1))! // 7만 / 7건 = 1만
  assert.equal(up.verdict, '좋아짐')
  const upBad = evaluate(today, { kind: 'scale_up', day: '2026-11-10', campaign_id: 'a', metrics: { cpl: 10000, leads: 5 } }, after('a', 20000, 0).map((d, i) => ({ ...d, leads: i < 4 ? 1 : 0 })))! // 14만 / 4 = 3.5만
  assert.equal(upBad.verdict, '나빠짐')
  const down = evaluate(today, { kind: 'scale_down', day: '2026-11-10', campaign_id: 'a', metrics: { cpl: 30000, leads: 2 } }, after('a', 4000, 0).map((d, i) => ({ ...d, leads: i < 2 ? 1 : 0 })))! // 2.8만 / 2 = 1.4만
  assert.equal(down.verdict, '좋아짐')
  // 캠페인 멈춤: 나머지 계정(b)의 문의당 비용이 기준 2만 → 1만 이면 좋아짐 · 아낀 돈 기록
  const pause = evaluate(today, { kind: 'pause', day: '2026-11-10', campaign_id: 'a', metrics: { spend: 70000, base_cpl: 20000 } }, [...after('a', 0, 0), ...after('b', 10000, 1)])!
  assert.equal(pause.verdict, '좋아짐')
  assert.match(pause.note, /70,000원 아낌/)
})

import { ruleScorecard } from '../src/lib/adScorecard.ts'

test('규칙 성적표: 실행한 것만 · 효과 확인한 것으로 성공률 · 4건 이상일 때만 제안', () => {
  const up = (effect: '좋아짐' | '나빠짐' | '비슷' | null) => ({ kind: 'scale_up' as const, status: '실행', effect })
  const s = ruleScorecard([up('좋아짐'), up('나빠짐'), up('나빠짐'), up('비슷'), up(null), { kind: 'scale_up', status: '제안', effect: null },
    { kind: 'pause', ad_id: 'a1', status: '실행', effect: '좋아짐' }, { kind: 'pause', status: '실행', effect: '나빠짐' }])
  const byKey = Object.fromEntries(s.map(r => [r.key, r]))
  assert.equal(byKey.scale_up.executed, 5)
  assert.equal(byKey.scale_up.checked, 4)
  assert.equal(byKey.scale_up.rate, 0.25)
  assert.match(byKey.scale_up.advice!, /엄격하게/)
  assert.equal(byKey.pause_ad.good, 1)
  assert.equal(byKey.pause.bad, 1)
  assert.equal(byKey.pause.advice, null) // 1건뿐
  const great = ruleScorecard([up('좋아짐'), up('좋아짐'), up('좋아짐'), up('비슷')])
  assert.match(great[0].advice!, /키워도/)
})
