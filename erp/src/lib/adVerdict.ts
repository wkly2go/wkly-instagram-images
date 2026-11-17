import type { AdDaily, AdPlatform } from './types'

/**
 * 주간 판정표 (AI 없이 계산 · 2026-11-17 대표 지시 '비용이 들지 않게')
 * 수치가 있는 마지막 날까지의 7일과 그 앞 7일을 캠페인별로 견주고, 매체 평균과 비교해 제안만 한다.
 * 집행 · 예산 변경은 하지 않는다 (결재는 대표).
 */
export type AdVerdict = '증액 후보' | '유지' | '중단 후보' | '집행 없음'
export interface AdVerdictRow {
  platform: AdPlatform; campaign: string
  cost: number; clicks: number; impressions: number; conversions: number
  ctr: number | null; cpc: number | null; prevCost: number; prevClicks: number
  verdict: AdVerdict; why: string
}
export interface AdVerdictTable { from: string; to: string; prevFrom: string; prevTo: string; rows: AdVerdictRow[]; lastDate: string | null }

const addDays = (key: string, n: number) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
interface Sum { cost: number; clicks: number; impressions: number; conversions: number }
const zero = (): Sum => ({ cost: 0, clicks: 0, impressions: 0, conversions: 0 })
const add = (s: Sum, r: AdDaily) => { s.cost += r.cost ?? 0; s.clicks += r.clicks ?? 0; s.impressions += r.impressions ?? 0; s.conversions += Number(r.conversions ?? 0) }
const ctrOf = (s: Sum) => (s.impressions ? (s.clicks / s.impressions) * 100 : null)
const cpcOf = (s: Sum) => (s.clicks ? s.cost / s.clicks : null)

export function adVerdictTable(rows: AdDaily[]): AdVerdictTable {
  const lastDate = rows.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null)
  const to = lastDate ?? ''
  const from = to ? addDays(to, -6) : ''
  const prevTo = to ? addDays(to, -7) : ''
  const prevFrom = to ? addDays(to, -13) : ''
  if (!lastDate) return { from, to, prevFrom, prevTo, rows: [], lastDate }
  const cur = new Map<string, Sum>()
  const prev = new Map<string, Sum>()
  const byPlatform = new Map<AdPlatform, Sum>()
  for (const r of rows) {
    const key = `${r.platform}|${r.campaign}`
    if (r.date >= from && r.date <= to) {
      if (!cur.has(key)) cur.set(key, zero())
      add(cur.get(key)!, r)
      if (!byPlatform.has(r.platform)) byPlatform.set(r.platform, zero())
      add(byPlatform.get(r.platform)!, r)
    } else if (r.date >= prevFrom && r.date <= prevTo) {
      if (!prev.has(key)) prev.set(key, zero())
      add(prev.get(key)!, r)
    }
  }
  const out: AdVerdictRow[] = []
  for (const key of new Set([...cur.keys(), ...prev.keys()])) {
    const [platform, ...rest] = key.split('|')
    const s = cur.get(key) ?? zero()
    const p = prev.get(key) ?? zero()
    const avg = byPlatform.get(platform as AdPlatform) ?? zero()
    const ctr = ctrOf(s), cpc = cpcOf(s), aCtr = ctrOf(avg), aCpc = cpcOf(avg)
    let verdict: AdVerdict = '유지'
    let why = '매체 평균과 비슷합니다.'
    if (s.cost === 0 && s.impressions === 0) { verdict = '집행 없음'; why = '이번 7일에 집행 기록이 없습니다.' }
    else if (s.cost > 0 && s.clicks === 0) { verdict = '중단 후보'; why = '비용은 썼는데 클릭이 없습니다.' }
    else if (cpc != null && aCpc != null && ctr != null && aCtr != null && cpc > aCpc * 1.5 && ctr < aCtr) { verdict = '중단 후보'; why = '클릭당 비용이 매체 평균의 1.5배를 넘고 클릭률도 평균보다 낮습니다.' }
    else if (cpc != null && aCpc != null && ctr != null && aCtr != null && ctr >= aCtr * 1.2 && cpc <= aCpc) { verdict = '증액 후보'; why = '클릭률이 매체 평균보다 20% 이상 높고 클릭당 비용은 평균 이하입니다.' }
    out.push({ platform: platform as AdPlatform, campaign: rest.join('|'), cost: s.cost, clicks: s.clicks, impressions: s.impressions, conversions: s.conversions, ctr, cpc, prevCost: p.cost, prevClicks: p.clicks, verdict, why })
  }
  const order: AdVerdict[] = ['증액 후보', '중단 후보', '유지', '집행 없음']
  out.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || b.cost - a.cost)
  return { from, to, prevFrom, prevTo, rows: out, lastDate }
}
