// 광고 카피 · 기획 (AI 호출은 기존 growth-ai 한도 안에서)
// 2026-11-17 대표 지시 '광고 카피와 기획 능력을 최대로': 회사 광고 카피 규칙(wkly-ad-copy 스킬) · 앵글 틀(ad-creative 스킬)
// · 후보를 많이 만든 뒤 걸러 3안만 · 매체 글자 기준 · 근거 없는 숫자는 [NEED: 근거] — 요청문 · 결과 읽기 · 규칙 검사(lintAdCopy)
import type { MarketingCampaign } from './marketing'

export interface AdCopyVariant { headline: string; primaryText: string; description: string; cta: string; angle?: string; proof?: string }

const LIMITS: Record<MarketingCampaign['platform'], string> = {
  meta: '제목 40자 이내 · 본문 첫 줄 125자 안에 핵심(더 보기 전에 보이는 부분) · 행동 유도 10자 이내',
  google: '짧은 제목 15자(한글) 이내 · 긴 제목과 설명 45자 이내 · 화살표(→) 같은 기호 금지',
  naver: '제목 15자 이내 · 설명 45자 이내 (검색광고 기준) · 기호 남용 금지',
}

/** 회사 광고 카피 규칙 — 모든 광고 문구 요청에 붙는다 (wkly-ad-copy 스킬 요약) */
export const WKLY_COPY_RULES = [
  '[회사 광고 카피 규칙]',
  '1. 담당자의 실제 장면이나 말로 시작한다. 팝업은 브랜드 담당자, 송년회는 총무 · HR 담당자. 예: 여러 업체에 동시에 견적 요청, 결재 · 보고용 견적, 포트폴리오 요구, 예산 안에서 역제안.',
  '2. 더위클리만 쓸 수 있는 근거를 하나 넣는다: 팝업 매거진(@theweekly_magazine)이 직접 만들고 알림 · 직접 소개하는 대관 공간 · 상권 데이터 · 실행 크루. 자료에 없는 공간 이름 · 평수 · 일정은 쓰지 않는다.',
  '3. 한 문장엔 한 가지 말. 주어 · 서술어 호응을 지킨다. 제목에 서비스 3개 이상 나열 금지(나열은 본문으로).',
  "4. 스왑 테스트: 경쟁사가 그대로 써도 되는 문장은 버린다. '원스톱', '한 번에', '기획부터 철거까지 한 팀'만으로 끝나면 더위클리 근거를 붙인다.",
  '5. 억지 유행어(각, 찰떡, 오픈런 남용) 금지. 말투는 짧은 존댓말.',
  "6. 번역투 금지: '~를 통해', '~에 대해', '~을 위한', '~할 수 있습니다' 남발, 'X가 아니라 Y' 공식, 자문자답 콜론.",
  '7. 근거 없는 숫자 · 약속(매출 %, 대관 가능 일정, 수상 · 실적) 금지. 필요하면 [NEED: 근거]로 표시한다.',
  "8. 업무를 나열할 때는 '기획'을 꼭 넣는다. 송년회 문구는 '철거' 대신 '뒷정리 · 마무리', 팝업 문구는 '철거'.",
  '9. 소리 내어 읽어서 걸리면 버린다.',
].join('\n')

/** 앵글 — 사람이 누르는 서로 다른 이유 (ad-creative 스킬) */
const ANGLES = '공감 · 문제(담당자가 겪는 장면) / 결과(결재 · 오픈이 쉬워지는 모습) / 근거 · 신뢰(매거진 · 공간 · 실행 크루) / 호기심 / 비교(여러 업체에 따로 맡길 때와의 차이, 경쟁사 이름은 쓰지 않음) / 시기(시즌 · 마감) / 대상 지정(브랜드 마케터 · 총무 담당자)'

