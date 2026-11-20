// 광고 자동 운영 규칙 (2026-11-20 대표 지시 '광고 계정을 전부 컨트롤하면서 캠페인을 운영 · 정확하게 고도화')
// AI 없이 계산식만 — 같은 숫자면 늘 같은 판단. 서버 함수(index.ts)와 시험(tests/ad-autopilot.test.ts)이 이 파일을 그대로 씀.
// 원칙: ① 한도(월 · 하루)를 넘는 증액은 절대 안 함 ② 한 번에 바꾸는 폭은 설정(기본 20%) 안 ③ 자료가 모자라면 판단하지 않음
//       ④ 한 캠페인에 하루 한 가지만 ⑤ 실행 여부는 모드 · 긴급 정지가 정함(canExecute)

export type AutopilotMode = 'off' | 'suggest' | 'approve' | 'auto'
export type ActionKind = 'pause' | 'scale_up' | 'scale_down'

export interface AutopilotSettings {
  mode: AutopilotMode
  /** 이번 달 광고비 한도 (원 · 0 이면 증액 안 함) */
  monthly_cap: number
  /** 켜진 캠페인 하루 예산 합계 한도 (원 · 0 이면 증액 안 함) */
  daily_cap: number
  /** 한 번에 바꾸는 예산 폭 (% · 5~50) */
  max_step_pct: number
  kill_switch: boolean
  /** 목표 문의당 비용 (원 · 없으면 클릭률 · 클릭당 비용으로 판단) */
  target_cpl: number | null
  /** 이 금액 이상 써야 판단 (원 · 7일 합계) */
  min_spend: number
}

export interface InsightDay { date: string; campaign_id: string; campaign_name: string; impressions: number; clicks: number; spend: number; leads: number }
export interface MetaCampaign { id: string; name: string; status: string; daily_budget: number | null }

export interface Metrics { spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; cpc: number | null; cpl: number | null; prev_spend: number; prev_leads: number
  /** 멈춤 효과를 견줄 기준 (캠페인 멈춤 = 계정 전체 · 소재 멈춤 = 그 캠페인) 7일 문의당 · 클릭당 비용 */
  base_cpl?: number | null; base_cpc?: number | null }
export interface Proposal { campaign_id: string; campaign_name: string; kind: ActionKind; from_budget: number | null; to_budget: number | null; reason: string; metrics: Metrics }

export const DEFAULT_SETTINGS: AutopilotSettings = { mode: 'suggest', monthly_cap: 0, daily_cap: 0, max_step_pct: 20, kill_switch: false, target_cpl: null, min_spend: 30000 }

const addDays = (key: string, n: number) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
/** 예산은 천 원 단위로 */
export const roundBudget = (n: number) => Math.max(1000, Math.round(n / 1000) * 1000)

interface Sum { spend: number; impressions: number; clicks: number; leads: number }
const zero = (): Sum => ({ spend: 0, impressions: 0, clicks: 0, leads: 0 })
function metricsOf(s: Sum, p: Sum): Metrics {
  return {
    spend: s.spend, impressions: s.impressions, clicks: s.clicks, leads: s.leads,
    ctr: s.impressions ? (s.clicks / s.impressions) * 100 : null,
    cpc: s.clicks ? s.spend / s.clicks : null,
    cpl: s.leads ? s.spend / s.leads : null,
    prev_spend: p.spend, prev_leads: p.leads,
  }
}

/** 이번 달 남은 날 (오늘 포함) */
export function daysLeftInMonth(today: string): number {
  const d = new Date(`${today}T00:00:00Z`)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  return last - d.getUTCDate() + 1
}

/**
 * 판단: 어제까지 7일(cur)과 그 앞 7일(prev)을 캠페인별로 합쳐 제안 목록을 만든다.
 * today = 한국 날짜 'YYYY-MM-DD' · mtdSpend = 이번 달 쓴 광고비(원)
 */
