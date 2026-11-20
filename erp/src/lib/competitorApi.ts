// 경쟁사 추적 API (2026-11-20 · DB 20261120230000_ad_competitors)
// 읽기는 팀원 모두(RLS) · 넣기 · 고치기 · 지우기 · 지금 받기는 관리자. 받기는 서버 함수 없이 DB 안(http_get)에서.
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { Competitor, CompetitorPost } from './competitorDigest'

export type CompetitorInput = Pick<Competitor, 'name' | 'brand' | 'is_self' | 'homepage' | 'naver_blog_id' | 'youtube_handle' | 'instagram_handle' | 'note' | 'active'>

export interface CompetitorApi {
  listCompetitors(): Promise<{ competitors: Competitor[]; posts: CompetitorPost[] }>
  saveCompetitor(id: string | null, v: CompetitorInput): Promise<string>
  deleteCompetitor(id: string): Promise<void>
  refreshCompetitor(id: string): Promise<{ blog: number; youtube: number; error: string | null }>
}

const COLS = 'id,name,brand,is_self,homepage,naver_blog_id,youtube_handle,instagram_handle,note,active,last_checked_at,last_error'

export function createSupabaseCompetitorApi(sb: SupabaseClient): CompetitorApi {
  const fail = (e: { message: string } | null) => { if (e) throw new ApiError(e.message) }
  return {
    async listCompetitors() {
      const since = new Date(Date.now() - 45 * 86_400_000).toISOString()
      const [c, p] = await Promise.all([
        sb.from('ad_competitors').select(COLS).order('is_self', { ascending: false }).order('name'),
        sb.from('ad_competitor_posts').select('id,competitor_id,source,title,url,summary,published_at,views,likes,comments').gte('published_at', since).order('published_at', { ascending: false }).limit(1500),
      ])
      fail(c.error); fail(p.error)
      return { competitors: (c.data ?? []) as Competitor[], posts: (p.data ?? []) as CompetitorPost[] }
    },
    async saveCompetitor(id, v) {
      const r = id ? await sb.from('ad_competitors').update(v).eq('id', id).select('id').single() : await sb.from('ad_competitors').insert(v).select('id').single()
      fail(r.error)
      return String(r.data?.id ?? id)
    },
    async deleteCompetitor(id) { const r = await sb.from('ad_competitors').delete().eq('id', id); fail(r.error) },
    async refreshCompetitor(id) {
      const r = await sb.rpc('ad_competitor_refresh', { p_id: id })
      fail(r.error)
      return r.data as { blog: number; youtube: number; error: string | null }
    },
  }
}

/** 체험 모드: 지어낸 경쟁사 자료는 두지 않음 */
export function createDemoCompetitorApi(): CompetitorApi {
  const none = async (): Promise<never> => { throw new ApiError('경쟁사 추적은 운영 계정에서만 쓸 수 있습니다.') }
  // 화면 확인용 시험 자료는 VITE_AUTOPILOT_HARNESS=1 개발 서버에서만 (배포 묶음에는 빈 목록)
  const harness = import.meta.env.DEV && import.meta.env.VITE_AUTOPILOT_HARNESS === '1'
  const sample = (): { competitors: Competitor[]; posts: CompetitorPost[] } => {
    const c = (id: string, name: string, is_self = false): Competitor => ({ id, name, brand: 'wkly', is_self, homepage: 'https://example.com', naver_blog_id: 'x', youtube_handle: '@x', instagram_handle: 'x', note: '', active: true, last_checked_at: new Date().toISOString(), last_error: null })
    const t = ['연말 팝업 운영 체크리스트', '성수 팝업 공간 대관 후기', '연말 브랜드 굿즈 제작', '팝업 동선 설계 노하우', '연말 행사 준비 일정표', '브랜드 굿즈 포장 아이디어']
    const posts: CompetitorPost[] = []
    let n = 0
    for (const [cid, k] of [['h1', 6], ['h2', 4], ['me', 2]] as const) for (let i = 0; i < k; i++) {
      n++
      posts.push({ id: String(n), competitor_id: cid, source: i % 2 ? 'youtube' : 'naver_blog', title: cid === 'me' ? '더위클리 매거진 인터뷰' : t[(i + n) % t.length], url: 'https://example.com', summary: '', published_at: new Date(Date.now() - (i * 4 + 1) * 86_400_000).toISOString(), views: i % 2 ? 1200 * (i + 1) : null, likes: null, comments: null })
    }
    return { competitors: [c('me', '[시험] 우리 회사', true), c('h1', '[시험] 팝업 에이전시 A'), c('h2', '[시험] 공간 스튜디오 B')], posts }
  }
  return { async listCompetitors() { return harness ? sample() : { competitors: [], posts: [] } }, saveCompetitor: none, deleteCompetitor: none, refreshCompetitor: none }
}
