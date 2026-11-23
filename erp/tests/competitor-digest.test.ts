import test from 'node:test'
import assert from 'node:assert/strict'
import { adLibraryUrl, cadenceNote, cleanInstagramHandle, cleanNaverBlogId, cleanYoutubeHandle, competitorStats, titleWords, topicIdeas, type Competitor, type CompetitorPost } from '../src/lib/competitorDigest.ts'

const now = Date.parse('2026-11-20T00:00:00Z')
const comp = (id: string, is_self = false): Competitor => ({ id, name: `회사 ${id}`, brand: 'wkly', is_self, homepage: null, naver_blog_id: null, youtube_handle: null, instagram_handle: null, note: '', active: true, last_checked_at: null, last_error: null })
let n = 0
const post = (cid: string, title: string, daysAgo: number, views: number | null = null, source: CompetitorPost['source'] = 'naver_blog'): CompetitorPost =>
  ({ id: String(++n), competitor_id: cid, source, title, url: `https://x/${n}`, summary: '', published_at: new Date(now - daysAgo * 86_400_000).toISOString(), views, likes: null, comments: null })

test('제목 낱말: 조사 떼기 · 흔한 낱말 · 숫자 빼기 · 두 글자 낱말 유지', () => {
  assert.deepEqual(titleWords('성수동에서 열린 팝업 후기 2026'), ['성수동', '열린', '팝업'])
  assert.deepEqual(titleWords('브랜드를 위한 공간 디자인'), ['브랜드', '위한', '공간', '디자인'])
})

test('곳마다 30일 통계: 오래된 글 빼고 · 영상 평균 조회 · 반응 좋은 글', () => {
  const posts = [post('a', '팝업 공간', 3), post('a', '오래된 글', 40), post('a', '영상', 5, 1000, 'youtube'), post('a', '영상2', 6, 3000, 'youtube')]
  const [s] = competitorStats([comp('a')], posts, now)
  assert.equal(s.posts30, 3)
  assert.equal(s.video30, 2)
  assert.equal(s.avgViews, 2000)
  assert.equal(s.top?.title, '영상2')
  assert.equal(s.perWeek, 0.7)
})

test('주제 제안: 경쟁사 2곳 이상이 쓰고 우리는 안 쓴 낱말만', () => {
  const posts = [post('a', '연말 팝업 기획', 2), post('b', '연말 브랜드 팝업', 3), post('me', '팝업 운영 후기', 1), post('b', '굿즈 제작', 4)]
  const ideas = topicIdeas([comp('a'), comp('b'), comp('me', true)], posts, now)
  assert.deepEqual(ideas.map(i => i.word), ['연말'])
  assert.deepEqual(ideas[0].owners.sort(), ['회사 a', '회사 b'])
})

test('게시 빈도 비교 문장', () => {
  const stats = competitorStats([comp('a'), comp('me', true)], [...Array.from({ length: 12 }, (_, i) => post('a', `글 ${i}`, i + 1)), post('me', '우리 글', 2)], now)
  assert.match(cadenceNote(stats)!, /경쟁사는 평균 주 2\.8건 .* 우리는 주 0\.2건/)
  assert.equal(cadenceNote(stats.filter(s => !s.isSelf)), null)
})

test('주소를 붙여도 아이디만 · 광고 라이브러리 링크', () => {
  assert.equal(cleanNaverBlogId('https://blog.naver.com/abc_1?x=1'), 'abc_1')
  assert.equal(cleanNaverBlogId('잘못'), null)
  assert.equal(cleanYoutubeHandle('https://www.youtube.com/@thewkly/videos'), '@thewkly')
  assert.equal(cleanYoutubeHandle('thewkly'), '@thewkly')
  assert.equal(cleanInstagramHandle('https://www.instagram.com/theweekly_magazine/'), 'theweekly_magazine')
  assert.match(adLibraryUrl('더 위클리'), /country=KR&q=%EB%8D%94%20%EC%9C%84/)
})
