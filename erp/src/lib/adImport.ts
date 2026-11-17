import type { AdPlatform } from './types'

/**
 * 광고 수치 파일 읽기 (2026-11-17 대표 지시 '비용이 들지 않게' · 유료 연동 없이 수치 이어가기)
 * 메타 광고 관리자 · 구글 광고 · 네이버 검색광고에서 '일별 · 캠페인별'로 내려받은 표(엑셀 · CSV)의
 * 머리 줄을 알아보고 날짜 · 캠페인 · 노출 · 클릭 · 비용 · 전환을 뽑는다. 같은 날 · 같은 캠페인 줄은 더한다.
 */
export interface AdImportRow { date: string; platform: AdPlatform; campaign: string; impressions: number; clicks: number; cost: number; conversions: number | null }
export interface AdImportResult { platform: AdPlatform | null; rows: AdImportRow[]; skipped: number; reason?: string }
type Cell = string | number | null | undefined

const norm = (v: Cell) => String(v ?? '').replace(/\s+/g, '').toLowerCase()
const EXACT = {
  date: ['일', '날짜', '일별', '일자', 'day', 'date', '보고시작', 'reportingstarts'],
  campaign: ['캠페인이름', '캠페인명', '캠페인', 'campaignname', 'campaign'],
  impressions: ['노출', '노출수', 'impressions', 'impr.'],
  clicks: ['링크클릭', '클릭수', '클릭', '클릭(전체)', 'linkclicks', 'clicks', 'clicks(all)'],
  cost: ['비용', 'cost'],
  conversions: ['전환수', '전환', '결과', 'conversions', 'results'],
}
const COST_PREFIX = ['지출금액', '총비용', 'amountspent']
const TOTAL_RE = /^(합계|총계|전체|total|총합계)/i

function findCol(head: string[], names: string[], prefixes: string[] = []): number {
  for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i }
  for (const p of prefixes) { const i = head.findIndex(h => h.startsWith(p)); if (i >= 0) return i }
  return -1
}

export function parseAdDate(v: Cell): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const pad = (n: string | number) => String(n).padStart(2, '0')
  const ok = (y: number, m: number, d: number) => (y >= 2020 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null)
  let m = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/)
  if (m) return ok(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) return ok(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2])
  if (/[a-z]{3}/i.test(s)) {
    const t = Date.parse(s + ' UTC')
    if (!Number.isNaN(t)) { const d = new Date(t); return ok(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) }
  }
  return null
}

export function parseAdNumber(v: Cell): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v ?? '').replace(/[₩,원\s%]|krw/gi, ''))
  return Number.isFinite(n) ? n : 0
}

function detectPlatform(head: string[]): AdPlatform | null {
  if (head.some(h => h.startsWith('지출금액') || h.startsWith('amountspent') || h === '보고시작' || h === 'reportingstarts' || h === '캠페인이름')) return 'Meta'
  if (head.some(h => h.startsWith('총비용') || h === '일별')) return 'Naver'
  if (head.some(h => h === '노출수' || h === 'impr.') && head.some(h => h === '비용' || h === 'cost')) return 'Google'
  return null
}

/** 표 한 장(행 배열)에서 광고 수치를 읽음. platform 을 주면 그 매체로, 없으면 머리 줄로 알아봄 */
export function parseAdSheet(grid: Cell[][], platform?: AdPlatform | null): AdImportResult {
  let headAt = -1
  let cols = { date: -1, campaign: -1, impressions: -1, clicks: -1, cost: -1, conversions: -1 }
  let head: string[] = []
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const h = (grid[i] ?? []).map(norm)
    const c = {
      date: findCol(h, EXACT.date), campaign: findCol(h, EXACT.campaign), impressions: findCol(h, EXACT.impressions),
      clicks: findCol(h, EXACT.clicks), cost: findCol(h, EXACT.cost, COST_PREFIX), conversions: findCol(h, EXACT.conversions),
    }
    if (c.date >= 0 && c.campaign >= 0 && (c.cost >= 0 || c.clicks >= 0 || c.impressions >= 0)) { headAt = i; cols = c; head = h; break }
  }
  if (headAt < 0) return { platform: platform ?? null, rows: [], skipped: 0, reason: "머리 줄에서 '날짜(일)'와 '캠페인' 칸을 찾지 못했습니다. 매체 화면에서 일별 · 캠페인별 표로 내려받아 주세요." }
  const p = platform ?? detectPlatform(head)
  if (!p) return { platform: null, rows: [], skipped: 0, reason: '어느 매체 파일인지 알 수 없습니다. 매체를 직접 골라 주세요.' }
  const merged = new Map<string, AdImportRow>()
  let skipped = 0
  for (const r of grid.slice(headAt + 1)) {
    if (!r || r.every(c => c == null || String(c).trim() === '')) continue
    const date = parseAdDate(r[cols.date])
    const campaign = String(r[cols.campaign] ?? '').trim().slice(0, 200)
    if (!date || !campaign || TOTAL_RE.test(campaign)) { skipped++; continue }
    const num = (i: number) => (i >= 0 ? parseAdNumber(r[i]) : 0)
    const key = `${date}|${campaign}`
    const prev = merged.get(key)
    const conv = cols.conversions >= 0 && String(r[cols.conversions] ?? '').trim() !== '' ? parseAdNumber(r[cols.conversions]) : null
    if (prev) {
      prev.impressions += num(cols.impressions); prev.clicks += num(cols.clicks); prev.cost += num(cols.cost)
      if (conv != null) prev.conversions = (prev.conversions ?? 0) + conv
    } else merged.set(key, { date, platform: p, campaign, impressions: num(cols.impressions), clicks: num(cols.clicks), cost: num(cols.cost), conversions: conv })
  }
  const rows = [...merged.values()].map(x => ({ ...x, impressions: Math.round(x.impressions), clicks: Math.round(x.clicks), cost: Math.round(x.cost) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.campaign.localeCompare(b.campaign)))
  return { platform: p, rows, skipped, reason: rows.length ? undefined : '읽을 수 있는 수치 줄이 없습니다.' }
}

/** 여러 장 가운데 수치가 가장 많이 읽힌 장을 고름 */
export function parseAdSheets(grids: Cell[][][], platform?: AdPlatform | null): AdImportResult {
  let best: AdImportResult | null = null
  for (const g of grids) {
    const r = parseAdSheet(g, platform)
    if (!best || r.rows.length > best.rows.length) best = r
  }
  return best ?? { platform: platform ?? null, rows: [], skipped: 0, reason: '빈 파일입니다.' }
}