export function judge(today: string, campaigns: MetaCampaign[], days: InsightDay[], s: AutopilotSettings, mtdSpend: number): Proposal[] {
  const curFrom = addDays(today, -7), curTo = addDays(today, -1)
  const prevFrom = addDays(today, -14), prevTo = addDays(today, -8)
  const active = campaigns.filter(c => c.status === 'ACTIVE')
  const cur = new Map<string, Sum>(), prev = new Map<string, Sum>(), acct = zero()
  for (const d of days) {
    const bucket = d.date >= curFrom && d.date <= curTo ? cur : d.date >= prevFrom && d.date <= prevTo ? prev : null
    if (!bucket) continue
    const x = bucket.get(d.campaign_id) ?? zero()
    x.spend += d.spend; x.impressions += d.impressions; x.clicks += d.clicks; x.leads += d.leads
    bucket.set(d.campaign_id, x)
    if (bucket === cur) { acct.spend += d.spend; acct.impressions += d.impressions; acct.clicks += d.clicks; acct.leads += d.leads }
  }
  const out: Proposal[] = []
  // 월 한도에 닿으면 켜진 캠페인을 모두 멈춤 제안 (다른 판단 없음)
  if (s.monthly_cap > 0 && mtdSpend >= s.monthly_cap) {
    for (const c of active) out.push({ campaign_id: c.id, campaign_name: c.name, kind: 'pause', from_budget: c.daily_budget, to_budget: null, reason: `이번 달 광고비 ${won(mtdSpend)}이 월 한도 ${won(s.monthly_cap)}에 닿았습니다.`, metrics: metricsOf(cur.get(c.id) ?? zero(), prev.get(c.id) ?? zero()) })
    return out
  }
  const aCtr = acct.impressions ? (acct.clicks / acct.impressions) * 100 : null
  const aCpc = acct.clicks ? acct.spend / acct.clicks : null
  const step = Math.min(50, Math.max(5, s.max_step_pct || 20)) / 100
  const t = s.target_cpl && s.target_cpl > 0 ? s.target_cpl : null
  // 하루 예산 합계 (증액 한도 계산용 · 앞에서 바꾼 것을 반영해 나감)
  let dailySum = active.reduce((a, c) => a + (c.daily_budget ?? 0), 0)
  const daysLeft = daysLeftInMonth(today)
  const scaleUps: { c: MetaCampaign; m: Metrics; why: string; score: number }[] = []

  for (const c of active) {
    const m = metricsOf(cur.get(c.id) ?? zero(), prev.get(c.id) ?? zero())
    // 자료 부족: 7일 동안 노출 1,000 미만이고 기준 금액도 안 씀 → 판단하지 않음 (학습 중 캠페인 보호)
    if (m.impressions < 1000 && m.spend < s.min_spend) continue
    let pause: string | null = null
    if (m.spend >= s.min_spend && m.clicks === 0) pause = `7일 동안 ${won(m.spend)}을 썼는데 클릭이 없습니다.`
    else if (t && m.leads === 0 && m.spend >= t * 2) pause = `7일 동안 ${won(m.spend)} (목표 문의당 비용의 2배 이상)을 썼는데 문의가 없습니다.`
    else if (t && m.cpl != null && m.cpl > t * 2) pause = `문의당 비용 ${won(m.cpl)}이 목표 ${won(t)}의 2배를 넘습니다.`
    else if (!t && m.spend >= s.min_spend && m.cpc != null && aCpc != null && m.ctr != null && aCtr != null && m.cpc > aCpc * 1.5 && m.ctr < aCtr)
      pause = `클릭당 비용 ${won(m.cpc)}이 계정 평균 ${won(aCpc)}의 1.5배를 넘고 클릭률 ${m.ctr.toFixed(2)}%도 평균 ${aCtr.toFixed(2)}%보다 낮습니다.`
    if (pause) {
      out.push({ campaign_id: c.id, campaign_name: c.name, kind: 'pause', from_budget: c.daily_budget, to_budget: null, reason: pause, metrics: { ...m, base_cpl: acct.leads ? acct.spend / acct.leads : null, base_cpc: aCpc } })
      dailySum -= c.daily_budget ?? 0
      continue
    }
    if (c.daily_budget == null || c.daily_budget <= 0) continue // 예산이 광고 세트 쪽에 있는 캠페인은 예산을 바꾸지 않음
    if (t && m.cpl != null && m.cpl > t * 1.3) {
      const to = roundBudget(c.daily_budget * (1 - step))
      if (to < c.daily_budget) {
        out.push({ campaign_id: c.id, campaign_name: c.name, kind: 'scale_down', from_budget: c.daily_budget, to_budget: to, reason: `문의당 비용 ${won(m.cpl)}이 목표 ${won(t)}보다 30% 이상 높아 하루 예산을 ${Math.round(step * 100)}% 줄입니다.`, metrics: m })
        dailySum -= c.daily_budget - to
      }
      continue
    }
    if (t && m.leads >= 3 && m.cpl != null && m.cpl <= t * 0.8)
      scaleUps.push({ c, m, why: `문의 ${m.leads}건 · 문의당 비용 ${won(m.cpl)}이 목표 ${won(t)}보다 20% 이상 낮습니다.`, score: t / m.cpl })
    else if (!t && m.clicks >= 30 && m.ctr != null && aCtr != null && m.cpc != null && aCpc != null && m.ctr >= aCtr * 1.2 && m.cpc <= aCpc)
      scaleUps.push({ c, m, why: `클릭률 ${m.ctr.toFixed(2)}%가 계정 평균보다 20% 이상 높고 클릭당 비용 ${won(m.cpc)}은 평균 이하입니다.`, score: m.ctr / aCtr })
  }

  // 증액: 한도가 둘 다 정해져 있을 때만 · 성과 좋은 순서로 · 하루 합계와 이번 달 남은 예상이 한도 안일 때만
  if (s.daily_cap > 0 && s.monthly_cap > 0) {
    for (const u of scaleUps.sort((a, b) => b.score - a.score)) {
      const from = u.c.daily_budget!
      const to = roundBudget(from * (1 + step))
      const nextSum = dailySum - from + to
      if (to <= from || nextSum > s.daily_cap) continue
      if (mtdSpend + nextSum * daysLeft > s.monthly_cap) continue
      out.push({ campaign_id: u.c.id, campaign_name: u.c.name, kind: 'scale_up', from_budget: from, to_budget: to, reason: `${u.why} 하루 예산을 ${Math.round(step * 100)}% 늘립니다 (하루 합계 ${won(nextSum)} · 한도 ${won(s.daily_cap)}).`, metrics: u.m })
      dailySum = nextSum
    }
  }
  const order: ActionKind[] = ['pause', 'scale_down', 'scale_up']
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}

