import { koreaDateTimeInput, safeWebUrl, type GrowthItem } from './growth.ts'
import { validDate } from './prospecting.ts'
import { SALES_COMPANIES, SALES_PAGE_SIZE, needsFollowup, type SalesDraft, type SalesSummary } from './sales.ts'

export interface SalesPlanFields {
  target: string
  scope: string
  demand: string
  contact: string
  targetDate: string
  decisionDate: string
  budget: string
  evidence: string
  eligibility: '미확인' | '충족' | '불충족'
  commitment: '미확인' | '미발주' | '일부 미발주' | '발주 완료'
}

export interface SalesPlanAssessment {
  status: '검토 우선' | '추가 확인' | '보류'
  reasons: string[]
  nextAction: string
  nextDate: string | null
}

const salesQueueLabels = {
  due: '후속 연락 기한',
  unscheduled: '연락일 미정',
  upcoming: '연락 예정',
  handoff: '프로젝트 연결 대기',
  closed: '종결·보류',
} as const
type SalesQueueKind = keyof typeof salesQueueLabels
type SalesQueueRow = { row: SalesSummary; kind: SalesQueueKind; label: string }

export function reviewSalesQueue(items: readonly SalesSummary[], today: string, mode: 'all' | 'intake' | 'handoff' = 'all') {
  const groups: Record<SalesQueueKind, SalesQueueRow[]> = { due: [], unscheduled: [], upcoming: [], handoff: [], closed: [] }
  // The query is paginated by updated time. Keep estimates and priorities limited to this page.
  for (const row of items.slice(0, SALES_PAGE_SIZE)) {
    let kind: SalesQueueKind
    if (row.stage === '수주') kind = row.project_id ? 'closed' : 'handoff'
    else if (row.stage === '실주' || row.stage === '보류') kind = 'closed'
    else if (needsFollowup(row, today)) kind = 'due'
    else kind = row.next_date ? 'upcoming' : 'unscheduled'

    if (mode === 'intake' && (kind === 'handoff' || kind === 'closed')) continue
    groups[kind].push({ row, kind, label: salesQueueLabels[kind] })
  }
  for (const group of [groups.due, groups.upcoming]) {
    group.sort((a, b) => (a.row.next_date ?? '').localeCompare(b.row.next_date ?? ''))
  }
  const order = mode === 'handoff'
    ? ['handoff', 'due', 'unscheduled', 'upcoming', 'closed'] as const
    : ['due', 'unscheduled', 'upcoming', 'handoff', 'closed'] as const
  return {
    rows: order.flatMap(kind => groups[kind]),
    counts: {
      due: groups.due.length, unscheduled: groups.unscheduled.length, upcoming: groups.upcoming.length,
      handoff: groups.handoff.length, closed: groups.closed.length,
    },
  }
}

const marker = '\n\n[WKLY_SALES_PLAN_V1]\n'
export const SALES_PLAN_LIMITS = {
  target: 160,
  scope: 300,
  demand: 400,
  contact: 200,
  targetDate: 10,
  decisionDate: 10,
  budget: 160,
  evidence: 500,
} as const

export function emptySalesPlan(): SalesPlanFields {
  return {
    target: '',
    scope: '',
    demand: '',
    contact: '',
    targetDate: '',
    decisionDate: '',
    budget: '',
    evidence: '',
    eligibility: '미확인',
    commitment: '미확인',
  }
}

function readPlanPayload(value: unknown): SalesPlanFields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  const defaults = emptySalesPlan()
  const keys = Object.keys(defaults) as (keyof SalesPlanFields)[]
  if (Object.keys(fields).some(key => !Object.hasOwn(defaults, key))) return null
  for (const key of keys) {
    if (Object.hasOwn(fields, key) && typeof fields[key] !== 'string') return null
  }
  const plan = { ...defaults, ...fields } as SalesPlanFields
  return validPlanChoices(plan) ? plan : null
}

export function readSalesPlan(description: string): { notes: string; plan: SalesPlanFields } {
  const offset = description.lastIndexOf(marker)
  if (offset >= 0) {
    try {
      const plan = readPlanPayload(JSON.parse(description.slice(offset + marker.length)))
      if (plan) return { notes: description.slice(0, offset), plan }
    } catch { /* Leave old or damaged free-form text visible and editable. */ }
  }
  return { notes: description, plan: emptySalesPlan() }
}

