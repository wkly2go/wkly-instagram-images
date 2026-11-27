import test from 'node:test'
import assert from 'node:assert/strict'
import { adLink, buildMetaSpec, launchProblem, metaCta, metaProblems, type CampaignDoc } from '../supabase/functions/ad-autopilot/metaCreate.ts'

const now = new Date('2026-11-21T03:00:00Z')
const doc = (p: Partial<CampaignDoc> = {}): CampaignDoc => ({
  title: '성수 팝업 대행', brand: 'arterior', goal: 'leads', platform: 'meta', landingUrl: 'https://example.com/contact',
  headline: '팝업 준비, 한 팀으로', primaryText: '본문', description: '설명', cta: '문의하기',
  startDate: '2026-11-25', endDate: '2026-12-10', dailyBudget: 20000, totalBudget: null, status: 'ready', ...p,
})
const ids = { pageId: '111', igUserId: '17841475999645207' }

test('행동 유도 글 → 메타 버튼', () => {
  assert.equal(metaCta('문의하기'), 'CONTACT_US')
  assert.equal(metaCta('지금 예약'), 'BOOK_NOW')
  assert.equal(metaCta('더 알아보기'), 'LEARN_MORE')
})

test('만들기 전 확인: 문제없으면 빈 목록', () => {
  assert.deepEqual(metaProblems(doc(), ids, 1, now), [])
})

test('만들기 전 확인: 매체 · 상태 · 이미지 · 예산 · 페이지', () => {
  const p = metaProblems(doc({ platform: 'naver', status: 'draft', dailyBudget: null, landingUrl: 'http://x.com' }), {}, 0, now)
  assert.equal(p.length, 6)
  assert.ok(p.some(x => x.includes('페이스북 페이지')))
  assert.deepEqual(metaProblems(doc({ dailyBudget: null, totalBudget: 300000 }), ids, 2, now), [])
  assert.ok(metaProblems(doc({ endDate: '2026-11-01' }), ids, 1, now).some(x => x.includes('지났습니다')))
})

test('모두 멈춤으로 만들고 목표에 맞는 최적화', () => {
  const s = buildMetaSpec(doc(), ids, now)
  assert.equal(s.campaign.status, 'PAUSED')
  assert.equal(s.adset.status, 'PAUSED')
  assert.equal(s.campaign.objective, 'OUTCOME_TRAFFIC')
  assert.equal(s.adset.optimization_goal, 'LINK_CLICKS')
  assert.equal(s.adset.daily_budget, '20000')
  assert.equal(s.adset.start_time, '2026-11-25T00:00:00+0900')
  assert.equal(s.ad('a', 'c').status, 'PAUSED')
  const aw = buildMetaSpec(doc({ goal: 'awareness', startDate: '2026-11-01', dailyBudget: null, totalBudget: 500000 }), ids, now)
  assert.equal(aw.campaign.objective, 'OUTCOME_AWARENESS')
  assert.equal(aw.adset.destination_type, undefined)
  assert.equal(aw.adset.start_time, undefined)
  assert.equal(aw.adset.lifetime_budget, '500000')
})

test('이미지 1장 = 단일 · 여러 장 = 슬라이드', () => {
  const s = buildMetaSpec(doc(), ids, now)
  const one = JSON.parse(s.creative(['h1']).object_story_spec)
  assert.equal(one.link_data.image_hash, 'h1')
  assert.equal(one.instagram_user_id, ids.igUserId)
  assert.equal(one.link_data.call_to_action.type, 'CONTACT_US')
  const many = JSON.parse(s.creative(['h1', 'h2']).object_story_spec)
  assert.equal(many.link_data.child_attachments.length, 2)
})

test('켜기 전 하루 한도', () => {
  assert.equal(launchProblem(0, 999999, 20000, false), null)
  assert.ok(launchProblem(50000, 40000, 20000, false))
  assert.equal(launchProblem(50000, 30000, 20000, false), null)
  assert.ok(launchProblem(0, 0, 20000, true))
})

test('광고 주소에 꼬리표가 붙는다 · 이미 있으면 그대로', () => {
  const link = adLink({ landingUrl: 'https://thewklyn.com/report', title: '[인트라넷] 연말 팝업 리포트' })
  assert.match(link, /^https:\/\/thewklyn\.com\/report\?utm_source=meta&utm_medium=paid_social&utm_campaign=/)
  assert.equal(new URL(link).searchParams.get('utm_campaign'), '연말-팝업-리포트')
  assert.equal(adLink({ landingUrl: 'https://thewklyn.com/?utm_source=x', title: 't' }), 'https://thewklyn.com/?utm_source=x')
  const one = JSON.parse(buildMetaSpec(doc(), ids, now).creative(['h1']).object_story_spec)
  assert.equal(new URL(one.link_data.link).searchParams.get('utm_source'), 'meta')
  assert.equal(one.link_data.call_to_action.value.link, one.link_data.link)
})