/** 실행해도 되나: 긴급 정지 · 모드 · (승인 모드면) 대표 승인 */
export function canExecute(s: Pick<AutopilotSettings, 'mode' | 'kill_switch'>, approved: boolean): boolean {
  if (s.kill_switch) return false
  if (s.mode === 'auto') return true
  if (s.mode === 'approve') return approved
  return false
}

/** 메타 인사이트 actions 에서 문의(리드) 수: 'lead' 가 있으면 그것(합계), 없으면 세부 리드 종류의 합 */
export function leadsOf(actions: { action_type?: string; value?: string | number }[] | undefined): number {
  if (!Array.isArray(actions)) return 0
  const v = (t: string) => actions.filter(a => a.action_type === t).reduce((s, a) => s + (Number(a.value) || 0), 0)
  const total = v('lead')
  if (total > 0) return total
  return v('onsite_conversion.lead_grouped') + v('offsite_conversion.fb_pixel_lead') + v('onsite_web_lead')
}

/** 광고 계정 번호 정리: 'act_123' · '123' → '123' (숫자만 아니면 null) */
export function cleanAccountId(raw: string): string | null {
  const s = raw.trim().replace(/^act_/, '')
  return /^\d{5,20}$/.test(s) ? s : null
}

export const KIND_LABEL: Record<ActionKind, string> = { pause: '멈춤', scale_up: '예산 늘림', scale_down: '예산 줄임' }

// ───────────────────────── 2단계 (2026-11-20 '개발 계속해') ─────────────────────────
// ① 소재 피로: 같은 사람에게 너무 자주 보여 클릭률이 떨어진 광고(소재)를 멈춤 — 캠페인에 켜진 소재가 2개 이상일 때만, 캠페인마다 가장 나쁜 1개
// ② 효과 확인: 실행 7일 뒤 '전 7일 vs 뒤 7일'을 견줘 좋아짐 · 나빠짐 · 비슷 — 규칙 성적표의 재료