/** base = buildMarketingAIPrompt(c) (캠페인 자료 · 사실 지어내지 말 것 안내 포함) */
export function adCopyRequest(c: Pick<MarketingCampaign, 'platform'> & Partial<Pick<MarketingCampaign, 'seasonNote' | 'brand'>>, base: string): string {
  const season = (c.seasonNote ?? '').trim()
  return [
    base,
    '',
    WKLY_COPY_RULES,
    '',
    `매체 글자 기준: ${LIMITS[c.platform]}.`,
    season ? `시즌 키워드: '${season.slice(0, 40)}' 의 핵심 낱말을 모든 안에 넣는다.` : '',
    '[작성 순서]',
    `1. 앵글 후보 ${ANGLES} 중 서로 다른 3개를 고른다.`,
    '2. 앵글마다 제목 후보를 4개 이상(전체 12개 이상) 머릿속으로 만든 뒤, 위 규칙 · 글자 기준 · 스왑 테스트로 걸러 앵글마다 가장 좋은 1개만 남긴다. 후보 목록은 출력하지 않는다.',
    '3. 3안을 아래 형식 그대로 쓴다. 형식 밖의 설명은 맨 끝에 "검토할 사실:"로만 적는다.',
    '[1안]',
    '앵글: (고른 앵글 이름)',
    '근거: (이 안에 쓴 더위클리 근거 한 줄, 자료에 있는 것만)',
    '제목: …',
    '본문: …',
    '보조: …',
    '행동: …',
  ].filter(Boolean).join('\n').slice(0, 6000)
}

const FIELD: Record<string, keyof AdCopyVariant> = { 제목: 'headline', 본문: 'primaryText', 보조: 'description', '보조 설명': 'description', 행동: 'cta', '행동 유도': 'cta', 앵글: 'angle', 근거: 'proof' }

