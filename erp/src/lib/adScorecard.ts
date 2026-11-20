// 광고 자동 운영 '규칙 성적표' (2026-11-20 · 2단계)
// 실행 7일 뒤 효과(좋아짐 · 나빠짐 · 비슷)를 규칙별로 모아 성공률을 보이고, 기준을 어떻게 고치면 좋을지 제안한다.
// 기준을 저절로 바꾸지는 않는다 — 대표가 '안전장치'에서 고침. 시험: tests/ad-autopilot.test.ts
export type RuleKey = 'pause' | 'pause_ad' | 'scale_up' | 'scale_down'
export const RULE_LABEL: Record<RuleKey, string> = { pause: '캠페인 멈춤', pause_ad: '소재 멈춤', scale_up: '예산 늘림', scale_down: '예산 줄임' }

export interface ScoredAction { kind: 'pause' | 'scale_up' | 'scale_down'; ad_id?: string | null; status: string; effect?: '좋아짐' | '나빠짐' | '비슷' | null }
export interface RuleScore { key: RuleKey; label: string; executed: number; checked: number; good: number; bad: number; same: number; rate: number | null; advice: string | null }

/** 판단할 만큼 쌓였다고 보는 건수 */
export const MIN_CASES = 4

export function ruleScorecard(actions: ScoredAction[]): RuleScore[] {
  const keys: RuleKey[] = ['scale_up', 'scale_down', 'pause', 'pause_ad']
  return keys.map(key => {
    const mine = actions.filter(a => a.status === '실행' && (a.kind === 'pause' ? (a.ad_id ? 'pause_ad' : 'pause') : a.kind) === key)
    const checked = mine.filter(a => a.effect)
    const good = checked.filter(a => a.effect === '좋아짐').length
    const bad = checked.filter(a => a.effect === '나빠짐').length
    const rate = checked.length ? good / checked.length : null
    return { key, label: RULE_LABEL[key], executed: mine.length, checked: checked.length, good, bad, same: checked.length - good - bad, rate, advice: adviceFor(key, checked.length, rate, bad) }
  })
}

function adviceFor(key: RuleKey, n: number, rate: number | null, bad: number): string | null {
  if (n < MIN_CASES || rate == null) return null
  const badRate = bad / n
  if (key === 'scale_up') {
    if (rate >= 0.75) return '늘림이 잘 맞습니다. 한 번에 바꾸는 폭을 조금(예: 20 → 25%) 키워도 됩니다.'
    if (rate < 0.5) return '늘린 뒤 문의당 비용이 오르는 일이 많습니다. 목표 문의당 비용을 낮추거나(더 엄격하게) 한 번 폭을 줄이세요.'
  }
  if (key === 'scale_down' && rate < 0.5) return '줄여도 문의당 비용이 잘 안 내려갑니다. 예산보다 소재 · 타깃이 문제일 수 있어 새 소재를 넣는 것을 권합니다.'
  if (key === 'pause' && badRate >= 0.5) return '캠페인을 멈춘 뒤 계정 전체 비용이 오르는 일이 많습니다. 판단 최소 금액을 올려 더 오래 지켜보세요.'
  if (key === 'pause_ad' && badRate >= 0.5) return '소재를 멈춘 뒤 캠페인 비용이 오르는 일이 많습니다. 새 소재를 먼저 넣고 멈추는 순서가 좋습니다.'
  return null
}