export interface MetaAd { id: string; name: string; campaign_id: string; status: string }
export interface AdDay { date: string; ad_id: string; impressions: number; clicks: number; spend: number; leads: number }
export interface AdProposal extends Proposal { ad_id: string; ad_name: string }

/** 소재 피로 기준: 두 주 모두 노출 3,000 이상 · 클릭률이 앞 주보다 30% 이상 떨어짐 · (빈도 3 이상 또는 클릭률 절반 이하) */
export const FATIGUE = { minImpressions: 3000, ctrDrop: 0.3, minFrequency: 3, hardDrop: 0.5 }

export function fatigue(today: string, campaigns: MetaCampaign[], ads: MetaAd[], days: AdDay[], frequency: Record<string, number>, skipCampaigns: Set<string>): AdProposal[] {
  const curFrom = addDays(today, -7), curTo = addDays(today, -1)
  const prevFrom = addDays(today, -14), prevTo = addDays(today, -8)
  const cur = new Map<string, Sum>(), prev = new Map<string, Sum>()
  for (const d of days) {
    const bucket = d.date >= curFrom && d.date <= curTo ? cur : d.date >= prevFrom && d.date <= prevTo ? prev : null
    if (!bucket) continue
    const x = bucket.get(d.ad_id) ?? zero()
    x.spend += d.spend; x.impressions += d.impressions; x.clicks += d.clicks; x.leads += d.leads
    bucket.set(d.ad_id, x)
  }
  const activeCampaigns = new Map(campaigns.filter(c => c.status === 'ACTIVE').map(c => [c.id, c]))
  const out: AdProposal[] = []
  for (const [cid, camp] of activeCampaigns) {
    if (skipCampaigns.has(cid)) continue
    const live = ads.filter(a => a.campaign_id === cid && a.status === 'ACTIVE')
    if (live.length < 2) continue // 마지막 소재는 절대 멈추지 않음
    let worst: { a: MetaAd; m: Metrics; drop: number; freq: number | null } | null = null
    for (const a of live) {
      const c = cur.get(a.id), p = prev.get(a.id)
      if (!c || !p || c.impressions < FATIGUE.minImpressions || p.impressions < FATIGUE.minImpressions || !p.clicks) continue
      const cCtr = c.clicks / c.impressions, pCtr = p.clicks / p.impressions
      const drop = 1 - cCtr / pCtr
      const freq = frequency[a.id] ?? null
      if (drop < FATIGUE.ctrDrop) continue
      if (!(drop >= FATIGUE.hardDrop || (freq != null && freq >= FATIGUE.minFrequency))) continue
      if (!worst || drop > worst.drop) worst = { a, m: metricsOf(c, p), drop, freq }
    }
    if (!worst) continue
    const cs = zero()
    for (const a of live) { const c = cur.get(a.id); if (c) { cs.spend += c.spend; cs.clicks += c.clicks; cs.leads += c.leads } }
    worst.m = { ...worst.m, base_cpl: cs.leads ? cs.spend / cs.leads : null, base_cpc: cs.clicks ? cs.spend / cs.clicks : null }
    const pctDrop = Math.round(worst.drop * 100)
    out.push({
      campaign_id: cid, campaign_name: camp.name, kind: 'pause', from_budget: null, to_budget: null,
      ad_id: worst.a.id, ad_name: worst.a.name, metrics: worst.m,
      reason: `소재 피로: 클릭률이 앞 주보다 ${pctDrop}% 떨어졌습니다${worst.freq != null ? ` (한 사람에게 7일 평균 ${worst.freq.toFixed(1)}번 노출)` : ''}. 같은 캠페인의 다른 소재 ${live.length - 1}개는 그대로 돕니다. 새 소재는 '한 번에 만들기'로 채워 주세요.`,
    })
  }
  return out
}

export type Effect = '좋아짐' | '나빠짐' | '비슷'
export interface EffectResult { verdict: Effect; note: string; after: Metrics }

