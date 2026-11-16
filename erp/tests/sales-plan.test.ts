import test from 'node:test'
import assert from 'node:assert/strict'
import { newGrowth, type GrowthItem, type GrowthKind } from '../src/lib/growth.ts'
import { newSalesDraft, SALES_PAGE_SIZE, salesSummary, validateSales, type SalesDraft } from '../src/lib/sales.ts'
import { assessSalesPlan, emptySalesPlan, formatSalesPlan, readSalesPlan, reviewSalesQueue, seedSalesPlanFromCandidate, validateSalesPlan, writeSalesPlan } from '../src/lib/salesPlan.ts'

const today = '2026-11-14'
const draft = { ...newSalesDraft('owner'), title: '제품 체험 팝업', source_url: 'https://example.test/official' }
const candidate = (kind: GrowthKind): GrowthItem => ({
  ...newGrowth(kind, 'owner'), id: 'candidate', created_at: today, updated_at: today,
  revision: 1, created_by: 'owner', linked_sales_id: null,
})

const ready = () => ({
  ...emptySalesPlan(),
  target: '예시 브랜드',
  scope: '공간 설계와 제작',
  demand: '신제품 체험 팝업',
  commitment: '일부 미발주' as const,
  contact: '브랜드 공식 문의 양식',
  targetDate: '2027-03-10',
  decisionDate: '2026-12-15',
  evidence: '11월 14일 브랜드 공지와 담당자 회신으로 확인',
})

test('preserve existing free-form notes, line breaks and content when adding and removing a plan', () => {
  const notes = '기존 회의 기록\r\n제2안 “기획”\n\n'
  const plan = ready()
  assert.deepEqual(readSalesPlan(notes), { notes, plan: emptySalesPlan() })
  const stored = writeSalesPlan(notes, plan)
  assert.deepEqual(readSalesPlan(stored), { notes, plan })
  assert.doesNotMatch(stored.slice(notes.length), /"eligibility"/)
  assert.equal(writeSalesPlan(notes, emptySalesPlan()), notes)
  assert.equal(validateSales({ ...draft, description: stored }), null)
})

test('invalid dates can be retained while editing and are rejected for save', () => {
  const plan = { ...ready(), targetDate: '2026-11-01' }
  const stored = writeSalesPlan('메모', plan)
  assert.deepEqual(readSalesPlan(stored).plan, plan)
  assert.match(validateSalesPlan(plan) ?? '', /이후로/)
})

test('damaged or unrelated plan marker stays visible in original notes', () => {
  const notes = '회의 메모\n\n[WKLY_SALES_PLAN_V1]\n{"unrelated":true}'
  assert.deepEqual(readSalesPlan(notes), { notes, plan: emptySalesPlan() })
})

test('contact seeding uses explicit brand and contact, and leaves mail-derived demand and evidence unverified', () => {
  const lead = candidate('contact')
  const withContact = { ...lead, document: { ...lead.document, brand: ' 브랜드 ', email: 'contact@example.test', instagram: '@brand', note: '메일 자동 수집' } }
  assert.deepEqual(seedSalesPlanFromCandidate(withContact), { target: '브랜드', contact: 'contact@example.test · @brand' })
  const long = { ...withContact, document: { ...withContact.document, email: 'x'.repeat(220) } }
  assert.equal(seedSalesPlanFromCandidate(long).contact?.length, 200)
})

test('tender seeding uses KST date and recorded amount, and requires explicit eligibility evidence', () => {
  const tender = candidate('tender')
  const document = { ...tender.document, agency: '테스트 기관', deadline: '2026-11-14T18:30:00Z', amount: 12345000 }
  assert.deepEqual(seedSalesPlanFromCandidate({ ...tender, document: { ...document, qualification: '충족' } }), {
    target: '테스트 기관', decisionDate: '2026-11-15', budget: '공고 금액 12,345,000원',
  })
  assert.deepEqual(seedSalesPlanFromCandidate({ ...tender, document: { ...document, qualification: '충족', evidence: '공고 별첨의 면허 요건과 보유 면허 대조' } }), {
    target: '테스트 기관', decisionDate: '2026-11-15', budget: '공고 금액 12,345,000원',
    evidence: '공고 별첨의 면허 요건과 보유 면허 대조', eligibility: '충족',
  })
  assert.deepEqual(seedSalesPlanFromCandidate({ ...tender, document: { ...tender.document, qualification: '불충족', evidence: '필수 면허 없음', deadline: '2026-11-14T18:30:00' } }), {
    eligibility: '불충족', evidence: '필수 면허 없음',
  })
})

