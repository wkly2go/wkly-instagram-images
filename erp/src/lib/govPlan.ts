// 사업계획서 초안 (2026-11-19 대표 지시 '필요정보만 입력하면 작성되도록') — 요청문 만들기 · 내려받기 글
// AI 호출은 기존 growth-ai(한 번에 요청문 6,000자 · 답 1,600토큰)라서 네 항목을 한 항목씩 따로 쓴다.
import type { GovCompany, GovProgram } from './gov'

export const PLAN_SECTIONS = [
  { key: 'problem', label: '1. 문제인식', guide: '누구의 어떤 불편이 아직 해결되지 않았는지. 고객과 문제를 숫자로 시작하고, 시장 규모는 전체 → 접근 가능 → 당장 공략할 시장 순서로, 목표 점유율까지.' },
  { key: 'solution', label: '2. 실현가능성', guide: '그 불편을 무엇으로 없애는지. 사업 기간 안에 끝나는 산출물 하나, 월별 추진 일정(글머리표), 경쟁사와의 차이, 이미 가진 실적 · 자산.' },
  { key: 'scaleup', label: '3. 성장전략', guide: '어떻게 팔고 넓히는지. 수익 모델, 첫 고객 확보 경로, 시점별 매출 · 고용 목표, 사업비 쓰임새(항목 · 단가 · 수량), 지원 종료 뒤 자금 계획(투자유치 포함).' },
  { key: 'team', label: '4. 팀구성', guide: '이 팀이 해낼 수 있는 이유. 대표와 핵심 인력의 관련 경력 · 실적 · 보유 인증, 부족한 역량과 채용 계획(직무 · 시기), 협력사. 성명 · 생년월일 · 학교 · 직장명은 쓰지 않는다.' },
] as const
export type PlanSectionKey = (typeof PLAN_SECTIONS)[number]['key']

export const PLAN_FIELDS = [
  { key: 'item', label: '아이템 한 줄', hint: '무엇을 만들거나 파는지', rows: 1 },
  { key: 'customer', label: '고객과 문제', hint: '누가 무엇 때문에 불편한지 · 아는 숫자', rows: 2 },
  { key: 'solution', label: '해결 방법 · 산출물', hint: '사업 기간에 완성할 것', rows: 2 },
  { key: 'proof', label: '지금까지의 실적', hint: '매출 · 고객 수 · 방문자 · 수행 프로젝트 (숫자 그대로)', rows: 2 },
  { key: 'goal', label: '목표', hint: '1~2년 뒤 매출 · 고객 · 채용', rows: 1 },
  { key: 'budget', label: '사업비 · 기간', hint: '신청 금액과 쓸 곳, 수행 기간', rows: 1 },
  { key: 'team', label: '팀', hint: '경력 연수 · 역할 (이름은 쓰지 않음)', rows: 1 },
] as const
export type PlanFieldKey = (typeof PLAN_FIELDS)[number]['key']
export type PlanInputs = Record<PlanFieldKey, string>
export type PlanSections = Partial<Record<PlanSectionKey, string>>

export const emptyInputs = (): PlanInputs => ({ item: '', customer: '', solution: '', proof: '', goal: '', budget: '', team: '' })
/** 초안을 만들 수 있는 최소 입력: 아이템 · 고객과 문제 · 해결 방법 */
export const inputsReady = (i: PlanInputs) => [i.item, i.customer, i.solution].every(v => v.trim().length >= 4)

const cut = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** 한 항목의 요청문 (6,000자 한도 안). 적어 준 사실만 쓰게 하고, 없는 숫자는 [확인 필요]로 남기게 한다 */
export function planSectionPrompt(section: PlanSectionKey, inputs: PlanInputs, program: Pick<GovProgram, 'title' | 'org' | 'category' | 'summary' | 'target_detail' | 'support_content'> | null, company: Pick<GovCompany, 'name' | 'founded' | 'industries' | 'cert_notes'>): string {
  const s = PLAN_SECTIONS.find(x => x.key === section)!
  const lines = [
    `정부지원사업 사업계획서의 '${s.label.replace(/^\d+\.\s*/, '')}' 항목 초안을 한국어로 작성해 주세요.`,
    '',
    '[규칙]',
    '- 아래 [입력]과 [회사]에 적힌 사실만 사용합니다. 적히지 않은 숫자 · 실적 · 고객사 · 수상은 지어내지 말고 그 자리에 [확인 필요: 무엇]이라고 적습니다.',
    '- 평가위원이 이 산업을 모른다고 보고 쉬운 말로 씁니다. 첫 문장이 결론입니다.',
    '- 소제목 2~4개와 글머리표로 구성하고 700~1,000자로 씁니다. 표는 쓰지 않습니다.',
    '- 대표 · 직원의 성명, 생년월일, 출신 학교, 직장명은 쓰지 않습니다.',
    '- 다른 항목 내용과 겹치지 않게 이 항목만 씁니다. 머리말 · 맺음말 · 설명 없이 본문만 냅니다.',
    '',
    `[이 항목에서 답할 것] ${s.guide}`,
    '',
    '[회사]',
    `- 회사: ${company.name} (설립 ${company.founded})`,
    `- 업종: ${cut(company.industries, 200) || '미입력'}`,
    `- 보유 인증: ${cut(company.cert_notes, 300) || '없음'}`,
  ]
  if (program) lines.push('', '[공고]', `- 사업: ${cut(program.title, 120)}${program.org ? ` (${cut(program.org, 60)})` : ''}`, program.category ? `- 분야: ${program.category}` : '', program.summary ? `- 개요: ${cut(program.summary, 400)}` : '', program.target_detail ? `- 신청 대상: ${cut(program.target_detail, 400)}` : '', program.support_content ? `- 지원 내용: ${cut(program.support_content, 300)}` : '')
  lines.push('', '[입력]', ...PLAN_FIELDS.map(f => `- ${f.label}: ${cut(inputs[f.key], 500) || '미입력'}`))
  return lines.filter(l => l !== '').join('\n').slice(0, 5900)
}

/** 내려받기 · 복사용 글 */
export function planText(title: string, companyName: string, sections: PlanSections): string {
  return [`${title || '사업계획서 초안'} — ${companyName}`, '※ AI 가 쓴 초안입니다. [확인 필요] 표시와 숫자를 확인하고, 그해 공고의 지정 양식에 옮겨 적어 주세요.', ...PLAN_SECTIONS.map(s => `\n${s.label}\n\n${(sections[s.key] ?? '').trim() || '(아직 없음)'}`)].join('\n')
}

/** [확인 필요] 가 남은 곳 수 — 제출 전 채워야 할 것 */
export const openQuestions = (sections: PlanSections) => PLAN_SECTIONS.reduce((n, s) => n + ((sections[s.key] ?? '').match(/\[확인 필요/g)?.length ?? 0), 0)
