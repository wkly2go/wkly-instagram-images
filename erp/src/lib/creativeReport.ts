// 소재별 성과 (2026-11-27 마케팅 자동화) — 문의에 붙은 꼬리표를 콘텐츠 · 광고 캠페인과 이어 '어떤 소재가 문의 · 프로젝트가 되었나'를 만든다.
//  자료는 DB 함수 marketing_creative_report() (건수 · 이어진 프로젝트의 상태 · 매출 계약 금액 · 견적 여부 · 문의한 사람 정보 없음). 여기는 순수 계산 · AI 없음.
//  견적 · 수주 금액(2026-11-27 '소재별 수주 금액')은 프로젝트 번호로 묶어 같은 프로젝트를 두 번 세지 않는다.
//  잇는 규칙: 콘텐츠는 저장할 때 붙는 꼬리표 이름(campaignSlug(제목)), 광고는 캠페인 번호(추적 링크) 또는 캠페인 제목에서 만든 이름(메타 광고 주소).
import { campaignSlug } from './utmLinks.ts'

export interface TagRow { campaign: string; source: string; inquiries: number; direct: number; projects: number; won: number; last_at: string; project_ids?: string[] }
/** 문의와 이어진 프로젝트 (amount = 프로젝트 화면의 매출 계약 금액 · 비어 있으면 null · quoted = 인트라넷 견적이 있음) */
export interface LinkedProject { id: string; status: string; amount: number | null; quoted: boolean }
export interface CreativeSource {
  days: number
  tags: TagRow[]
  untagged: { inquiries: number; direct: number; projects: number; won: number; project_ids?: string[] }
  /** 예전 DB 함수(2026-11-27 213000)는 주지 않음 → 없으면 견적 · 수주 금액 칸이 0 */
  projects?: LinkedProject[]
  contents: { id: string; title: string; status: string; updated_at: string; channels: { channel: string; status: string; url: string }[] }[]
  campaigns: { id: string; title: string; platform: string; status: string }[]
}
export type CreativeKind = '콘텐츠' | '광고' | '꼬리표'
export interface CreativeRow {
  key: string; kind: CreativeKind; title: string; link: string | null
  /** 게시한 채널 (콘텐츠) · 매체 (광고) */
  placed: string[]
  sources: { source: string; inquiries: number }[]
  inquiries: number; direct: number; projects: number; won: number
  /** 프로젝트 번호로 묶은 값: 이어진 프로젝트 · 견적이 있는 곳 · 수주(진행 · 완료) · 수주 금액 합계 · 금액을 적은 수주 */
  money: Money
}
export interface Money { projects: number; quoted: number; wonProjects: number; wonAmount: number; wonPriced: number }
export interface CreativeReport {
  rows: CreativeRow[]
  /** 꼬리표가 붙은 문의 합계와 그중 소재와 이어진 건수 */
  tagged: number; matched: number
  untagged: CreativeSource['untagged']
  /** 꼬리표 없는 문의의 프로젝트 · 수주 금액 */
  untaggedMoney: Money
  /** 표에 나온 소재 전체의 수주 금액 (같은 프로젝트는 한 번) */
  taggedMoney: Money
  days: number
}

export const WON_STATUSES = ['진행', '완료']

/** 프로젝트 번호 묶음 → 견적 · 수주 · 금액 (같은 번호는 한 번만 · 목록에 없는 번호는 프로젝트 수에만) */
export function moneyFor(ids: Iterable<string>, projects: LinkedProject[] | undefined): Money {
  const byId = new Map((projects ?? []).map(p => [p.id, p]))
  const m: Money = { projects: 0, quoted: 0, wonProjects: 0, wonAmount: 0, wonPriced: 0 }
  for (const id of new Set(ids)) {
    m.projects++
    const p = byId.get(id)
    if (!p) continue
    if (p.quoted) m.quoted++
    if (WON_STATUSES.includes(p.status)) {
      m.wonProjects++
      const amount = Number(p.amount)
      if (p.amount != null && Number.isFinite(amount) && amount > 0) { m.wonAmount += amount; m.wonPriced++ }
    }
  }
  return m
}

const SOURCE_LABELS: Record<string, string> = {
  naver_blog: '네이버 블로그', instagram: '인스타그램', ig: '인스타그램', youtube: '유튜브', meta: '메타 광고', facebook: '페이스북',
  website: '홈페이지', naver: '네이버', google: '구글', kakao: '카카오', newsletter: '뉴스레터', email: '메일',
}
export const sourceLabel = (s: string) => (s ? SOURCE_LABELS[s.toLowerCase()] ?? s : '출처 표시 없음')
const PLATFORM_LABELS: Record<string, string> = { meta: '메타', google: '구글', naver: '네이버' }

