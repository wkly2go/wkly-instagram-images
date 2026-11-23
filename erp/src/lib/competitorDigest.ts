// 경쟁사 추적 분석 (2026-11-20 · 광고 자동 운영 3단계 · DB 20261120230000_ad_competitors)
// 서버가 매일 모은 공개 글 · 영상(네이버 블로그 · 유튜브)으로 계산만 한다 — AI 없음 · 같은 자료면 늘 같은 결과.
// ① 곳마다 30일 게시 수 · 주당 게시 · 영상 평균 조회 · 가장 반응 좋은 글
// ② 경쟁사가 많이 쓰는 낱말 (제목) · 우리가 안 쓰는 것 = 주제 제안
// ③ 우리(is_self)와 게시 빈도 차이
// 시험: tests/competitor-digest.test.ts
export interface Competitor {
  id: string; name: string; brand: 'wkly' | 'arterior' | 'both'; is_self: boolean
  homepage: string | null; naver_blog_id: string | null; youtube_handle: string | null; instagram_handle: string | null
  note: string; active: boolean; last_checked_at: string | null; last_error: string | null
}
export interface CompetitorPost {
  id: string; competitor_id: string; source: 'naver_blog' | 'youtube'; title: string; url: string; summary: string
  published_at: string | null; views: number | null; likes: number | null; comments: number | null
}
export interface CompetitorStat {
  id: string; name: string; isSelf: boolean
  posts30: number; perWeek: number; blog30: number; video30: number
  avgViews: number | null; top: CompetitorPost | null; lastPostAt: string | null
}
export interface TopicIdea { word: string; count: number; owners: string[]; example: CompetitorPost }

const DAY = 86_400_000
/** 제목에서 뽑지 않을 흔한 낱말 */
const STOP = new Set(['그리고', '이번', '오늘', '우리', '정말', '진짜', '소개', '후기', '이야기', '함께', '안내', '공지', '이벤트', '영상', '블로그', '쇼츠', 'shorts', '공식', '채널', '모음', '정리', '방법', '추천', 'the', 'and', 'for', 'with', 'vlog'])

/** 제목 낱말: 한글 2자 이상 · 영문 3자 이상 · 숫자만 · 흔한 낱말 · 끝 조사 뗌 */
export function titleWords(title: string): string[] {
  const out = new Set<string>()
  for (const raw of title.toLowerCase().split(/[^0-9a-z가-힣]+/)) {
    let w = raw.replace(/(으로|에서|에게|까지|부터|이랑|하고|처럼|보다|은|는|이|가|을|를|의|에|와|과|도|만|로)$/, '')
    if (/^[가-힣]+$/.test(raw) && raw.length <= 2) w = raw // 두 글자 낱말은 조사 떼지 않음 ('팝업' 등)
    if (!w || /^\d+$/.test(w) || STOP.has(w)) continue
    if (/^[가-힣]+$/.test(w) ? w.length >= 2 : w.length >= 3) out.add(w)
  }
  return [...out]
}

export function competitorStats(comps: Competitor[], posts: CompetitorPost[], now = Date.now()): CompetitorStat[] {
  return comps.map(c => {
    const mine = posts.filter(p => p.competitor_id === c.id)
    const recent = mine.filter(p => p.published_at && now - Date.parse(p.published_at) <= 30 * DAY)
    const vids = recent.filter(p => p.source === 'youtube' && p.views != null)
    const top = [...recent].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.published_at ?? '').localeCompare(a.published_at ?? ''))[0] ?? null
    const last = mine.reduce<string | null>((m, p) => (p.published_at && (!m || p.published_at > m) ? p.published_at : m), null)
    return {
      id: c.id, name: c.name, isSelf: c.is_self,
      posts30: recent.length, perWeek: Math.round((recent.length / 30) * 7 * 10) / 10,
      blog30: recent.filter(p => p.source === 'naver_blog').length, video30: recent.filter(p => p.source === 'youtube').length,
      avgViews: vids.length ? Math.round(vids.reduce((s, p) => s + (p.views ?? 0), 0) / vids.length) : null,
      top, lastPostAt: last,
    }
  }).sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || b.posts30 - a.posts30)
}

