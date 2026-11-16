// AI 광고 문구 3안 — 요청문 만들기 · 결과 나누기 (AI 호출은 기존 growth-ai 한도 안에서)
import type { MarketingCampaign } from './marketing'

export interface AdCopyVariant { headline: string; primaryText: string; description: string; cta: string }

const LIMITS: Record<MarketingCampaign['platform'], string> = {
  meta: '제목 40자 이내 · 본문 첫 줄 125자 안에 핵심 · 행동 유도 10자 이내',
  google: '제목 30자(영문 기준 30자, 한글은 15자 안팎) 이내 · 설명 90자 이내',
  naver: '제목 15자 이내 · 설명 45자 이내 (검색광고 기준)',
}

/** base = buildMarketingAIPrompt(c) (캠페인 자료 · 사실 지어내지 말 것 안내 포함) */
export function adCopyRequest(c: Pick<MarketingCampaign, 'platform'>, base: string): string {
  return [
    base,
    '',
    `매체 글자 기준: ${LIMITS[c.platform]}.`,
    '서로 다른 접근(① 공감 · 문제 제기 ② 혜택 · 결과 ③ 사례 · 신뢰)으로 3안을 쓰고, 각 안은 아래 형식을 그대로 지켜 주세요. 형식 밖의 설명은 맨 끝에 "검토할 사실:"로만 적어 주세요.',
    '[1안]',
    '제목: …',
    '본문: …',
    '보조: …',
    '행동: …',
  ].join('\n').slice(0, 6000)
}

const FIELD: Record<string, keyof AdCopyVariant> = { 제목: 'headline', 본문: 'primaryText', 보조: 'description', '보조 설명': 'description', 행동: 'cta', '행동 유도': 'cta' }

/** '[n안]' 으로 나눈 뒤 '제목: · 본문: · 보조: · 행동:' 줄을 읽는다. 본문은 다음 칸 이름이 나올 때까지 여러 줄. */
export function parseAdCopyVariants(text: string): AdCopyVariant[] {
  const blocks = text.split(/^\s*(?:#+\s*)?\[?\s*\d\s*안\s*\]?.*$/m).slice(1)
  const out: AdCopyVariant[] = []
  for (const block of blocks.length ? blocks : [text]) {
    const v: AdCopyVariant = { headline: '', primaryText: '', description: '', cta: '' }
    let cur: keyof AdCopyVariant | null = null
    for (const raw of block.split('\n')) {
      const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*•]\s*/, '')
      if (/^\s*검토할 사실/.test(line)) break
      const m = line.match(/^\s*(제목|본문|보조 설명|보조|행동 유도|행동)\s*[:：]\s*(.*)$/)
      if (m) { cur = FIELD[m[1]]; v[cur] = m[2].trim(); continue }
      if (cur === 'primaryText' && line.trim()) v.primaryText += `\n${line.trim()}`
    }
    v.cta = v.cta.replace(/^["'“]|["'”]$/g, '')
    if (v.headline) out.push(v)
  }
  return out.slice(0, 3)
}
