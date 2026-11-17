import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCostSheet } from '../src/lib/designCost.ts'
import type { XlsxBook } from '../src/lib/xlsx.ts'

test('reads the goods list format (위치 | 기자재 | 수량 | 단가 | 총금액 | 업체)', () => {
  const book: XlsxBook = { sheets: [{ name: '실행가', rows: [
    ['위치', '기자재/물품', '수량', '단가', '총금액', '업체', '비고'],
    ['입구', '포토월', 1, 300000, 300000, '강남렌탈', ''],
    [null, '거울', 2, 50000, 100000, '구매 (쿠팡)', '직접 구매'],
  ] }] }
  const s = parseCostSheet(book)!
  assert.equal(s.rows.length, 2)
  assert.equal(s.total, 400000)
  assert.equal(s.sheetTotal, 400000)
  assert.equal(s.rows[1].zone, '입구')
  assert.equal(s.rows[0].vendor_name, '강남렌탈')
})

test("reads the company execution sheet (실행 내역 · 실행 단가 · 발주처) and skips the summary sheet", () => {
  const book: XlsxBook = { sheets: [
    { name: '요약', rows: [['KPI', '값'], ['최종 공급가액', null]] },
    { name: '실행집행 내역', rows: [
      ['AR0000 — 실행집행 내역서'],
      [],
      ['No', '구분', '견적 항목', '견적 금액', '실행 내역', '단위', '수량', '실행 단가', '실행 금액', '원가 출처', '발주처', '항목 실행원가', '이익', '마진율', '근거·확인'],
      [1, '01 설계', '실시 설계', 2200000, '디자이너 투입', '일', 8, 200000, null, '내부배분', '내부', null, null, null, '200,000/일'],
      [2, '02 카운터', '카운터 리폼', 8500000, '대리석 상판', '식', 1, 3400000, null, '가정', '석재업체', null, null, null, '견적 필요'],
      [null, null, null, null, '목공 기공', '인', 4, 400000, null, '과거단가', '목공팀'],
      [null, null, null, null, '도료', '식', 1, 200000, null, '가정', '미정'],
      [null, null, '견적 항목 합계 (공급가액)'],
    ] },
  ] }
  const s = parseCostSheet(book)!
  assert.equal(s.sheet, '실행집행 내역')
  assert.equal(s.rows.length, 4)
  assert.equal(s.total, 1600000 + 3400000 + 1600000 + 200000)
  assert.equal(s.rows[0].item, '디자이너 투입')
  assert.equal(s.rows[0].vendor_name, null, "'내부' is not a vendor")
  assert.equal(s.rows[2].zone, '02 카운터', 'group carried down')
  assert.equal(s.rows[2].note, '[카운터 리폼]')
  assert.equal(s.rows[2].unit, '인')
  assert.equal(s.rows[3].vendor_name, null, "'미정' is not a vendor")
})