/**
 * 주제 제안: 지난 30일 경쟁사 제목에 2곳 이상(또는 한 곳에서 3번 이상) 나온 낱말 중 우리 제목에는 없는 것.
 * 영상은 조회수가 높은 글의 낱말에 가중치. 많이 쓰인 순 최대 8개.
 */
export function topicIdeas(comps: Competitor[], posts: CompetitorPost[], now = Date.now()): TopicIdea[] {
  const self = new Set(comps.filter(c => c.is_self).map(c => c.id))
  const name = new Map(comps.map(c => [c.id, c.name]))
  const recent = posts.filter(p => p.published_at && now - Date.parse(p.published_at) <= 30 * DAY)
  const ours = new Set(recent.filter(p => self.has(p.competitor_id)).flatMap(p => titleWords(p.title)))
  const tally = new Map<string, { count: number; owners: Set<string>; best: CompetitorPost; score: number }>()
  for (const p of recent) {
    if (self.has(p.competitor_id)) continue
    for (const w of titleWords(p.title)) {
      const t = tally.get(w) ?? { count: 0, owners: new Set<string>(), best: p, score: 0 }
      t.count++; t.owners.add(p.competitor_id)
      t.score += 1 + (p.views ? Math.log10(1 + p.views) / 2 : 0)
      if ((p.views ?? -1) > (t.best.views ?? -1)) t.best = p
      tally.set(w, t)
    }
  }
  return [...tally.entries()]
    .filter(([w, t]) => !ours.has(w) && (t.owners.size >= 2 || t.count >= 3))
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([word, t]) => ({ word, count: t.count, owners: [...t.owners].map(id => name.get(id) ?? ''), example: t.best }))
}

/** 우리와 경쟁사 평균 게시 빈도 비교 문장 (우리 계정이 등록돼 있을 때만) */
export function cadenceNote(stats: CompetitorStat[]): string | null {
  const me = stats.find(s => s.isSelf)
  const others = stats.filter(s => !s.isSelf && s.posts30 > 0)
  if (!me || !others.length) return null
  const avg = Math.round((others.reduce((s, o) => s + o.perWeek, 0) / others.length) * 10) / 10
  if (me.perWeek + 0.5 < avg) return `경쟁사는 평균 주 ${avg}건 올리는데 우리는 주 ${me.perWeek}건입니다. 주 ${Math.ceil(avg - me.perWeek)}건 더 올리면 평균에 닿습니다.`
  if (me.perWeek > avg + 0.5) return `우리는 주 ${me.perWeek}건으로 경쟁사 평균(주 ${avg}건)보다 자주 올립니다. 빈도보다 반응 좋은 주제에 집중하세요.`
  return `우리 게시 빈도(주 ${me.perWeek}건)는 경쟁사 평균(주 ${avg}건)과 비슷합니다.`
}

/** 메타 광고 라이브러리 (한국 · 지금 집행 중 · 이름 검색) — 일반 광고는 API 로 못 받아 사람이 열어 봄 */
export const adLibraryUrl = (name: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&q=${encodeURIComponent(name)}&search_type=keyword_unordered`

/** 입력 정리: 블로그 주소 · 유튜브 주소 · 인스타 주소를 붙여도 아이디만 남김 */
export function cleanNaverBlogId(v: string): string | null {
  const s = v.trim().replace(/^https?:\/\/(m\.)?blog\.naver\.com\//, '').replace(/[/?#].*$/, '')
  return /^[A-Za-z0-9_-]{2,40}$/.test(s) ? s : null
}
export function cleanYoutubeHandle(v: string): string | null {
  const s = v.trim().replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//, '').replace(/[/?#].*$/, '')
  const h = s.startsWith('@') ? s : `@${s}`
  return /^@[A-Za-z0-9._-]{2,60}$/.test(h) ? h : null
}
export function cleanInstagramHandle(v: string): string | null {
  const s = v.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/^@/, '').replace(/[/?#].*$/, '')
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : null
}
