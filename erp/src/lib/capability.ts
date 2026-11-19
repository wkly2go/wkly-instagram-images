// 능력 지표 (2026-11-19 대표 지시 '현제 인트라넷 능력을 정량화하고' → '모든 수치가 80이상이 나오도록')
// 점수는 서버가 계산식으로 매일 잰다(supabase/migrations/20261119212000_capability_score.sql · 기준선은 erp/docs/CAPABILITY_SCORE.md).
// 여기는 화면이 쓰는 이름 · 모양 · 작은 계산만.

export const CAPABILITY_TARGET = 80

export const CAPABILITY_AXES = [
  { key: 'coverage', label: '기능 범위', hint: '만들기로 한 기능이 얼마나 갖춰졌나' },
  { key: 'adoption', label: '실사용', hint: '팀이 실제로 쓰고 있나 (최근 30일 기록)' },
  { key: 'automation', label: '자동화', hint: '사람이 옮겨 적지 않아도 이어지나' },
  { key: 'stability', label: '안정성', hint: '멈추지 않고 도나 · 멈췄을 때 바로 아나' },
  { key: 'performance', label: '성능', hint: '빨리 뜨고 서버에 무리가 없나' },
  { key: 'security', label: '보안', hint: '볼 수 없는 사람이 못 보게 막혀 있나' },
  { key: 'quality', label: '품질 체계', hint: '고칠 때 망가지지 않게 지키는 장치' },
] as const
export type CapabilityAxisKey = (typeof CAPABILITY_AXES)[number]['key']

export interface CapabilityItem { name: string; ok?: boolean; n?: number; use?: number; state?: 'full' | 'partial' | 'none'; note?: string }
export interface CapabilityMetric { name: string; value: number | null; unit: string; score: number | null; rule: string; items?: CapabilityItem[] }
export type CapabilityScores = Partial<Record<CapabilityAxisKey | 'total', number | null>>
export interface CapabilityDay { day: string; scores: CapabilityScores }
export interface CapabilityResult {
  today: (CapabilityDay & { metrics: Partial<Record<CapabilityAxisKey, CapabilityMetric[]>>; at: string }) | null
  history: CapabilityDay[]
}

/** 빌드가 version.json 에 적어 두는 값 (vite.config.ts versionFile) */
export interface BuildStats { first_load_kb: number; update_kb: number; app_kb: number; tests: number; menus: number; manual_pages: number; ci: boolean; runbook: boolean; build?: string }

export const scoreOf = (s: CapabilityScores | undefined, key: CapabilityAxisKey | 'total'): number | null => {
  const v = s?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 목표(80)에 못 미친 축 — 낮은 순 */
export function belowTarget(s: CapabilityScores | undefined, target = CAPABILITY_TARGET): { key: CapabilityAxisKey; label: string; score: number }[] {
  const out: { key: CapabilityAxisKey; label: string; score: number }[] = []
  for (const a of CAPABILITY_AXES) {
    const score = scoreOf(s, a.key)
    if (score !== null && score < target) out.push({ key: a.key, label: a.label, score })
  }
  return out.sort((x, y) => x.score - y.score)
}

/** 며칠 전과 견준 변화 (기록이 없으면 null) */
export function scoreChange(history: CapabilityDay[], key: CapabilityAxisKey | 'total', daysBack = 7): number | null {
  if (history.length < 2) return null
  const last = history[history.length - 1]
  const base = [...history].reverse().find(h => h.day <= shiftDay(last.day, -daysBack)) ?? history[0]
  if (base === last) return null
  const a = scoreOf(last.scores, key), b = scoreOf(base.scores, key)
  return a === null || b === null ? null : Math.round((a - b) * 10) / 10
}

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 세부 지표 중 그 축을 가장 끌어내리는 것 (다음에 손댈 곳) */
export function weakestMetric(metrics: CapabilityMetric[] | undefined): CapabilityMetric | null {
  const scored = (metrics ?? []).filter(m => typeof m.score === 'number')
  return scored.length ? scored.reduce((a, b) => ((a.score as number) <= (b.score as number) ? a : b)) : null
}

export const valueLabel = (m: CapabilityMetric): string => (m.value === null || m.value === undefined ? '아직 없음' : `${Number(m.value).toLocaleString('ko-KR')}${m.unit.startsWith('/') ? '' : ' '}${m.unit}`)

/** version.json 의 값이 맞는 모양인지 (숫자 · 참거짓만 서버로 넘김) */
export function readBuildStats(v: unknown): BuildStats | null {
  const s = (v as { stats?: Record<string, unknown> } | null)?.stats
  if (!s || typeof s !== 'object') return null
  const num = (k: string) => (typeof s[k] === 'number' && Number.isFinite(s[k] as number) ? (s[k] as number) : null)
  const first = num('first_load_kb'), update = num('update_kb'), app = num('app_kb'), tests = num('tests'), menus = num('menus'), manual = num('manual_pages')
  if (first === null || update === null || app === null || tests === null || menus === null || manual === null) return null
  return { first_load_kb: first, update_kb: update, app_kb: app, tests, menus, manual_pages: manual, ci: s.ci === true, runbook: s.runbook === true, build: typeof (v as { id?: unknown }).id === 'string' ? ((v as { id: string }).id).slice(0, 40) : undefined }
}
