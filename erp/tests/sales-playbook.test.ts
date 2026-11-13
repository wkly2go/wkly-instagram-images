import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SALES_STAGES, newSalesDraft } from '../src/lib/sales.ts'
import { getSalesPlaybook, salesPlaybookActionPatch } from '../src/lib/salesPlaybook.ts'

test('each track provides actionable guidance for every stage without completion or probability fields', () => {
  for (const variant of [{ division: 'TW', source: '직접 발굴' }, { division: 'AR', source: '직접 발굴' }, { division: 'AR', source: '나라장터' }] as const) {
    for (const stage of SALES_STAGES) {
      const draft = { ...newSalesDraft('owner'), ...variant, stage }
      const guide = getSalesPlaybook(draft)
      assert.equal(guide.stage, stage)
      assert.ok(guide.goal && guide.nextStep && guide.nextAction)
      assert.ok(guide.actions.length >= 3 && guide.evidence.length >= 2)
      assert.ok(guide.nextAction.length <= 500)
      assert.equal('completed' in guide, false); assert.equal('probability' in guide, false)
      assert.equal(guide.handoff.length > 0, stage === '수주')
    }
  }
})
test('public source takes precedence over AR division, while space and content keep distinct tasks', () => {
  const base = newSalesDraft('owner')
  assert.equal(getSalesPlaybook(base).track, 'content')
  assert.equal(getSalesPlaybook({ ...base, division: 'AR' }).track, 'space')
  assert.equal(getSalesPlaybook({ ...base, division: 'AR', source: '나라장터' }).track, 'public')
  assert.match(getSalesPlaybook({ ...base, division: 'AR', stage: '미팅' }).actions.join(' '), /실측.*전기/)
  assert.match(getSalesPlaybook({ ...base, stage: '미팅' }).actions.join(' '), /사용 권리/)
})
test('public guide separates deadlines, formal questions and actual contract evidence', () => {
  const base = { ...newSalesDraft('owner'), source: '나라장터' as const }
  assert.match(getSalesPlaybook(base).actions.join(' '), /정정.*취소.*재공고/)
  assert.match(getSalesPlaybook(base).actions.join(' '), /질의.*참가 등록.*가격 입찰.*제안서 제출/)
  assert.match(getSalesPlaybook({ ...base, stage: '접촉' }).actions.join(' '), /공식 답변/)
  assert.match(getSalesPlaybook({ ...base, stage: '협상' }).actions.join(' '), /낙찰·우선협상.*계약 체결 근거/)
  assert.match(getSalesPlaybook({ ...base, stage: '제안' }).actions.join(' '), /담당자가 공식 시스템/)
})
test('won guides require evidence and handoff, and distinguish connected from missing project', () => {
  const draft = { ...newSalesDraft('owner'), stage: '수주' as const }
  assert.match(getSalesPlaybook(draft).handoff.join(' '), /계약·발주 확정 근거/)
  assert.match(getSalesPlaybook(draft).handoff.join(' '), /프로젝트 메뉴.*준비 후 연결/)
  assert.match(getSalesPlaybook({ ...draft, project_id: 'existing' }).handoff.join(' '), /연결 프로젝트.*일치 여부 확인/)
  for (const stage of ['실주', '보류'] as const) assert.match(getSalesPlaybook({ ...draft, stage }).nextStep, /검토/)
})
test('example application only patches next_action and leaves dates, evidence, stage and project untouched', () => {
  const draft = { ...newSalesDraft('owner'), title: '보존', next_date: '2026-12-01', description: '원문', source_url: 'https://example.com', expected_amount: 12000 }
  const before = JSON.stringify(draft)
  const patch = salesPlaybookActionPatch(draft, () => { throw new Error('empty action requires no confirmation') })
  assert.deepEqual(Object.keys(patch!), ['next_action'])
  assert.equal(patch!.next_action, getSalesPlaybook(draft).nextAction)
  assert.equal(JSON.stringify(draft), before)
  const changed = { ...draft, ...patch }
  for (const key of ['next_date', 'description', 'source_url', 'stage', 'project_id', 'expected_amount'] as const) assert.equal(changed[key], draft[key])
})
test('declined replacement, disabled use and repeated application make no changes', () => {
  const draft = { ...newSalesDraft('owner'), next_action: '고객과 합의한 행동' }
  let confirms = 0
  assert.equal(salesPlaybookActionPatch(draft, () => { confirms++; return false }), null)
  assert.equal(confirms, 1)
  assert.ok(salesPlaybookActionPatch(draft, () => true))
  assert.equal(salesPlaybookActionPatch(draft, () => { throw new Error('disabled') }, true), null)
  const applied = { ...draft, next_action: getSalesPlaybook(draft).nextAction }
  assert.equal(salesPlaybookActionPatch(applied, () => { throw new Error('same action') }), null)
})
test('returned lists cannot mutate later guidance or caller data', () => {
  const draft = { ...newSalesDraft('owner'), stage: '수주' as const }
  const first = getSalesPlaybook(draft)
  ;(first.actions as string[]).push('external mutation')
  ;(first.evidence as string[]).length = 0
  ;(first.handoff as string[]).length = 0
  const next = getSalesPlaybook(draft)
  assert.equal(next.actions.includes('external mutation'), false)
  assert.ok(next.evidence.length > 0 && next.handoff.length > 0)
})