export function writeSalesPlan(notes: string, plan: SalesPlanFields): string {
  const defaults = emptySalesPlan()
  const entries = (Object.keys(defaults) as (keyof SalesPlanFields)[])
    .filter(key => plan[key] !== defaults[key]).map(key => [key, plan[key]] as const)
  return entries.length ? notes + marker + JSON.stringify(Object.fromEntries(entries)) : notes
}

export function validateSalesPlan(plan: SalesPlanFields): string | null {
  for (const key of Object.keys(SALES_PLAN_LIMITS) as (keyof typeof SALES_PLAN_LIMITS)[]) {
    if (typeof plan[key] !== 'string' || plan[key].length > SALES_PLAN_LIMITS[key]) return '영업 계획의 입력 길이를 확인해 주세요.'
  }
  if ((plan.targetDate && !validDate(plan.targetDate)) || (plan.decisionDate && !validDate(plan.decisionDate))) {
    return '오픈 목표일과 결정일 또는 제출 마감일을 확인해 주세요.'
  }
  if (plan.targetDate && plan.decisionDate && plan.targetDate < plan.decisionDate) {
    return '결정일 또는 제출 마감일은 오픈 목표일 이후로 지정할 수 없습니다.'
  }
  if (!validPlanChoices(plan)) {
    return '참가 자격과 발주 상태를 확인해 주세요.'
  }
  return null
}

function validPlanChoices(plan: SalesPlanFields): boolean {
  return ['미확인', '충족', '불충족'].includes(plan.eligibility) &&
    ['미확인', '미발주', '일부 미발주', '발주 완료'].includes(plan.commitment)
}

function known(value: string): boolean {
  const text = value.trim()
  return text.length > 0 && !/^(미확인|미정|모름|확인 필요|없음|-)$/.test(text)
}

export function seedSalesPlanFromCandidate(candidate: GrowthItem): Partial<SalesPlanFields> {
  const { document } = candidate
  const fields: Partial<SalesPlanFields> = {}
  if (candidate.kind === 'contact') {
    const brand = document.brand?.trim()
    if (brand) fields.target = brand.slice(0, SALES_PLAN_LIMITS.target)
    const email = document.email?.trim()
    const instagram = document.instagram?.trim()
    const contact = [email, instagram && `@${instagram.replace(/^@/, '')}`].filter(Boolean).join(' · ')
    if (contact) fields.contact = contact.slice(0, SALES_PLAN_LIMITS.contact)
  }
  if (candidate.kind === 'tender') {
    const agency = document.agency?.trim()
    if (agency) fields.target = agency.slice(0, SALES_PLAN_LIMITS.target)
    const deadline = document.deadline?.trim()
    if (deadline && /(?:Z|[+-]\d{2}:\d{2})$/.test(deadline)) {
      const date = koreaDateTimeInput(deadline).slice(0, 10)
      if (validDate(date)) fields.decisionDate = date
    }
    const { amount, qualification } = document
    if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0) {
      fields.budget = `공고 금액 ${amount.toLocaleString('ko-KR')}원`
    }
    const evidence = document.evidence?.trim()
    if (evidence && known(evidence)) {
      fields.evidence = evidence.slice(0, SALES_PLAN_LIMITS.evidence)
      if (qualification === '충족' || qualification === '불충족') fields.eligibility = qualification
    }
  }
  return fields
}

function hasUsableSource(value: string) {
  return /^https?:\/\//i.test(value) && safeWebUrl(value)
}

const activeStageActions = {
  발굴: {
    private: '담당자에게 미팅을 제안하고 미발주 범위·예산 확인',
    publicBid: '원문 마감 시각 확인 후 제출 담당·서류·견적 준비',
  },
  접촉: {
    private: '담당자 회신과 의사결정자 확인 후 미팅 일정 조율',
    publicBid: '공식 질의·현장설명 참여 조건과 회신 확인',
  },
  미팅: {
    private: '미팅에서 확인한 수행 범위·일정·예산을 견적과 제안서에 반영',
    publicBid: '현장설명·질의 답변을 반영해 제안서·견적·증빙 요건 대조',
  },
  제안: {
    private: '제안서 수신 여부와 결정 예정일 확인',
    publicBid: '제안서·가격입찰의 공식 접수 여부와 평가·결과 공지 일정 확인',
  },
  협상: {
    private: '계약 범위·대금 지급·변경 및 취소 조건 확인',
    publicBid: '공식 협상 안내에 따라 과업 범위·대금 지급·변경 및 취소 조건 확인',
  },
} satisfies Record<Exclude<SalesDraft['stage'], '수주' | '실주' | '보류'>, { private: string; publicBid: string }>

