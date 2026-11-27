// 분석 → 제작 잇기 (2026-11-27 대표 지시 '트렌드분석과 경쟁사 분석, 인기 광고 · 게시물을 분석해서 클릭 한 번에 소재를 제작')
//  최근 분석 자료(트렌드 · 콘텐츠 소재 · 팝업 정보 · 시장조사 · 경쟁사 인기 글)를 '한 번에 만들기'에 넘길 후보로 추린다. AI 없음 · 순수 함수.
//  넘기는 것은 참고 자료일 뿐 — 사실은 '확인된 사실' 칸에 사람이 적은 것만 쓰고, 남의 글을 베끼지 않는다.
import type { CompetitorPost } from './competitorDigest'

export interface PickSource { id: string; kind: string; title: string; summary: string | null; source_name: string | null; source_url: string | null; created_at: string }
export interface AnalysisPick { key: string; group: string; title: string; note: string; source: string; at: string }

const DAY = 86_400_000
const PICK_KINDS = ['콘텐츠 소재', '트렌드·밈', '팝업 정보', '시장조사', '경쟁사 분석']
const one = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** 최근 14일 자료에서 종류마다 고르게 · 최신 순으로 최대 limit 개. 경쟁사 글은 조회수 높은 순 3개 */
export function analysisPicks(research: PickSource[], posts: (CompetitorPost & { owner?: string })[], nowMs: number, limit = 12): AnalysisPick[] {
  const since = nowMs - 14 * DAY
  const fresh = research.filter(r => PICK_KINDS.includes(r.kind) && Date.parse(r.created_at) >= since)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const perKind = new Map<string, number>()
  const fromResearch: AnalysisPick[] = []
  for (const r of fresh) {
    const n = perKind.get(r.kind) ?? 0
    if (n >= 3) continue
    perKind.set(r.kind, n + 1)
    fromResearch.push({ key: `r:${r.id}`, group: r.kind, title: one(r.title, 120), note: one(r.summary, 300), source: one(r.source_name, 60) || one(r.source_url, 80), at: r.created_at })
  }
  const fromPosts: AnalysisPick[] = posts
    .filter(p => p.published_at && Date.parse(p.published_at) >= nowMs - 30 * DAY)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    .slice(0, 3)
    .map(p => ({ key: `p:${p.id}`, group: '경쟁사 인기 글', title: one(p.title, 120), note: one(p.summary, 300), source: [p.owner, p.source === 'youtube' ? '유튜브' : '네이버 블로그', p.views != null ? `조회 ${p.views.toLocaleString('ko-KR')}` : ''].filter(Boolean).join(' · '), at: p.published_at! }))
  return [...fromResearch, ...fromPosts].slice(0, limit)
}

/** 고른 자료를 요청문에 넣을 참고 글로 (700자까지) */
export function pickReference(p: AnalysisPick): string {
  return [`[${p.group}] ${p.title}`, p.note, p.source ? `출처: ${p.source}` : ''].filter(Boolean).join('\n').slice(0, 700)
}
