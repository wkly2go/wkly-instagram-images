// 정부지원사업 (2026-11-19 대표 지시 '인트라넷에 만들어' · 관리자 전용)
// 공고는 서버가 매일 공공데이터(K-Startup)에서 받아 오고, 회사(더위클리 · 아트리어)마다 따로 판정한다.
// 판정은 참고용 — 신청 자격은 반드시 공고 원문으로 확인한다.

export const GOV_FITS = ['높음', '보통', '낮음', '제외'] as const
export type GovFit = (typeof GOV_FITS)[number]
export const GOV_STATUSES = ['신규', '검토 중', '신청 준비', '제출', '선정', '탈락', '보류', '마감'] as const
export type GovStatus = (typeof GOV_STATUSES)[number]
/** 손을 대고 있는 단계 (마감일을 챙겨야 하는 것) */
export const GOV_ACTIVE: GovStatus[] = ['검토 중', '신청 준비', '제출']

export type GovTrack = '지원' | '투자'

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
  /** 지원 = 지원사업 · 투자 = 투자유치 관련 공고 */
  track: GovTrack
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

/** 자료 · 계획 문서 (마크다운 · 관리자 전용) */
export type GovDoc = { key: string; title: string; body: string; sort: number; updated_at: string }
/** 투자유치 전문 AI 의 문서 수정 제안 (대표가 반영 · 거절) */
export type GovSuggestion = { id: string; doc_key: string; title: string; before_text: string; after_text: string; reason: string; sources: string[]; status: '대기' | '반영' | '거절' | '적용 불가'; created_at: string; decided_at: string | null }
/** 문서의 이전 글 (고칠 때마다 자동 보관) */
export type GovDocVersion = { id: string; doc_key: string; note: string; saved_at: string; chars: number }
/** 현황 — DB 가 늘 계산 (AI 없음) */
export type GovOverview = {
  today: string
  by_status: Record<string, number>
  recommended: number
  new_7d: number
  deadlines: { id: string; title: string; org: string | null; apply_end: string; d: number; fit: string; status: string; track: string | null }[]
  results: { title: string; status: string; updated_at: string }[]
  pending: Record<string, number>
  agent_id: string | null
  agent_last: { at: string; status: string; instruction: string; response: string } | null
}
/** 사업계획서 초안 — 입력값과 AI 가 쓴 네 항목 */
export type GovPlanDraft = { id: string; program_id: string | null; company: string; title: string; inputs: Record<string, string>; sections: Record<string, string>; updated_at: string }

export interface GovApi {
  listGovDocs(): Promise<GovDoc[]>
  saveGovDoc(key: string, body: string): Promise<void>
  govOverview(): Promise<GovOverview | null>
  /** 대기 제안 전부 + 최근 처리한 것 */
  listGovSuggestions(): Promise<GovSuggestion[]>
  /** 반영(true) · 거절(false) — 결과 '반영' | '거절' | '적용 불가' */
  decideGovSuggestion(id: string, accept: boolean): Promise<string>
  listGovDocVersions(key: string): Promise<GovDocVersion[]>
  restoreGovDoc(versionId: string): Promise<void>
  /** 투자유치 전문 AI 에게 점검 맡기기 */
  askGovAgent(text: string): Promise<void>
  /** 그 공고의 가장 최근 초안 (없으면 null) */
  getGovPlanDraft(programId: string): Promise<GovPlanDraft | null>
  /** id 가 없으면 새로 — 저장한 초안의 id */
  saveGovPlanDraft(draft: Omit<GovPlanDraft, 'id' | 'updated_at'> & { id?: string }): Promise<string>
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

export type GovFilter = { company: string | null; track: GovTrack | 'all'; fit: GovFit | 'all'; status: GovStatus | 'open' | 'all'; word: string }

const FIT_RANK: Record<GovFit, number> = { 높음: 0, 보통: 1, 낮음: 2, 제외: 3 }

/** 걸러서 정렬: 진행 중인 것 → 판정 높은 순 → 점수 → 마감 가까운 순 */
export function filterGovPrograms(list: GovProgram[], f: GovFilter): GovProgram[] {
  const word = f.word.trim().toLowerCase()
  return list
    .filter(p => {
      if (f.status === 'open' ? p.status === '마감' || p.status === '탈락' || p.status === '보류' : f.status !== 'all' && p.status !== f.status) return false
      if (f.track !== 'all' && (p.track ?? '지원') !== f.track) return false
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
