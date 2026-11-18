// 정부지원사업 (2026-11-19 대표 지시 '인트라넷에 만들어' · 관리자 전용)
// 공고는 서버가 매일 공공데이터(K-Startup)에서 받아 오고, 회사(더위클리 · 아트리어)마다 따로 판정한다.
// 판정은 참고용 — 신청 자격은 반드시 공고 원문으로 확인한다.

export const GOV_FITS = ['높음', '보통', '낮음', '제외'] as const
export type GovFit = (typeof GOV_FITS)[number]
export const GOV_STATUSES = ['신규', '검토 중', '신청 준비', '제출', '선정', '탈락', '보류', '마감'] as const
export type GovStatus = (typeof GOV_STATUSES)[number]
/** 손을 대고 있는 단계 (마감일을 챙겨야 하는 것) */
export const GOV_ACTIVE: GovStatus[] = ['검토 중', '신청 준비', '제출']

export type GovFitOf = { fit: GovFit; score: number; note: string | null }

export type GovProgram = {
  id: string
  source: string
  title: string
  org: string | null
  supervising: string | null
  category: string | null
  region: string | null
  target: string | null
  target_detail: string | null
  biz_years: string | null
  summary: string | null
  support_content: string | null
  exclude_detail: string | null
  apply_start: string | null
  apply_end: string | null
  detail_url: string | null
  apply_url: string | null
  contact: string | null
  fit: GovFit
  fit_score: number
  fit_company: string | null
  fits: Record<string, GovFitOf>
  status: GovStatus
  owner_id: string | null
  decision_note: string | null
  first_seen_at: string
}

export type GovCompany = {
  key: string
  name: string
  short: string
  founded: string
  region: string
  industries: string
  certifications: string[]
  cert_notes: string
  include_keywords: string[]
  exclude_keywords: string[]
  sort: number
}

export interface GovApi {
  listGovPrograms(): Promise<GovProgram[]>
  listGovCompanies(): Promise<GovCompany[]>
  updateGovProgram(id: string, patch: Partial<Pick<GovProgram, 'status' | 'owner_id' | 'decision_note'>>): Promise<void>
  /** 관리자: 회사 기준(관심 · 제외 낱말)을 고치고 전체 다시 판정 — 다시 판정한 공고 수 */
  saveGovCompany(key: string, patch: Pick<GovCompany, 'include_keywords' | 'exclude_keywords'>): Promise<number>
  /** 관리자: 지금 공공데이터에서 다시 받기 — 받은 공고 수 */
  refreshGovPrograms(): Promise<number>
}

/** 마감까지 남은 날 (오늘 마감 = 0 · 지났으면 음수 · 마감일 없으면 null) */
export function daysLeft(end: string | null, today: string): number | null {
  if (!end) return null
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
}

export function ddayLabel(left: number | null): string {
  if (left == null) return '상시'
  if (left < 0) return '마감'
  return left === 0 ? '오늘 마감' : `D-${left}`
}

/** 고른 회사 기준의 판정 (전체면 두 회사 중 높은 쪽) */
export function fitFor(p: GovProgram, company: string | null): GovFitOf {
  const own = company ? p.fits?.[company] : null
  return own ?? { fit: p.fit, score: p.fit_score, note: null }
}

export type GovFilter = { company: string | null; fit: GovFit | 'all'; status: GovStatus | 'open' | 'all'; word: string }

const FIT_RANK: Record<GovFit, number> = { 높음: 0, 보통: 1, 낮음: 2, 제외: 3 }

/** 걸러서 정렬: 진행 중인 것 → 판정 높은 순 → 점수 → 마감 가까운 순 */
export function filterGovPrograms(list: GovProgram[], f: GovFilter): GovProgram[] {
  const word = f.word.trim().toLowerCase()
  return list
    .filter(p => {
      if (f.status === 'open' ? p.status === '마감' || p.status === '탈락' || p.status === '보류' : f.status !== 'all' && p.status !== f.status) return false
      if (f.fit !== 'all' && fitFor(p, f.company).fit !== f.fit) return false
      if (word && !`${p.title} ${p.org ?? ''} ${p.category ?? ''} ${p.summary ?? ''}`.toLowerCase().includes(word)) return false
      return true
    })
    .sort((a, b) => {
      const act = Number(GOV_ACTIVE.includes(b.status)) - Number(GOV_ACTIVE.includes(a.status))
      if (act) return act
      const fa = fitFor(a, f.company)
      const fb = fitFor(b, f.company)
      return FIT_RANK[fa.fit] - FIT_RANK[fb.fit] || fb.score - fa.score || (a.apply_end ?? '9999').localeCompare(b.apply_end ?? '9999')
    })
}

/** 위쪽 숫자 카드 */
export function govCounts(list: GovProgram[], company: string | null, today: string) {
  const open = list.filter(p => p.status !== '마감')
  const soon = (p: GovProgram) => { const d = daysLeft(p.apply_end, today); return d != null && d >= 0 && d <= 7 }
  return {
    recommended: open.filter(p => p.status === '신규' && fitFor(p, company).fit === '높음').length,
    active: open.filter(p => GOV_ACTIVE.includes(p.status)).length,
    closingSoon: open.filter(p => soon(p) && (GOV_ACTIVE.includes(p.status) || (p.status === '신규' && fitFor(p, company).fit === '높음'))).length,
    won: list.filter(p => p.status === '선정').length,
  }
}

/** 쉼표 · 줄바꿈으로 적은 낱말 → 배열 (빈 것 · 겹친 것 뺌) */
export function parseKeywords(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map(s => s.trim()).filter(Boolean))]
}