test('private engagement needs evidence, open scope and contact before priority review', () => {
  const incomplete = assessSalesPlan(draft, { ...ready(), contact: '미확인', commitment: '미확인' }, today)
  assert.equal(incomplete.status, '추가 확인')
  assert.ok(incomplete.reasons.some(reason => reason.includes('창구')))
  assert.match(incomplete.nextAction, /미발주/)
  assert.equal(incomplete.nextDate, today)
  const complete = assessSalesPlan(draft, ready(), today)
  assert.equal(complete.status, '검토 우선')
  assert.match(complete.nextAction, /미팅/)
  assert.ok(complete.reasons.some(reason => reason.includes('예산')))
  assert.equal(assessSalesPlan({ ...draft, source_url: '' }, ready(), today).status, '검토 우선')
  const event = { ...ready(), demand: '', evidence: '서울 열린데이터광장의 문화행사 공개 일정' }
  const eventAssessment = assessSalesPlan(draft, event, today)
  assert.equal(eventAssessment.status, '추가 확인')
  assert.match(eventAssessment.nextAction, /접근 근거 확인/)
})

test('completed scope or passed opening switches private lead to hold, elapsed selection requests a recheck', () => {
  assert.equal(assessSalesPlan(draft, { ...ready(), commitment: '발주 완료' }, today).status, '보류')
  assert.equal(assessSalesPlan(draft, { ...ready(), commitment: '발주 완료', evidence: '' }, today).status, '추가 확인')
  assert.equal(assessSalesPlan(draft, { ...ready(), decisionDate: '2026-10-15', targetDate: '2026-11-01' }, today).status, '보류')
  const elapsed = assessSalesPlan(draft, { ...ready(), decisionDate: '2026-11-01' }, today)
  assert.equal(elapsed.status, '추가 확인')
  assert.match(elapsed.nextAction, /선정 결과/)
})

test('public bid checks eligibility and earliest recorded deadline independently of private opportunity fields', () => {
  const tender = { ...draft, source: '나라장터' as const }
  const plan = { ...ready(), commitment: '미확인' as const, targetDate: '', contact: '', eligibility: '충족' as const, decisionDate: today }
  const assessed = assessSalesPlan(tender, plan, today)
  assert.equal(assessed.status, '검토 우선')
  assert.ok(assessed.reasons.some(reason => reason.includes('마감 시각을 즉시')))
  assert.equal(assessSalesPlan(tender, { ...plan, eligibility: '불충족' }, today).status, '보류')
  assert.equal(assessSalesPlan(tender, { ...plan, eligibility: '불충족', evidence: '' }, today).status, '추가 확인')
  assert.equal(assessSalesPlan(tender, { ...plan, decisionDate: '2026-11-13' }, today).nextDate, null)
  assert.equal(assessSalesPlan({ ...tender, source_url: '' }, plan, today).status, '추가 확인')
  assert.equal(assessSalesPlan({ ...tender, source_url: 'https:example.test' }, plan, today).status, '추가 확인')
})

test('printable output shows public provenance, current follow up and stored notes without metadata', () => {
  const stored = writeSalesPlan('기존 메모', ready())
  const output = formatSalesPlan({
    ...draft, source: '나라장터', description: stored, next_action: '원문 확인', next_date: today,
  }, ready(), today, '담당자')
  assert.match(output, /제출 마감일/)
  assert.match(output, /담당 담당자/)
  assert.match(output, /등록한 후속 연락 · 2026-11-14 · 원문 확인/)
  assert.match(output, /기존 메모/)
  assert.doesNotMatch(output, /WKLY_SALES_PLAN_V1/)
})

test('active stages get distinct private and official bid actions after missing facts are resolved', () => {
  const plan = { ...ready(), eligibility: '충족' as const }
  const stages = ['발굴', '접촉', '미팅', '제안', '협상'] as const
  const privateChecks = [/담당자에게 미팅을 제안/, /회신과 의사결정자/, /견적과 제안서에 반영/, /수신 여부와 결정/, /대금 지급·변경 및 취소/]
  const bidChecks = [/제출 담당·서류/, /공식 질의·현장설명/, /증빙 요건 대조/, /공식 접수 여부/, /공식 협상 안내/]
  for (const [i, stage] of stages.entries()) {
    assert.match(assessSalesPlan({ ...draft, stage }, plan, today).nextAction, privateChecks[i])
    assert.match(assessSalesPlan({ ...draft, source: '나라장터', stage }, plan, today).nextAction, bidChecks[i])
  }
  assert.match(assessSalesPlan({ ...draft, stage: '협상' }, { ...plan, evidence: '' }, today).nextAction, /직접 확인한 내용/)
  assert.match(assessSalesPlan({ ...draft, source: '나라장터', stage: '협상' }, { ...plan, eligibility: '미확인' }, today).nextAction, /제출 서류 요건/)
})