/** '[n안]' 으로 나눈 뒤 '앵글: · 근거: · 제목: · 본문: · 보조: · 행동:' 줄을 읽는다. 본문은 다음 칸 이름이 나올 때까지 여러 줄. */
export function parseAdCopyVariants(text: string): AdCopyVariant[] {
  const blocks = text.split(/^\s*(?:#+\s*)?\[?\s*\d\s*안\s*\]?.*$/m).slice(1)
  const out: AdCopyVariant[] = []
  for (const block of blocks.length ? blocks : [text]) {
    const v: AdCopyVariant = { headline: '', primaryText: '', description: '', cta: '' }
    let cur: keyof AdCopyVariant | null = null
    for (const raw of block.split('\n')) {
      const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*•]\s*/, '')
      if (/^\s*검토할 사실/.test(line)) break
      const m = line.match(/^\s*(제목|본문|보조 설명|보조|행동 유도|행동|앵글|근거)\s*[:：]\s*(.*)$/)
      if (m) { cur = FIELD[m[1]]; v[cur] = m[2].trim(); continue }
      if (cur === 'primaryText' && line.trim()) v.primaryText += `\n${line.trim()}`
    }
    v.cta = v.cta.replace(/^["'“]|["'”]$/g, '')
    if (v.headline) out.push(v)
  }
  return out.slice(0, 3)
}

/** 캠페인 기획 요청 — 기획 · 예산 단계에서 AI 에게 (adPlanRequest) */
export function adPlanRequest(base: string): string {
  return [
    base,
    '',
    WKLY_COPY_RULES,
    '',
    '[이번 요청] 문구가 아니라 캠페인 기획을 아래 항목으로 짧게 쓴다. 자료에 없는 혜택 · 가격 · 성과 수치는 만들지 말고 [NEED: 근거]로 둔다.',
    '타깃: (누가 · 어떤 장면에서 이 광고를 보는지 한 줄)',
    '인사이트: (그 사람이 지금 겪는 문제 한 줄)',
    '약속: (광고가 약속하는 한 가지, 더위클리 근거 포함)',
    '앵글: (서로 다른 3개, 쉼표로)',
    '매체 · 예산: (매체별 역할과 예산 나눔 가설, 일 예산 근거)',
    '시험: (A/B 로 무엇을 비교하고 어떤 지표로 며칠 뒤 판정하는지)',
    '중단 기준: (언제 끄거나 바꾸는지)',
    '시즌: (시기 · 시즌 연결, 없으면 없음)',
    '검토할 사실: (확인이 필요한 것)',
  ].join('\n').slice(0, 6000)
}

export interface AdPlanDraft { audience: string; insight: string; promise: string; angles: string; channel: string; test: string; stop: string; season: string; check: string }
const PLAN_FIELD: Record<string, keyof AdPlanDraft> = { 타깃: 'audience', 인사이트: 'insight', 약속: 'promise', 앵글: 'angles', 시험: 'test', '중단 기준': 'stop', 시즌: 'season', '검토할 사실': 'check' }

export function parseAdPlan(text: string): AdPlanDraft | null {
  const d: AdPlanDraft = { audience: '', insight: '', promise: '', angles: '', channel: '', test: '', stop: '', season: '', check: '' }
  let cur: keyof AdPlanDraft | null = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*•#]+\s*/, '')
    const m = line.match(/^\s*(타깃|인사이트|약속|앵글|매체 ?· ?예산|매체|시험|중단 기준|시즌|검토할 사실)\s*[:：]\s*(.*)$/)
    if (m) { cur = m[1].startsWith('매체') ? 'channel' : PLAN_FIELD[m[1]] ?? null; if (cur) d[cur] = m[2].trim(); continue }
    if (cur && line.trim()) d[cur] += `\n${line.trim()}`
  }
  return d.audience || d.promise ? d : null
}

export interface CopyIssue { field: 'headline' | 'primaryText' | 'description' | 'cta'; level: 'error' | 'warn'; message: string }

/** 회사 카피 규칙을 코드로 검사 — AI 없이 바로 (lintAdCopy). 글자 수는 한글 · 영문 모두 한 글자로 센다. */
export function lintAdCopy(c: Pick<MarketingCampaign, 'platform' | 'headline' | 'primaryText' | 'description' | 'cta'> & Partial<Pick<MarketingCampaign, 'seasonNote'>>): CopyIssue[] {
  const out: CopyIssue[] = []
  const len = (s: string) => [...s.trim()].length
  const max: Record<MarketingCampaign['platform'], { headline: number; description: number; cta: number }> = {
    meta: { headline: 40, description: 125, cta: 10 },
    google: { headline: 15, description: 45, cta: 10 },
    naver: { headline: 15, description: 45, cta: 10 },
  }
  const lim = max[c.platform]
  if (c.headline && len(c.headline) > lim.headline) out.push({ field: 'headline', level: 'error', message: `제목 ${len(c.headline)}자 · 이 매체는 ${lim.headline}자 이내` })
  if (c.description && len(c.description) > lim.description) out.push({ field: 'description', level: 'error', message: `보조 설명 ${len(c.description)}자 · ${lim.description}자 이내` })
  if (c.cta && len(c.cta) > lim.cta) out.push({ field: 'cta', level: 'warn', message: `행동 유도 ${len(c.cta)}자 · ${lim.cta}자 이내 권장` })
  if (c.platform !== 'meta' && /[→←↑↓★☆▶◀※]/.test(c.headline + c.description)) out.push({ field: 'headline', level: 'error', message: '검색광고는 화살표 · 별표 같은 기호를 쓸 수 없습니다' })
  const fields: CopyIssue['field'][] = ['headline', 'primaryText', 'description']
  for (const f of fields) {
    const t = c[f] ?? ''
    if (!t.trim()) continue
    const name = f === 'headline' ? '제목' : f === 'primaryText' ? '본문' : '보조 설명'
    const trans = t.match(/를 통해|을 통해|에 대해|을 위한|를 위한|가 아니라|이 아니라/g)
    if (trans) out.push({ field: f, level: 'warn', message: `${name}: 번역투 '${[...new Set(trans)].join("', '")}' — 더 짧게 바꿔 보세요` })
    const fad = t.match(/찰떡|오픈런|[^가-힣]각[^가-힣]/g)
    if (fad) out.push({ field: f, level: 'warn', message: `${name}: 억지 유행어 '${fad[0].trim()}'` })
    if (/원스톱|한 ?번에|한 팀/.test(t) && !/매거진|theweekly|공간|크루|상권/.test(t)) out.push({ field: f, level: 'warn', message: `${name}: '원스톱 · 한 번에 · 한 팀'만으로는 경쟁사도 쓸 수 있는 말 — 더위클리 근거(매거진 · 공간 · 실행 크루)를 붙이세요` })
    if (/\d+\s?(%|배|만 ?명|건 이상|위)/.test(t) && !/\[NEED/.test(t)) out.push({ field: f, level: 'warn', message: `${name}: 숫자 근거를 확인하세요 (확인 전이면 [NEED: 근거])` })
    if (/\[NEED/.test(t)) out.push({ field: f, level: 'error', message: `${name}: [NEED: 근거] 가 남아 있습니다 — 근거를 채우거나 문장을 바꾸세요` })
  }
  const items = (c.headline.match(/·/g) ?? []).length
  if (items >= 2) out.push({ field: 'headline', level: 'warn', message: '제목에 서비스 3개 이상 나열 — 나열은 본문으로' })
  const season = (c.seasonNote ?? '').trim().split(/[\s,·]+/).find(w => w.length >= 2)
  if (season && c.headline && !(c.headline + c.primaryText).includes(season)) out.push({ field: 'headline', level: 'warn', message: `시즌 키워드 '${season}' 가 문구에 없습니다` })
  return out
}
