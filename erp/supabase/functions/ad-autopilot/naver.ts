// 네이버 검색광고 API (2026-11-21 · 광고 자동 운영 4단계)
// 서명: X-Signature = base64(HMAC-SHA256(비밀키, `${timestamp}.${METHOD}.${경로}`)) · 머리말 X-Timestamp · X-API-KEY(엑세스라이선스) · X-Customer(고객 번호)
// 읽기: 캠페인 목록 /ncc/campaigns · 일별 수치 /stats (노출 impCnt · 클릭 clkCnt · 비용 salesAmt · 전환 ccnt = 문의로 셈)
// 쓰기: 캠페인 멈춤 PUT /ncc/campaigns/{id}?fields=userLock · 하루 예산 PUT ...?fields=budget — 이 둘뿐
// 순수 함수(서명 · 변환)는 시험 tests/ad-autopilot.test.ts 가 확인. 실제 계정으로는 아직 시험 못 함(열쇠 입력 전).
import type { InsightDay, MetaCampaign } from './rules.ts'

export const NAVER_BASE = 'https://api.searchad.naver.com'

export async function naverSignature(timestamp: string, method: string, uri: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${method.toUpperCase()}.${uri}`))
  let bin = ''
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b)
  return btoa(bin)
}

export interface NaverCampaignRaw { nccCampaignId: string; name: string; userLock?: boolean; status?: string; dailyBudget?: number; useDailyBudget?: boolean; campaignTp?: string }
export interface NaverStatRow { id?: string; dateStart?: string; date?: string; impCnt?: number | string; clkCnt?: number | string; salesAmt?: number | string; ccnt?: number | string }

/** 네이버 캠페인 → 규칙이 읽는 꼴 (사용자가 끈 것 · 삭제 · 일시 중지는 ACTIVE 가 아님 · 예산 미사용이면 하루 예산 없음) */
export function naverCampaign(c: NaverCampaignRaw): MetaCampaign {
  const off = c.userLock === true || /DELETED|PAUSED|STOPPED|LOCKED/i.test(c.status ?? '')
  return { id: c.nccCampaignId, name: c.name, status: off ? 'PAUSED' : 'ACTIVE', daily_budget: c.useDailyBudget && c.dailyBudget ? Math.round(c.dailyBudget) : null }
}

/** /stats 일별 줄 → 규칙이 읽는 일별 수치 (날짜 칸 이름이 dateStart · date 어느 쪽이든) */
export function naverDays(rows: NaverStatRow[], names: Map<string, string>): InsightDay[] {
  const out: InsightDay[] = []
  for (const r of rows) {
    const date = (r.dateStart ?? r.date ?? '').slice(0, 10)
    if (!r.id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    out.push({ date, campaign_id: r.id, campaign_name: names.get(r.id) ?? r.id, impressions: Number(r.impCnt ?? 0) || 0, clicks: Number(r.clkCnt ?? 0) || 0, spend: Math.round(Number(r.salesAmt ?? 0) || 0), leads: Number(r.ccnt ?? 0) || 0 })
  }
  return out
}

export class NaverError extends Error {
  status: number
  constructor(msg: string, status = 502) { super(msg); this.status = status }
}

export function naverClient(apiKey: string, secret: string, customer: string) {
  const call = async <T>(method: 'GET' | 'PUT', path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> => {
    const ts = String(Date.now())
    const sig = await naverSignature(ts, method, path, secret)
    const qs = new URLSearchParams(query).toString()
    const r = await fetch(`${NAVER_BASE}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: { 'X-Timestamp': ts, 'X-API-KEY': apiKey, 'X-Customer': customer, 'X-Signature': sig, 'Content-Type': 'application/json; charset=UTF-8' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    let j: unknown = null
    try { j = text ? JSON.parse(text) : null } catch { /* 글 그대로 */ }
    if (!r.ok) {
      const m = (j as { title?: string; detail?: string; message?: string } | null)
      const msg = m?.detail ?? m?.title ?? m?.message ?? text.slice(0, 200)
      if (r.status === 401 || r.status === 403) throw new NaverError(`네이버 열쇠 · 고객 번호가 맞지 않습니다: ${msg}`, 401)
      if (r.status === 429) throw new NaverError(`네이버 요청 한도에 걸렸습니다: ${msg}`, 429)
      throw new NaverError(`네이버 응답 오류 (${r.status}): ${msg}`)
    }
    return j as T
  }
  return {
    campaigns: () => call<NaverCampaignRaw[]>('GET', '/ncc/campaigns'),
    campaign: (id: string) => call<NaverCampaignRaw>('GET', `/ncc/campaigns/${id}`),
    /** 일별 수치 (ids 는 100개씩) */
    async stats(ids: string[], since: string, until: string): Promise<NaverStatRow[]> {
      const out: NaverStatRow[] = []
      for (let i = 0; i < ids.length; i += 100) {
        const r = await call<{ data?: NaverStatRow[] }>('GET', '/stats', {
          ids: ids.slice(i, i + 100).join(','), fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ccnt']),
          timeRange: JSON.stringify({ since, until }), timeIncrement: '1',
        })
        out.push(...(r?.data ?? []))
      }
      return out
    },
    /** 기간 합계 비용 (이번 달 쓴 돈) */
    async spend(ids: string[], since: string, until: string): Promise<number> {
      let sum = 0
      for (let i = 0; i < ids.length; i += 100) {
        const r = await call<{ data?: NaverStatRow[] }>('GET', '/stats', { ids: ids.slice(i, i + 100).join(','), fields: JSON.stringify(['salesAmt']), timeRange: JSON.stringify({ since, until }) })
        for (const row of r?.data ?? []) sum += Number(row.salesAmt ?? 0) || 0
      }
      return Math.round(sum)
    },
    pause: (id: string) => call('PUT', `/ncc/campaigns/${id}`, { fields: 'userLock' }, { nccCampaignId: id, userLock: true }),
    setBudget: (id: string, budget: number) => call('PUT', `/ncc/campaigns/${id}`, { fields: 'budget' }, { nccCampaignId: id, dailyBudget: budget, useDailyBudget: true }),
  }
}