/** 꼬리표 값은 사이트가 주소에서 읽은 그대로라 %EC… 꼴일 수 있다 → 한 번 풀어서 견준다 */
export function tagName(raw: string): string {
  try { return decodeURIComponent(raw).trim() } catch { return raw.trim() }
}

const NO_MONEY: Money = { projects: 0, quoted: 0, wonProjects: 0, wonAmount: 0, wonPriced: 0 }

export function creativeReport(src: CreativeSource): CreativeReport {
  const byKey = new Map<string, CreativeRow>()
  const ids = new Map<string, Set<string>>() // 소재 key → 이어진 프로젝트 번호
  const lookup = new Map<string, string>() // 꼬리표 이름 → 소재 key (먼저 넣은 것이 이김 = 최근 것)
  for (const c of src.contents) {
    const key = `c:${c.id}`
    const placed = c.channels.filter(v => v.status === '발행' || v.url).map(v => v.channel)
    byKey.set(key, { key, kind: '콘텐츠', title: c.title, link: `/ads?tab=content&item=${c.id}`, placed, sources: [], inquiries: 0, direct: 0, projects: 0, won: 0, money: NO_MONEY })
    const slug = campaignSlug(c.title)
    if (!lookup.has(slug)) lookup.set(slug, key)
  }
  for (const m of src.campaigns) {
    const key = `m:${m.id}`
    byKey.set(key, { key, kind: '광고', title: m.title || '(이름 없는 캠페인)', link: '/ads?tab=studio', placed: m.platform ? [PLATFORM_LABELS[m.platform] ?? m.platform] : [], sources: [], inquiries: 0, direct: 0, projects: 0, won: 0, money: NO_MONEY })
    if (!lookup.has(m.id)) lookup.set(m.id, key)
    const slug = campaignSlug(m.title, 'ad')
    if (!lookup.has(slug)) lookup.set(slug, key)
  }
  let tagged = 0, matched = 0
  for (const t of src.tags) {
    const name = tagName(t.campaign)
    tagged += t.inquiries
    let key = lookup.get(name)
    if (key) matched += t.inquiries
    else {
      key = `t:${name}`
      if (!byKey.has(key)) byKey.set(key, { key, kind: '꼬리표', title: name, link: null, placed: [], sources: [], inquiries: 0, direct: 0, projects: 0, won: 0, money: NO_MONEY })
    }
    const row = byKey.get(key)!
    row.inquiries += t.inquiries; row.direct += t.direct; row.projects += t.projects; row.won += t.won
    const set = ids.get(key) ?? new Set<string>()
    for (const id of t.project_ids ?? []) set.add(id)
    ids.set(key, set)
    const label = sourceLabel(t.source)
    const s = row.sources.find(x => x.source === label)
    if (s) s.inquiries += t.inquiries; else row.sources.push({ source: label, inquiries: t.inquiries })
  }
  const all = [...byKey.values()]
  for (const r of all) { r.sources.sort((a, b) => b.inquiries - a.inquiries); r.money = moneyFor(ids.get(r.key) ?? [], src.projects) }
  // 문의가 있는 소재 전부 + 게시했지만 문의가 없는 소재 10개까지 (만들기만 하고 내보내지 않은 것은 빼 둠)
  const withInquiry = all.filter(r => r.inquiries > 0).sort((a, b) => b.inquiries - a.inquiries || b.projects - a.projects || a.title.localeCompare(b.title, 'ko'))
  const silent = all.filter(r => r.inquiries === 0 && r.kind === '콘텐츠' && r.placed.length > 0).slice(0, 10)
  const rows = [...withInquiry, ...silent]
  return {
    rows, tagged, matched, untagged: src.untagged, days: src.days,
    untaggedMoney: moneyFor(src.untagged.project_ids ?? [], src.projects),
    taggedMoney: moneyFor(rows.flatMap(r => [...(ids.get(r.key) ?? [])]), src.projects),
  }
}

/** 문의 → 프로젝트 전환율(%). 문의가 없으면 null */
export function convertRate(inquiries: number, projects: number): number | null {
  return inquiries > 0 ? Math.round((projects / inquiries) * 100) : null
}
