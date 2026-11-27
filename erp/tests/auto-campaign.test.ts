import test from 'node:test'
import assert from 'node:assert/strict'
import { approveForInstagram, blogWithShop, autoAdText, autoCampaign, autoCampaignPrompt, autoContentDraft, autoDates, autoReelRequest, parseAutoResult, PROMPT_LIMIT, sourceArticle, type AutoInput } from '../src/lib/autoCampaign.ts'
import { videoInputProblem } from '../src/lib/videoEdits.ts'

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

test('릴스 편집 요청: 캠페인 말을 지시로 · 요청 규칙 통과 · 폴더가 없으면 막힘', () => {
  const r = parseAutoResult(answer)!
  const req = autoReelRequest(r, { folder: '#WKLY_2026/촬영본/성수/원본', template: 'walkthrough', seconds: 30 })
  assert.equal(req.title, '[릴스] 성수 12월 대관')
  assert.equal(req.template, 'walkthrough')
  assert.equal(req.target_seconds, 30)
  assert.match(req.instructions, /연말 팝업, 장소부터 정하세요/)
  assert.match(req.instructions, /장 1 · 장 2/)
  assert.match(req.instructions, /날짜 · 가격 · 숫자는 자막에 옮기지 않습니다/)
  assert.equal(videoInputProblem(req), null)
  assert.equal(videoInputProblem(autoReelRequest(r, { folder: '', template: 'cuts', seconds: 20 })), '촬영 폴더를 골라 주세요.')
  const long = autoReelRequest({ ...r, title: '가'.repeat(300), headline: '나'.repeat(3000) }, { folder: 'a', template: 'cuts', seconds: 20 })
  assert.ok(long.title.length <= 120 && long.instructions.length <= 2000)
  assert.equal(videoInputProblem(long), null)
})

test('원본 글에서 만들기: 글을 넣고 블로그는 비우게 · 한도 안 · 답 형식 줄은 늘 끝까지', () => {
  const body = '성수 팝업 공간을 소개합니다. '.repeat(160) // 약 2,700자
  const source = { id: 'g-1', title: '[시험] 성수 팝업 공간 소개', body }
  const p = autoCampaignPrompt({ ...input, source })
  assert.ok(p.length <= PROMPT_LIMIT)
  assert.match(p, /원본 글\(우리 회사가 이미 쓴 글 · 제목: \[시험\] 성수 팝업 공간 소개/)
  assert.match(p, /blog 의 title · body 는 빈 글/)
  assert.doesNotMatch(p, /블로그\(네이버 검색 · 홈피드 노출 기준\)/)
  assert.ok(p.trimEnd().endsWith('"slides":[{"title":"","body":""}]}'))
  // 칸이 모두 가득 차도 답 형식은 잘리지 않고 원본 글이 줄어든다
  const full = autoCampaignPrompt({ ...input, topic: '가'.repeat(500), facts: '나'.repeat(1200), reference: '다'.repeat(700), source: { ...source, body: '라'.repeat(5000) } })
  assert.ok(full.length <= PROMPT_LIMIT)
  assert.ok(full.trimEnd().endsWith('"slides":[{"title":"","body":""}]}'))
  assert.ok(full.includes('라'.repeat(500)))
  // 원본 글이 없으면 예전 그대로 (블로그 규칙 포함)
  assert.match(autoCampaignPrompt(input), /블로그\(네이버 검색 · 홈피드 노출 기준\)/)
})

test('원본 글에서 만들기: 새 콘텐츠의 블로그는 비우고 원본을 적어 둠 · 원본 고르기 규칙', () => {
  const r = parseAutoResult(answer)!
  const source = { id: 'g-1', title: '원본 제목', body: '본문' }
  const base = { kind: 'content', title: '', owner_id: 'u', status: '작성 중', document: { division: 'TW', source_url: '', note: '' }, campaign_id: null } as const
  const d = autoContentDraft({ ...base, document: { ...base.document } }, { ...input, source }, r, 'camp-1')
  const blog = d.document.versions!.find(v => v.channel === '네이버 블로그')!
  assert.equal(blog.title, ''); assert.equal(blog.body, '')
  assert.match(d.document.original!, /원본 글: 원본 제목 \(\/ads\?tab=content&item=g-1\)/)
  assert.equal(d.document.versions!.find(v => v.channel === '인스타그램')!.body, '캡션')
  const long = '가나다라마바사아자차'.repeat(40)
  assert.deepEqual(sourceArticle({ id: 'x', title: '콘텐츠', document: { versions: [{ channel: '인스타그램', title: '', body: long + long }, { channel: '네이버 블로그', title: '블로그 제목', body: long }] } }), { id: 'x', title: '블로그 제목', body: long })
  assert.equal(sourceArticle({ id: 'x', title: '콘텐츠', document: { versions: [{ channel: '네이버 블로그', title: 't', body: '짧은 글' }] } }), null)
  assert.equal(sourceArticle({ id: 'x', title: '콘텐츠', document: { versions: [{ channel: '홈페이지', title: '', body: long }] } })!.title, '콘텐츠')
})