/**
 * 효과 확인: 실행한 날 다음 날부터 7일(after)이 모두 지난 뒤에만. before = 제안 때 저장한 7일 수치.
 * 멈춤 → 아낀 돈(앞 7일 비용) + 기준(캠페인 멈춤 = 나머지 계정 · 소재 멈춤 = 그 캠페인)의 비용이 10% 넘게 오르지 않았으면 좋아짐
 * 늘림 → 문의가 늘고 문의당 비용(없으면 클릭당 비용)이 15% 넘게 오르지 않았으면 좋아짐
 * 줄임 → 문의당 비용(없으면 클릭당 비용)이 내려갔으면 좋아짐
 */
export function evaluate(today: string, a: { kind: ActionKind; day: string; campaign_id: string; ad_id?: string | null; metrics: Partial<Metrics> }, campaignDays: InsightDay[]): EffectResult | null {
  const from = addDays(a.day, 1), to = addDays(a.day, 7)
  if (to > addDays(today, -1)) return null // 아직 7일이 안 지남
  const pick = a.kind === 'pause' && !a.ad_id ? campaignDays.filter(d => d.campaign_id !== a.campaign_id) : campaignDays.filter(d => d.campaign_id === a.campaign_id)
  const s = zero()
  for (const d of pick) if (d.date >= from && d.date <= to) { s.spend += d.spend; s.impressions += d.impressions; s.clicks += d.clicks; s.leads += d.leads }
  const after = metricsOf(s, zero())
  const b = a.metrics
  const cost = (m: Partial<Metrics>) => (m.cpl ?? null) != null ? { v: m.cpl as number, label: '문의당 비용' } : (m.cpc ?? null) != null ? { v: m.cpc as number, label: '클릭당 비용' } : null
  if (a.kind === 'pause') {
    // 멈춘 대상 자체는 뒤 7일이 0 — 기준(계정 전체 또는 그 캠페인)의 비용이 버텼는지 봄 · 아낀 돈은 앞 7일 비용
    const saved = b.spend ?? 0
    const base = b.base_cpl != null && after.cpl != null ? { v: b.base_cpl, a: after.cpl, label: '문의당 비용' } : b.base_cpc != null && after.cpc != null ? { v: b.base_cpc, a: after.cpc, label: '클릭당 비용' } : null
    const where = a.ad_id ? '캠페인' : '계정'
    if (!base) return { verdict: '비슷', note: `멈춘 뒤 7일 동안 약 ${won(saved)}을 아꼈습니다 · 견줄 ${where} 수치가 모자랍니다.`, after }
    const change = base.a / base.v - 1
    const verdict: Effect = change <= 0.1 ? '좋아짐' : change > 0.3 ? '나빠짐' : '비슷'
    return { verdict, note: `멈춘 뒤 7일 약 ${won(saved)} 아낌 · ${where} ${base.label} ${won(base.v)} → ${won(base.a)} (${change >= 0 ? '+' : ''}${Math.round(change * 100)}%).`, after }
  }
  const bc = cost(b), ac = cost(after)
  if (!bc || !ac || (b.cpl == null) !== (after.cpl == null)) {
    if (a.kind === 'scale_up' && (after.leads ?? 0) > (b.leads ?? 0)) return { verdict: '좋아짐', note: `문의 ${b.leads ?? 0} → ${after.leads}건.`, after }
    return { verdict: '비슷', note: '견줄 수치가 모자랍니다.', after }
  }
  const change = ac.v / bc.v - 1
  const pct = `${change >= 0 ? '+' : ''}${Math.round(change * 100)}%`
  if (a.kind === 'scale_up') {
    const more = (after.leads ?? 0) - (b.leads ?? 0)
    const verdict: Effect = more > 0 && change <= 0.15 ? '좋아짐' : change > 0.3 || more < 0 ? '나빠짐' : '비슷'
    return { verdict, note: `문의 ${b.leads ?? 0} → ${after.leads}건 · ${ac.label} ${won(bc.v)} → ${won(ac.v)} (${pct}).`, after }
  }
  const verdict: Effect = change <= -0.1 ? '좋아짐' : change >= 0.1 ? '나빠짐' : '비슷'
  return { verdict, note: `${ac.label} ${won(bc.v)} → ${won(ac.v)} (${pct}) · 문의 ${b.leads ?? 0} → ${after.leads}건.`, after }
}
