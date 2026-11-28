// API 에이전트 실행기 순수 규칙 (시험 tests/api-agents.test.ts)

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; web: number }

// 2026-11 Claude API 첫 번째 가격 (달러 / 100만 토큰) · 웹 검색은 1,000번에 10달러
const PRICE: Record<string, { in: number; out: number; read: number; write: number }> = {
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.1, write: 2.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, read: 0.01, write: 0.125 },
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2, write: 5 },
}
const WEB_SEARCH_USD = 0.01

export function priceUsd(model: string, u: Usage): number {
  const p = PRICE[model] ?? PRICE['claude-sonnet-5-5']
  const usd = (u.input * p.in + u.output * p.out + u.cacheRead * p.read + u.cacheWrite * p.write) / 1_000_000 + u.web * WEB_SEARCH_USD
  return Math.round(usd * 10000) / 10000
}

/** 지금(한국 시각) 실행할 회차 'YYYY-MM-DD HH:MM' — 정한 시각이 지났고 30분이 안 지난 것만 (늦은 실행 · 재시작 대비) */
export function dueSlots(times: string[], weekdays: number[] | null, now: Date, graceMin = 30): string[] {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  const day = kst.toISOString().slice(0, 10)
  const dow = kst.getUTCDay() === 0 ? 7 : kst.getUTCDay()
  if (weekdays?.length && !weekdays.includes(dow)) return []
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  const out: string[] = []
  for (const t of times) {
    const m = /^(\d{2}):(\d{2})$/.exec(t)
    if (!m) continue
    const at = Number(m[1]) * 60 + Number(m[2])
    if (mins >= at && mins - at < graceMin) out.push(`${day} ${t}`)
  }
  return out
}

/** 에이전트에 적힌 스킬 이름 → 세션에 붙일 스킬 목록. Console 에 아직 안 올라간 이름(번호 없음)은 건너뛰고, 같은 이름은 한 번만 */
export function skillRefs(names: string[], rows: { name: string; console_skill_id: string | null }[]): { type: 'custom'; skill_id: string; version: 'latest' }[] {
  const byName = new Map(rows.filter(r => r.console_skill_id).map(r => [r.name, String(r.console_skill_id)]))
  const seen = new Set<string>()
  const out: { type: 'custom'; skill_id: string; version: 'latest' }[] = []
  for (const n of names) {
    const id = byName.get(n)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ type: 'custom', skill_id: id, version: 'latest' })
  }
  return out
}