export function assessSalesPlan(draft: SalesDraft, plan: SalesPlanFields, today: string): SalesPlanAssessment {
  const publicBid = draft.source === '나라장터'
  const hasEvidence = known(plan.evidence)
  const hold = (reason: string, nextAction: string): SalesPlanAssessment => ({
    status: '보류', reasons: [reason], nextAction, nextDate: null,
  })
  if (draft.stage === '수주') {
    return hold('수주 단계로 기록됐습니다.', draft.project_id ? '연결 프로젝트에서 실행 일정과 운영 범위 확인' : '수주 프로젝트를 연결하고 범위·일정 인계')
  }
  if (draft.stage === '실주' || draft.stage === '보류') {
    return hold(`${draft.stage} 단계로 기록됐습니다.`, '결과 사유와 다시 검토할 조건 확인')
  }
  if (publicBid && plan.eligibility === '불충족' && hasEvidence) {
    return hold('기록한 근거에서 참가 요건을 충족하지 않는 것으로 검토했습니다.', '참가 요건을 충족하는 다른 공고 검토')
  }
  if (!publicBid && plan.commitment === '발주 완료' && hasEvidence) {
    return hold('기록한 근거에서 해당 대행 범위가 이미 발주된 것으로 검토했습니다.', '후속 또는 다음 회차에 필요한 대행 범위 확인')
  }
  const fieldError = validateSalesPlan(plan)
  if (fieldError || !validDate(today)) {
    return { status: '추가 확인', reasons: [fieldError ?? '검토 기준일을 확인해 주세요.'], nextAction: '입력한 일정과 발주 상태 정리', nextDate: null }
  }
  const pastDecision = Boolean(plan.decisionDate && plan.decisionDate < today)
  if (publicBid && pastDecision && draft.stage !== '제안' && draft.stage !== '협상') {
    return hold('기록한 제출 마감일이 지났습니다.', '정정 공고나 다음 발주 일정 확인')
  }
  if (plan.targetDate && plan.targetDate < today) {
    return hold('기록한 오픈 목표일이 지났습니다.', '진행 현황 및 다음 회차 일정 확인')
  }

  const questions: { reason: string; action: string }[] = []
  const check = (valid: boolean, reason: string, action: string) => {
    if (!valid) questions.push({ reason, action })
  }
  if (publicBid) {
    check(hasUsableSource(draft.source_url), '공고 원문 주소가 없습니다.', '나라장터 공고 원문과 정정 여부 확인')
    check(Boolean(plan.decisionDate), '가장 이른 제출 마감일이 미정입니다.', '제안서·가격입찰·등록 마감 시각 각각 확인')
    check(plan.eligibility === '충족', '참가 자격 확인이 필요합니다.', '면허·지역·실적·제출 서류 요건 확인')
  } else {
    check(plan.commitment === '미발주' || plan.commitment === '일부 미발주', '대행사 선정 및 미발주 여부가 미확인입니다.', '브랜드 또는 주최사에 미발주 업무 범위 확인')
    if (pastDecision && draft.stage !== '협상') {
      check(false, '기록한 대행사 선정 목표일이 지났습니다.', '선정 결과와 남은 발주 범위 다시 확인')
    } else {
      check(Boolean(plan.decisionDate), '대행사 선정 목표일이 미정입니다.', '담당자에게 대행사 선정 예정일 확인')
    }
    check(Boolean(plan.targetDate), '팝업 오픈 목표일이 미정입니다.', '팝업 오픈 예정일과 준비 기간 확인')
    check(known(plan.contact) || Boolean(draft.contact_id), '문의할 담당자나 공식 창구가 없습니다.', '공식 연락 창구와 의사결정 담당자 확인')
  }
  check(hasEvidence, '확인 근거가 기록되지 않았습니다.', '공식 공지나 직접 확인한 내용과 날짜 기록')
  if (publicBid && pastDecision && draft.stage === '제안') {
    check(false, '제출 마감일이 지났습니다. 공식 접수 기록을 확인해 주세요.', activeStageActions.제안.publicBid)
  }
  check(known(plan.target), '대상 브랜드 또는 발주처 확인이 필요합니다.', '원문에서 브랜드 또는 발주처 확인')
  check(known(plan.demand), '제안할 이유와 수요 확인이 필요합니다.', '오픈·출시·리뉴얼 등 접근 근거 확인')
  check(known(plan.scope), '제안 가능한 업무 범위가 비어 있습니다.', '기획·공간·설계·시공·운영 중 수행 범위 확인')
  if (questions.length) {
    return { status: '추가 확인', reasons: questions.map(item => item.reason), nextAction: questions[0].action, nextDate: today }
  }

  const ready = publicBid
    ? '원문 주소·제출 마감일·참가 요건 확인 내용이 기록돼 있습니다.'
    : '대행 수요·미발주 범위·일정·연락 창구가 기록돼 있습니다.'
  const reasons = [ready]
  if (plan.decisionDate === today) reasons.push(publicBid ? '제출 마감일은 오늘입니다. 원문 마감 시각을 즉시 확인하세요.' : '대행사 선정 목표일은 오늘입니다. 남은 범위를 바로 확인하세요.')
  if (!known(plan.budget)) reasons.push(publicBid ? '배정 예산과 실제 제안 가능 금액을 확인하세요.' : '의사결정 가능 예산을 확인한 뒤 견적을 작성하세요.')
  return {
    status: '검토 우선', reasons,
    nextAction: activeStageActions[draft.stage][publicBid ? 'publicBid' : 'private'],
    nextDate: today,
  }
}