test('elapsed bid submission does not end a confirmed negotiation or imply delivery in proposal stage', () => {
  const tender = { ...draft, source: '나라장터' as const }
  const plan = { ...ready(), eligibility: '충족' as const, decisionDate: '2026-11-13' }
  const proposal = assessSalesPlan({ ...tender, stage: '제안' }, plan, today)
  assert.equal(proposal.status, '추가 확인')
  assert.match(proposal.nextAction, /공식 접수 여부/)
  assert.match(assessSalesPlan({ ...tender, stage: '협상' }, plan, today).nextAction, /대금 지급/)
  assert.match(assessSalesPlan({ ...draft, stage: '협상' }, plan, today).nextAction, /대금 지급/)
})

test('printable preparation steps distinguish the channel and only show recorded current dates', () => {
  const plan = ready()
  const privatePrint = formatSalesPlan(draft, plan, today)
  assert.match(privatePrint, /제안·수주 준비 순서\n1\. 담당자와 미발주/)
  assert.match(privatePrint, /2\. .*기록한 대행사 선정 목표일 2026-12-15\)/)
  assert.match(privatePrint, /3\. .*프로젝트 인계/)
  const tender = { ...draft, source: '나라장터' as const }
  const bidPrint = formatSalesPlan(tender, { ...plan, decisionDate: '' }, today)
  assert.match(bidPrint, /제안·수주 준비 순서\n1\. 공고 원문과 정정 이력/)
  assert.match(bidPrint, /2\. .*공식 접수 확인\n/)
  assert.doesNotMatch(bidPrint, /기록한 가장 이른 제출 마감일/)
  assert.doesNotMatch(formatSalesPlan({ ...tender, stage: '수주' }, plan, today), /제안·수주 준비 순서/)
})

const queueRow = (id: string, patch: Partial<SalesDraft> = {}) => salesSummary({
  ...draft, ...patch, id, revision: 1, created_by: 'owner', updated_by: 'owner', created_at: today, updated_at: today,
})

test('sales queue shows overdue and today before unscheduled work and then upcoming in chronological order', () => {
  const rows = [
    queueRow('upcoming-last', { next_date: '2026-12-01' }),
    queueRow('due-today', { next_date: today }),
    queueRow('upcoming-first', { next_date: '2026-11-15' }),
    queueRow('unset'),
    queueRow('due-yesterday', { next_date: '2026-11-13' }),
  ]
  const result = reviewSalesQueue(rows, today)
  assert.deepEqual(result.rows.map(({ row, kind }) => [row.id, kind]), [
    ['due-yesterday', 'due'], ['due-today', 'due'], ['unset', 'unscheduled'], ['upcoming-first', 'upcoming'], ['upcoming-last', 'upcoming'],
  ])
  assert.deepEqual(result.counts, { due: 2, unscheduled: 1, upcoming: 2, handoff: 0, closed: 0 })
  assert.equal(rows[0].id, 'upcoming-last')
})

test('handoff takes priority on request and acquisition excludes terminal stages regardless of their recorded dates', () => {
  const rows = [
    queueRow('already-linked', { stage: '수주', project_id: 'project', next_date: today }),
    queueRow('active', { next_date: today }),
    queueRow('lost', { stage: '실주', next_date: today }),
    queueRow('needs-link', { stage: '수주' }),
    queueRow('paused', { stage: '보류', next_date: today }),
  ]
  const all = reviewSalesQueue(rows, today)
  assert.equal(all.rows[0].row.id, 'active')
  assert.equal(all.counts.due, 1)
  assert.equal(all.counts.closed, 3)
  assert.equal(reviewSalesQueue(rows, today, 'handoff').rows[0].row.id, 'needs-link')
  assert.deepEqual(reviewSalesQueue(rows, today, 'intake').rows.map(({ row }) => row.id), ['active'])
})

test('sales queue counts and sorting are bounded by the loaded sales page', () => {
  const page = Array.from({ length: SALES_PAGE_SIZE }, (_, index) => queueRow(`unset-${index}`))
  const extra = queueRow('outside-page', { next_date: today })
  const result = reviewSalesQueue([...page, extra], today)
  assert.equal(result.rows.length, SALES_PAGE_SIZE)
  assert.equal(result.counts.unscheduled, SALES_PAGE_SIZE)
  assert.equal(result.counts.due, 0)
  assert.equal(result.rows.at(-1)?.row, page.at(-1))
})
