import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analysisPicks, pickReference } from '../src/lib/analysisPicks.ts'
import { autoCampaignPrompt } from '../src/lib/autoCampaign.ts'

const now = Date.parse('2026-11-27T09:00:00Z')
const r = (id: string, kind: string, days: number) => ({ id, kind, title: `제목 ${id}`, summary: '요약  글', source_name: '출처', source_url: null, created_at: new Date(now - days * 86_400_000).toISOString() })

test('최근 2주 · 종류마다 3개까지 · 최신 순 · 다른 종류 자료는 뺀다', () => {
  const list = analysisPicks([r('a', '트렌드·밈', 1), r('b', '트렌드·밈', 2), r('c', '트렌드·밈', 3), r('d', '트렌드·밈', 4), r('e', '팝업 정보', 5), r('f', '팝업 정보', 20), r('g', '거래처 리포트', 1)], [], now)
  assert.deepEqual(list.map(p => p.key), ['r:a', 'r:b', 'r:c', 'r:e'])
  assert.equal(list[0].note, '요약 글')
})

test('경쟁사 글은 조회수 높은 순 3개 · 30일 안', () => {
  const post = (id: string, views: number | null, days: number) => ({ id, competitor_id: 'c', source: 'youtube' as const, title: id, url: '', summary: '', published_at: new Date(now - days * 86_400_000).toISOString(), views, likes: null, comments: null, owner: '경쟁사' })
  const list = analysisPicks([], [post('p1', 10, 2), post('p2', 900, 3), post('p3', 50, 4), post('p4', 70, 5), post('old', 99999, 40)], now)
  assert.deepEqual(list.map(p => p.key), ['p:p2', 'p:p4', 'p:p3'])
  assert.match(list[0].source, /경쟁사 · 유튜브 · 조회 900/)
})

test('고른 자료는 참고로만 요청문에 들어간다 (700자 · 사실로 쓰지 말라는 말과 함께)', () => {
  const ref = pickReference({ key: 'r:a', group: '트렌드·밈', title: '제목', note: '가'.repeat(2000), source: '출처', at: '' })
  assert.ok(ref.length <= 700)
  const base = { topic: '주제', brand: 'wkly' as const, link: '', startDate: '', endDate: '', facts: '' }
  const prompt = autoCampaignPrompt({ ...base, reference: ref })
  assert.match(prompt, /참고한 분석 자료/)
  assert.match(prompt, /베끼지 않는다/)
  assert.doesNotMatch(autoCampaignPrompt(base), /참고한 분석 자료/)
  assert.ok(prompt.length <= 5800)
})