export function formatSalesPlan(draft: SalesDraft, plan: SalesPlanFields, today: string, ownerName?: string): string {
  const assessment = assessSalesPlan(draft, plan, today)
  const publicBid = draft.source === '나라장터'
  const notes = readSalesPlan(draft.description).notes
  const show = (value: string) => value.trim() || '미확인'
  const title = draft.title.trim() || plan.target.trim() || '영업 계획'
  const currentFollowUp = [draft.next_date ?? '', draft.next_action.trim()].filter(Boolean).join(' · ')
  const suggested = [assessment.nextDate ?? '', assessment.nextAction].filter(Boolean).join(' · ')
  const hasDecisionDate = validDate(plan.decisionDate) && validDate(today)
  const decisionDate = hasDecisionDate && plan.decisionDate >= today ? plan.decisionDate : ''
  const preparation = publicBid ? [
    '공고 원문과 정정 이력에서 참가 자격·제출 방식·증빙 확인',
    hasDecisionDate && plan.decisionDate < today
      ? '제안서와 가격입찰의 공식 접수 기록 확인'
      : `제안서와 견적을 검토하고 담당자가 공식 접수 확인${decisionDate ? ` (기록한 가장 이른 제출 마감일 ${decisionDate})` : ''}`,
    '평가 일정과 결과를 확인한 뒤 계약 조건 검토·프로젝트 인계',
  ] : [
    '담당자와 미발주 범위·오픈 일정·결정 예산 확인',
    `${draft.stage === '협상' ? '전달한 제안서·견적과 수정 요청 확인' : '협의한 범위로 제안서·견적을 전달하고 수신·결정 일정 확인'}${decisionDate ? ` (기록한 대행사 선정 목표일 ${decisionDate})` : ''}`,
    '수행 범위·일정·대금 및 취소 조건을 합의한 후 프로젝트 인계',
  ]
  return [
    title,
    `${SALES_COMPANIES[draft.division]} · ${draft.stage} · ${draft.source}${ownerName ? ` · 담당 ${ownerName}` : ''}`,
    '',
    '제안 계획',
    `대상 · ${show(plan.target)}`,
    `수요 · ${show(plan.demand)}`,
    `수행 범위 · ${show(plan.scope)}`,
    `오픈 목표일 · ${show(plan.targetDate)}`,
    `${publicBid ? '제출 마감일' : '대행사 선정 목표일'} · ${show(plan.decisionDate)}`,
    `${publicBid ? '입찰 참가 자격' : '발주 상태'} · ${publicBid ? plan.eligibility : plan.commitment}`,
    `고객·공고 예산 · ${show(plan.budget)}`,
    `예상 수주액 · ${draft.expected_amount === null ? '미확인' : `${draft.expected_amount.toLocaleString('ko-KR')}원`}`,
    `문의 창구 · ${show(plan.contact)}`,
    `확인 근거 · ${show(plan.evidence)}`,
    ...(draft.source_url ? [`원문 주소 · ${draft.source_url}`] : []),
    '',
    `자동 점검 · ${assessment.status} (${today})`,
    ...assessment.reasons.map(reason => `- ${reason}`),
    `권장 다음 행동 · ${suggested}`,
    `등록한 후속 연락 · ${currentFollowUp || '미정'}`,
    ...(assessment.status === '보류' ? [] : ['', '제안·수주 준비 순서', ...preparation.map((step, i) => `${i + 1}. ${step}`)]),
    ...(notes ? ['', '추가 메모', notes] : []),
  ].join('\n')
}
