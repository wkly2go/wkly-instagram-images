import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewSalesCandidate, type CandidateReviewInput } from '../src/lib/salesCandidateReview.ts'
const now = Date.parse('2026-11-14T09:00:00+09:00')
const contact = (patch: Partial<CandidateReviewInput> = {}): CandidateReviewInput => ({ kind: 'contact', title: '팝업 문의 제목만 있는 후보', status: '검토', linked_sales_id: null, source: '받은 메일', segment: '미분류', ...patch })
const tender = (patch: Partial<CandidateReviewInput> = {}): CandidateReviewInput => ({ kind: 'tender', title: '테스트 전시 행사', status: '검토', linked_sales_id: null, deadline: '2026-11-15T18:00:00+09:00', qualification: '추가 확인', ...patch })
test('mail title keywords only classify topic and never infer purchase intent or readiness', () => {
 const result = reviewSalesCandidate(contact(), now)!
 assert.equal(result.focus, 'popup'); assert.equal(result.bucket, 'verify'); assert.equal(result.source, 'mail')
 assert.ok(result.reasons.some(x => x.includes('구매 의사'))); assert.equal('score' in result, false)
 assert.equal(reviewSalesCandidate(contact({ title: '구매 확정·1억 발주' }), now)?.bucket, 'verify')
})
test('research and manual candidates remain unverified until recorded human confirmation', () => {
 for(const source of ['에이전트 리서치', '직접 등록']){
  const result = reviewSalesCandidate(contact({ source, segment: '팝업·공간' }), now)!
  assert.equal(result.bucket, 'verify'); assert.equal(result.focus, 'popup')
  assert.equal(reviewSalesCandidate(contact({ source, status: '확인' }), now)?.bucket, 'ready')
 }
})
test('linked and excluded candidates are never recommended as new outreach', () => {
 assert.equal(reviewSalesCandidate(contact({ linked_sales_id: 'sales' }), now)?.bucket, 'linked')
 assert.equal(reviewSalesCandidate(contact({ status: '제외' }), now)?.bucket, 'closed')
 assert.equal(reviewSalesCandidate(tender({ status: '취소' }), now)?.bucket, 'closed')
 assert.equal(reviewSalesCandidate(tender({ status: '제출' }), now)?.bucket, 'closed')
})
test('deadline equality and UTC/KST rollover use exact instants', () => {
 const expired = reviewSalesCandidate(tender({ deadline: '2026-11-14T00:00:00Z' }), now)!
 assert.equal(expired.bucket, 'expired'); assert.equal(expired.deadline, '2026-11-14T09:00:00+09:00')
 assert.equal(reviewSalesCandidate(tender({ deadline: '2026-11-14T00:00:01Z' }), now)?.bucket, 'verify')
 assert.equal(reviewSalesCandidate(tender({ deadline: '2026-11-13T23:59:59Z' }), now)?.bucket, 'expired')
})
test('malformed, missing and timezone-free deadlines cannot imply readiness', () => {
 for(const deadline of ['', null, '2026-11-15T18:00', '2026-02-30T18:00:00+09:00', '2026-11-15T25:00:00+09:00']){
  const result = reviewSalesCandidate(tender({ deadline, qualification: '충족' }), now)!
  assert.equal(result.deadline, null); assert.equal(result.bucket, 'verify'); assert.ok(result.reasons.includes('마감 시각·시간대 미확인'))
 }
})
test('qualification recorded as met still requires official proof; failure blocks recommendation', () => {
 const ready = reviewSalesCandidate(tender({ qualification: '충족' }), now)!
 assert.equal(ready.bucket, 'ready'); assert.ok(ready.reasons.some(x => x.includes('증빙 재확인')))
 assert.ok(ready.reasons.some(x => x.includes('공고 원문·첨부 근거')))
 assert.equal(reviewSalesCandidate(tender({ qualification: '불충족' }), now)?.bucket, 'blocked')
 assert.equal(reviewSalesCandidate(tender({ qualification: 'unknown' }), now)?.bucket, 'verify')
})
test('no content review or private free-text is copied into compact review', () => {
 assert.equal(reviewSalesCandidate({ ...contact(), kind: 'content' }, now), undefined)
 const result = reviewSalesCandidate(contact({ source: 'private@example.com', segment: 'private memo' }), now)!
 assert.equal(result.source, 'other'); assert.ok(!JSON.stringify(result).includes('private'))
 assert.ok(result.label); assert.ok(result.nextAction); assert.ok(result.reasons.length <= 3)
})
