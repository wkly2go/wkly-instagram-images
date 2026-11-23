import test from 'node:test'
import assert from 'node:assert/strict'
import { approveForInstagram, blogWithShop, autoAdText, autoCampaign, autoCampaignPrompt, autoContentDraft, autoDates, parseAutoResult, type AutoInput } from '../src/lib/autoCampaign.ts'

const input: AutoInput = { topic: '성수 팝업 공간 12월 대관 오픈', brand: 'wkly', link: '', startDate: '2026-11-21', endDate: '2026-11-27', facts: '12월 첫째 주부터 예약 가능' }
const answer = 'here:\n```json\n' + JSON.stringify({
  title: '성수 12월 대관', audience: '팝업 담당자', insight: '연말 장소를 못 구함', kicker: '12월 대관 오픈',
  headline: '연말 팝업, 장소부터 정하세요', primaryText: '여러 곳에 견적을 돌리고 계신가요?', description: '성수 공간', cta: '대관 문의',
  blog: { title: '블로그 제목', body: '블로그 본문' }, instagram: { caption: '캡션', tags: '#팝업 #성수' },
  youtube: { title: '영상 제목', body: '영상 설명' }, homepage: { title: '소식', body: '홈페이지 본문' }, slides: [{ title: '장 1', body: '설명 1' }, { title: '', body: '' }, { title: '장 2', body: '설명 2' }],
}) + '\n```'

test('요청문: 회사 · 알릴 내용 · 사실 · 규칙 · JSON 형식 · 6,000자 이하', () => {
  const p = autoCampaignPrompt(input)
  assert.match(p, /더위클리/)
  assert.match(p, /성수 팝업 공간/)
  assert.match(p, /예약 가능/)
  assert.match(p, /회사 광고 카피 규칙/)
  assert.match(p, /"instagram"/)
  assert.ok(p.length <= 6000)
  assert.match(autoCampaignPrompt({ ...input, facts: '' }), /지어내지 말고/)
})

test('답 읽기: 울타리 · 앞 설명이 있어도 · 필수 칸이 없으면 null', () => {
  const r = parseAutoResult(answer)!
  assert.equal(r.headline, '연말 팝업, 장소부터 정하세요')
  assert.equal(r.instagram.tags, '#팝업 #성수')
  assert.equal(parseAutoResult('JSON 아님'), null)
  assert.equal(parseAutoResult('{"title":"x"}'), null)
  const noCta = parseAutoResult(JSON.stringify({ headline: 'h', primaryText: 'p', instagram: { caption: 'c' } }))!
  assert.equal(noCta.cta, '자세히 보기')
  assert.equal(noCta.title, 'h')
})

test('캠페인: 예산은 비우고 검토는 꺼 둠 · 링크 기본값', () => {
  const base = { id: '00000000-0000-4000-8000-000000000000', revision: 0, title: '', brand: 'wkly', goal: 'leads', platform: 'meta', landingUrl: '', sourceUrl: '', audience: '', offer: '', headline: '', primaryText: '', description: '', cta: '', startDate: '2026-11-20', endDate: '2026-11-22', dailyBudget: 10000, totalBudget: 50000, reviews: { content: true, rights: true, budget: true }, textAdConfirmed: false, seasonNote: '', status: 'ready', createdAt: '', updatedAt: '' } as const
  const c = autoCampaign({ ...base, reviews: { ...base.reviews } }, input, parseAutoResult(answer)!)
  assert.equal(c.dailyBudget, null)
  assert.deepEqual(c.reviews, { content: false, rights: false, budget: false })
  assert.equal(c.landingUrl, 'https://www.thewklyn.com/')
  assert.equal(c.status, 'draft')
  assert.equal(c.startDate, '2026-11-21')
  assert.deepEqual(autoAdText(parseAutoResult(answer)!), { kicker: '12월 대관 오픈', headline: '연말 팝업, 장소부터 정하세요', sub: '성수 공간', cta: '대관 문의' })
})

test('콘텐츠 초안: 4채널 초안 · 캠페인 연결 · 승인은 인스타그램만', () => {
  const base = { kind: 'content', title: '', owner_id: 'u', status: '작성 중', document: { division: 'TW', source_url: '', note: '' }, campaign_id: null } as const
  const d = autoContentDraft({ ...base, document: { ...base.document } }, input, parseAutoResult(answer)!, 'camp-1')
  assert.equal(d.campaign_id, 'camp-1')
  assert.deepEqual(d.document.versions!.map(v => v.channel), ['네이버 블로그', '인스타그램', '유튜브', '홈페이지'])
  assert.ok(d.document.versions!.every(v => v.status === '초안' && !v.rights))
  const a = approveForInstagram(d)
  assert.deepEqual(a.document.versions!.map(v => v.status), ['초안', '승인', '초안', '초안'])
  assert.equal(a.document.versions![1].rights, true)
  assert.equal(autoContentDraft({ ...base, document: { ...base.document } }, { ...input, brand: 'arterior' }, parseAutoResult(answer)!, 'c').document.division, 'AR')
})

test('기간 기본값: 오늘부터 7일', () => {
  assert.deepEqual(autoDates('2026-11-28'), { startDate: '2026-11-28', endDate: '2026-12-04' })
})

test('카드뉴스 장: 빈 장은 버림 · 최대 7장', () => {
  assert.deepEqual(parseAutoResult(answer)!.slides.map(x => x.title), ['장 1', '장 2'])
})

test('블로그 끝 크리에이터샵 줄: https 주소만 · 중복 없음', () => {
  assert.match(blogWithShop('본문', 'https://shopping.naver.com/creator/x'), /크리에이터샵\): https:\/\/shopping.naver.com\/creator\/x$/)
  assert.equal(blogWithShop('본문', ''), '본문')
  assert.equal(blogWithShop('본문', 'javascript:alert(1)'), '본문')
  const once = blogWithShop('본문', 'https://a.b/c')
  assert.equal(blogWithShop(once, 'https://a.b/c'), once)
})
