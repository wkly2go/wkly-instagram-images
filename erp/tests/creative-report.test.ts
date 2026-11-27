import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { convertRate, creativeReport, sourceLabel, tagName, type CreativeSource } from '../src/lib/creativeReport.ts'
import { campaignSlug } from '../src/lib/utmLinks.ts'

const src: CreativeSource = {
  days: 180,
  untagged: { inquiries: 49, direct: 12, projects: 1, won: 0 },
  contents: [
    { id: 'c1', title: '[시험] 성수 팝업 상권 리포트', status: '발행 기록', updated_at: '2026-11-25T00:00:00Z', channels: [{ channel: '네이버 블로그', status: '발행', url: 'https://blog.naver.com/x/1' }, { channel: '인스타그램', status: '초안', url: '' }] },
    { id: 'c2', title: '연말 팝업 준비 체크리스트', status: '작성 중', updated_at: '2026-11-26T00:00:00Z', channels: [{ channel: '홈페이지', status: '초안', url: '' }] },
    { id: 'c3', title: '게시했지만 조용한 글', status: '발행 기록', updated_at: '2026-11-20T00:00:00Z', channels: [{ channel: '유튜브', status: '초안', url: 'https://youtu.be/x' }] },
  ],
  campaigns: [{ id: 'aaaa-1111', title: '팝업 대행 문의 2주 시험', platform: 'meta', status: 'draft' }],
  tags: [
    { campaign: encodeURIComponent(campaignSlug('[시험] 성수 팝업 상권 리포트')), source: 'naver_blog', inquiries: 6, direct: 2, projects: 1, won: 1, last_at: '2026-11-26T00:00:00Z' },
    { campaign: campaignSlug('[시험] 성수 팝업 상권 리포트'), source: 'instagram', inquiries: 3, direct: 0, projects: 0, won: 0, last_at: '2026-11-26T00:00:00Z' },
    { campaign: 'aaaa-1111', source: 'meta', inquiries: 4, direct: 1, projects: 0, won: 0, last_at: '2026-11-26T00:00:00Z' },
    { campaign: campaignSlug('팝업 대행 문의 2주 시험', 'ad'), source: 'meta', inquiries: 1, direct: 0, projects: 0, won: 0, last_at: '2026-11-26T00:00:00Z' },
    { campaign: 'report26h1_b_v1', source: 'ig', inquiries: 18, direct: 0, projects: 0, won: 0, last_at: '2026-11-01T00:00:00Z' },
  ],
}

test('꼬리표를 콘텐츠 · 광고와 잇는다 (주소에 묶인 한글 꼬리표도 풀어서)', () => {
  const r = creativeReport(src)
  const content = r.rows.find(x => x.key === 'c:c1')!
  assert.equal(content.inquiries, 9)
  assert.equal(content.projects, 1)
  assert.deepEqual(content.sources, [{ source: '네이버 블로그', inquiries: 6 }, { source: '인스타그램', inquiries: 3 }])
  assert.deepEqual(content.placed, ['네이버 블로그'])
  const ad = r.rows.find(x => x.key === 'm:aaaa-1111')!
  assert.equal(ad.inquiries, 5) // 캠페인 번호로 4 + 제목 이름으로 1
  assert.deepEqual(ad.placed, ['메타'])
  assert.equal(tagName('%EC%84%B1%EC%88%98'), '성수')
  assert.equal(tagName('%E0%A4%A'), '%E0%A4%A')
})

test('못 이은 꼬리표는 그대로 한 줄 · 문의 많은 순 · 게시했지만 문의 없는 콘텐츠도 보인다', () => {
  const r = creativeReport(src)
  assert.deepEqual(r.rows.map(x => x.key), ['t:report26h1_b_v1', 'c:c1', 'm:aaaa-1111', 'c:c3'])
  assert.equal(r.rows[0].kind, '꼬리표')
  assert.equal(r.rows[0].sources[0].source, '인스타그램')
  assert.equal(r.tagged, 32)
  assert.equal(r.matched, 14)
  assert.equal(r.rows.some(x => x.key === 'c:c2'), false) // 아직 내보내지 않은 글은 빼 둠
  assert.equal(r.untagged.inquiries, 49)
})

test('출처 이름 · 전환율', () => {
  assert.equal(sourceLabel('NAVER_BLOG'), '네이버 블로그')
  assert.equal(sourceLabel('somewhere'), 'somewhere')
  assert.equal(sourceLabel(''), '출처 표시 없음')
  assert.equal(convertRate(9, 1), 11)
  assert.equal(convertRate(0, 0), null)
})

test('DB 함수: 읽기만 · 호출한 사람 권한 · 시험 문의 제외 · 문의한 사람 정보는 주지 않는다', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261127213000_marketing_creative_report.sql', import.meta.url), 'utf8')
  assert.match(sql, /stable security invoker/)
  assert.match(sql, /revoke all on function public\.marketing_creative_report\(\) from public, anon/)
  assert.match(sql, /not coalesce\(i\.is_test, false\)/)
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop)\b/i)
  assert.doesNotMatch(sql, /\b(email|phone|brand|detail|memo)\b/i)
})
