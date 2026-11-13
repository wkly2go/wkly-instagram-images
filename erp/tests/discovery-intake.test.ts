import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDiscoveryReport } from '../src/lib/discoveryIntake.ts'

const today = '2026-11-13'
const contact = { kind: 'contact', title: '테스트 전용 브랜드 영업 후보', target: '가상 테스트 브랜드', source_url: 'https://example.com/test', verified_on: today, evidence: '가상 테스트 공지', need: '테스트 방문 문의', offer: '테스트 콘텐츠 제안', next_action: '테스트 일정 확인', email: 'test@example.com' }
const tender = { ...contact, kind: 'tender', title: '테스트 전용 공고', target: '가상 테스트 기관', number: 'TEST-001', round: '00', deadline: '2026-11-20T18:00:00+09:00', amount: 12345678 }
const parse = (value: unknown, kind: 'contact' | 'tender' = 'contact') => parseDiscoveryReport(JSON.stringify(value), kind, 'owner', today)

test('research provenance and opportunity hypothesis survive contact intake without confirming the prospect', () => {
  const row = parse({ ...contact, relationship: '기존 문의', division: 'AR', contact_name: '테스트 부서' })[0]
  assert.equal(row.error, ''); assert.equal(row.draft?.status, '검토'); assert.equal(row.draft?.owner_id, 'owner')
  assert.equal(row.draft?.document.source, '에이전트 리서치'); assert.equal(row.draft?.document.division, 'AR')
  for (const value of [contact.evidence, contact.need, contact.offer, contact.next_action, today, '기존 문의']) assert.ok(row.draft?.document.note.includes(value))
})
test('tender budget and identifier remain exact but imported eligibility never becomes approved', () => {
  const row = parse({ ...tender, qualification: '충족', status: '제출', owner_id: 'other', deadlines: '테스트 서류 11시 / 가격 14시' }, 'tender')[0]
  assert.equal(row.error, ''); assert.equal(row.draft?.document.amount, 12345678)
  assert.equal(row.draft?.document.qualification, '추가 확인'); assert.equal(row.draft?.status, '검토')
  assert.equal(row.draft?.owner_id, 'owner'); assert.equal(row.draft?.document.number, 'TEST-001')
  for (const value of [tender.deadline, tender.number, '12345678원', '테스트 서류 11시 / 가격 14시']) assert.ok(row.draft?.document.note.includes(value))
})
test('mixed invalid rows remain visible and do not prevent valid rows previewing', () => {
  const rows = parse([contact, { ...contact, email: '', instagram: '' }, null, tender])
  assert.equal(rows.length, 4); assert.equal(rows.filter(x => x.draft).length, 1)
  assert.ok(rows.slice(1).every(x => x.error && !x.draft))
})
test('intake rejects unsafe URLs, missing proof, future and invalid verification dates', () => {
  for (const patch of [{ source_url: 'javascript:alert(1)' }, { source_url: 'https://user:secret@example.com' }, { evidence: '' }, { need: '' }, { verified_on: '2026-11-14' }, { verified_on: '2026-02-30' }]) assert.ok(parse({ ...contact, ...patch })[0].error)
})
test('input limits and duplicate identities are explicit, never silently truncated', () => {
  assert.throws(() => parse(Array(21).fill(contact)), /1~20/)
  assert.throws(() => parse([]), /1~20/)
  assert.throws(() => parseDiscoveryReport(' '.repeat(150001), 'contact', 'owner', today), /150,000/)
  assert.throws(() => parseDiscoveryReport('{bad}', 'contact', 'owner', today), /JSON/)
  const rows = parse([contact, { ...contact, email: 'TEST@EXAMPLE.COM' }])
  assert.ok(rows[0].draft); assert.match(rows[1].error, /중복/)
  assert.ok(parse([{ ...tender }, { ...tender }], 'tender')[1].error)
})
test('expired or stale research stays a warning and unknown deadlines and amounts stay unknown', () => {
  const row = parse({ ...tender, deadline: '2026-11-01T18:00:00+09:00', verified_on: '2026-10-01' }, 'tender')[0]
  assert.ok(row.draft); assert.equal(row.warnings.length, 3)
  const unknown = parse({ ...tender, deadline: '', amount: null }, 'tender')[0]
  assert.ok(unknown.draft); assert.equal(unknown.draft?.document.amount, null); assert.equal(unknown.draft?.document.deadline, '')
})
test('invalid deadline calendar dates and ambiguous currency strings require correction', () => {
  for (const patch of [{ deadline: '2026-02-30T18:00:00+09:00' }, { deadline: '2026-11-20T25:00:00+09:00' }, { deadline: '2026-11-20T18:00:00' }, { amount: '10,000원' }, { amount: 0.5 }, { amount: -1 }]) assert.ok(parse({ ...tender, ...patch }, 'tender')[0].error)
})
