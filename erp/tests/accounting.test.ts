// 경리 · 회계 고도화 (장부 › 세무 · 결산) 계산 규칙 시험
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyPurchase, currentVatPeriod, recentVatPeriods, summaryChecks, vatPeriod, vatPrep } from '../src/lib/acctVat.ts'
import { agingTable, bucketOf, openInvoices, reminderText } from '../src/lib/acctAging.ts'
import { accountBalances, cashPlan, paymentDelays, recurringFlows } from '../src/lib/acctCash.ts'
import { balanceChain, closeReport } from '../src/lib/acctClose.ts'
import { buildJournal, cashAccount, expenseAccount, groupOf, trialBalance, CARD_PAYABLE, TRANSFER } from '../src/lib/acctJournal.ts'
import { dLabel, lastBalanceRow, monthRange, orderDay, vatIn } from '../src/lib/acct.ts'
import type { LedgerEntry, LedgerRecurring, Payment, TaxInvoice, TaxInvoiceSummary } from '../src/lib/types.ts'

let seq = 1
const L = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: seq++, company: 'AR', entry_date: '2026-10-05', direction: '출금', amount: 11000, category: '재료 · 소품', counterparty: '가게', method: '카드', memo: null,
  project_id: null, account: '우리카드', source: '은행', source_ref: null, supply: null, vat: null, evidence: null, balance_after: null, is_transfer: false, needs_review: false,
  file_id: null, created_by: 'u', created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z', ...over,
})
const T = (over: Partial<TaxInvoice>): TaxInvoice => ({
  id: `t${seq++}`, approval_no: `A${seq}`, direction: '매출', write_date: '2026-10-10', issue_date: null, our_biz_no: '302-88-02334', our_name: '주식회사 아트리어디자인스튜디오',
  partner_biz_no: '111-11-11111', partner_name: '거래처', partner_email: null, total: 1_100_000, supply: 1_000_000, vat: 100_000, receipt_kind: null, invoice_kind: '일반', item: '디자인',
  note: null, project_id: null, payment_id: null, memo: null, settled: 0, ledger_ids: [], settle_how: null, settled_at: '2026-11-01T00:00:00Z', created_at: '2026-10-10T00:00:00Z', ...over,
})
const P = (over: Partial<Payment>): Payment => ({
  id: `p${seq++}`, direction: '수금', project_id: null, client_id: null, budget_line_id: null, approval_id: null, category: null, title: '잔금', payee: '고객사', contract_type: '세금계산서',
  stage: null, amount: 10_000_000, vat: 909_091, tax_invoice: '발행', tax_invoice_date: null, status: '청구', is_estimate: false, requested_date: null, due_date: '2026-12-10', paid_date: null,
  advance_by: null, bank_name: null, account_no: null, account_holder: null, memo: null, created_by: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
})

test('과세기간: 예정신고 법인은 분기, 예정고지 법인의 확정은 반기 전체', () => {
  const q4 = vatPeriod(2026, 4, '예정신고')
  assert.equal(q4.key, 'vat:2026-Q4')
  assert.equal(q4.from, '2026-10-01')
  assert.equal(q4.to, '2026-12-31')
  assert.equal(q4.filing, '확정 신고')
  assert.match(q4.label, /2기 확정 \(10~12월\)/)
  const q4g = vatPeriod(2026, 4, '예정고지')
  assert.equal(q4g.from, '2026-07-01')
  assert.equal(vatPeriod(2026, 3, '예정고지').filing, '예정고지 납부')
  assert.equal(vatPeriod(2026, 1, '예정신고').to, '2026-03-31')
  assert.equal(currentVatPeriod('2026-11-27', '예정신고').key, 'vat:2026-Q4')
  assert.deepEqual(recentVatPeriods('2026-02-10', '예정신고', 3).map(p => p.key), ['vat:2026-Q1', 'vat:2025-Q4', 'vat:2025-Q3'])
})

test('카드 매입 분류: 해외 · 접대 · 차량 · 여객 · 면세 · 일반', () => {
  assert.equal(classifyPurchase({ counterparty: 'FIGMA', memo: null, category: '구독 · 소프트웨어' }).cls, '부가세 없음')
  assert.equal(classifyPurchase({ counterparty: 'FACEBK*RP75FPM442', memo: null, category: '광고비' }).cls, '부가세 없음')
  assert.equal(classifyPurchase({ counterparty: '○○컨트리클럽', memo: null, category: '식대 · 경비' }).cls, '불공제 후보')
  assert.equal(classifyPurchase({ counterparty: 'GS칼텍스 셀프주유소', memo: null, category: '교통 · 운반' }).cls, '불공제 후보')
  assert.equal(classifyPurchase({ counterparty: '카카오T 택시', memo: null, category: '교통 · 운반' }).cls, '불공제 후보')
  assert.equal(classifyPurchase({ counterparty: '번개퀵서비스', memo: null, category: '교통 · 운반' }).cls, '공제 후보')
  assert.equal(classifyPurchase({ counterparty: '어디론가', memo: null, category: '교통 · 운반' }).cls, '확인 필요')
  assert.equal(classifyPurchase({ counterparty: '튼튼약국', memo: null, category: '식대 · 경비' }).cls, '부가세 없음')
  assert.equal(classifyPurchase({ counterparty: '가게', memo: null, category: '보험료' }).cls, '부가세 없음')
  assert.equal(classifyPurchase({ counterparty: '김밥천국', memo: null, category: '식대 · 경비' }).cls, '공제 후보')
  assert.equal(classifyPurchase({ counterparty: '오피스디포', memo: null, category: '재료 · 소품' }).cls, '공제 후보')
  assert.equal(classifyPurchase({ counterparty: '모름', memo: null, category: '기타 출금' }).cls, '확인 필요')
  assert.equal(vatIn(11_000), 1_000)
})

test('부가세 준비: 계산서 · 카드 공제 후보 · 짝지어진 줄 제외 · 범위 순서', () => {
  const linkedRow = L({ id: 900, method: '계좌', account: '기업', amount: 2_200_000, category: '외주 · 협력사', evidence: '세금계산서' })
  const ledger = [
    L({ amount: 110_000, counterparty: '문구점' }), // 공제 후보 10,000
    L({ amount: 55_000, counterparty: 'GS칼텍스 주유소', category: '교통 · 운반' }), // 불공제 5,000
    L({ amount: 33_000, counterparty: 'FIGMA', category: '구독 · 소프트웨어' }), // 부가세 없음
    L({ amount: 22_000, counterparty: '알수없음', category: '기타 출금' }), // 확인 필요 2,000
    L({ amount: 11_000, counterparty: '문구점', direction: '입금', category: '이자 · 환급' }), // 카드 취소 −1,000
    L({ amount: 990_000, method: '계좌', account: '기업', category: '매출 · 용역', direction: '입금', counterparty: '계산서없는고객' }), // 계산서 없는 매출
    L({ amount: 1_000, entry_date: '2026-09-30', counterparty: '문구점' }), // 기간 밖
    linkedRow,
  ]
  const invoices = [
    T({ direction: '매출', total: 11_000_000, supply: 10_000_000, vat: 1_000_000 }),
    T({ direction: '매입', total: 2_200_000, supply: 2_000_000, vat: 200_000, ledger_ids: [900], partner_name: '목공소' }),
    T({ direction: '매입', total: 330_000, supply: 300_000, vat: 30_000, item: '승용차 리스료' }),
    T({ direction: '매출', write_date: '2026-09-30', total: 99_000, supply: 90_000, vat: 9_000 }), // 기간 밖
    T({ direction: '매출', our_biz_no: '218-87-03900', our_name: '더위클리컴퍼니', total: 1_100, supply: 1_000, vat: 100 }), // 다른 회사
  ]
  const prep = vatPrep({ company: 'AR', period: vatPeriod(2026, 4, '예정신고'), invoices, ledger, today: '2027-01-05', filing: '예정신고' })
  assert.equal(prep.sales.count, 1)
  assert.equal(prep.outputTax, 1_000_000)
  assert.equal(prep.buys.vat, 230_000)
  assert.equal(prep.inputTaxNondeduct, 30_000)
  assert.equal(prep.inputTax, 200_000)
  assert.ok(!prep.purchases.some(p => p.id === 900), '세금계산서와 짝지어진 줄은 카드 공제에서 빠짐')
  assert.equal(prep.byClass['공제 후보'].vat, 10_000 - 1_000)
  assert.equal(prep.byClass['불공제 후보'].vat, 5_000)
  assert.equal(prep.byClass['부가세 없음'].vat, 0)
  assert.equal(prep.byClass['확인 필요'].vat, 2_000)
  assert.equal(prep.uninvoiced.length, 1)
  assert.equal(prep.expected, 1_000_000 - 200_000 - 9_000)
  assert.equal(prep.low, 1_000_000 - 230_000 - 9_000 - 2_000)
  assert.equal(prep.high, 1_000_000 - 200_000)
  assert.ok(prep.low <= prep.expected && prep.expected <= prep.high)
  assert.equal(prep.open, false)
  assert.ok(prep.questions.some(q => q.includes('차종')))
  assert.ok(prep.questions.some(q => q.includes('짝이 없는 매출')))
  // 기간 중이면 열린 기간
  assert.equal(vatPrep({ company: 'AR', period: vatPeriod(2026, 4, '예정신고'), invoices, ledger, today: '2026-11-27', filing: '예정신고' }).open, true)
})

test('홈택스 합계표 대조: 거래처(사업자번호)별 차이', () => {
  const invoices = [T({ partner_biz_no: '1', total: 100 }), T({ partner_biz_no: '2', total: 50 })]
  const sums: TaxInvoiceSummary[] = [
    { id: 1, direction: '매출', period_from: '2026-07-01', period_to: '2026-12-31', partner_biz_no: '1', partner_name: 'A', count: 1, supply: 0, vat: 0, total: 100, file_name: null, uploaded_at: '' },
    { id: 2, direction: '매출', period_from: '2026-07-01', period_to: '2026-12-31', partner_biz_no: '3', partner_name: 'C', count: 2, supply: 0, vat: 0, total: 70, file_name: null, uploaded_at: '' },
  ]
  const [c] = summaryChecks(invoices, sums, 'AR', vatPeriod(2026, 4, '예정신고'))
  assert.equal(c.hometaxTotal, 170)
  assert.equal(c.mineTotal, 150)
  assert.deepEqual(c.diffs.map(d => d.biz).sort(), ['2', '3'])
})

test('미수 연령표: 구간 · 대사 반영 · 사업자번호로만 묶음', () => {
  assert.deepEqual([0, 30, 31, 60, 61, 90, 91].map(bucketOf), [0, 0, 1, 1, 2, 2, 3])
  const invoices = [
    T({ write_date: '2026-11-20', total: 1_000, settled: 0, partner_biz_no: '1', partner_name: '가' }),
    T({ write_date: '2026-09-01', total: 2_000, settled: 500, partner_biz_no: '1', partner_name: '가 (주)' }),
    T({ write_date: '2026-06-01', total: 3_000, settled: 3_000, partner_biz_no: '2' }), // 다 받음
    T({ write_date: '2026-06-01', total: -1_000, partner_biz_no: '2' }), // 마이너스 수정
    T({ write_date: '2026-07-01', total: 4_000, settle_how: '수정 발행 취소', partner_biz_no: '3' }),
    T({ write_date: '2026-07-01', total: 5_000, partner_biz_no: '4', direction: '매입' }),
  ]
  const items = openInvoices(invoices, '매출', '2026-11-27', 'AR')
  assert.equal(items.length, 2)
  const t = agingTable(items)
  assert.equal(t.rows.length, 1, '사업자번호가 같으면 한 줄')
  assert.equal(t.total, 1_000 + 1_500)
  assert.deepEqual(t.totals, [1_000, 0, 1_500, 0])
  assert.match(reminderText(t.rows[0], '아트리어'), /합계 2,500원/)
})

test('자금 계획: 통장 잔액 · 오래된 통장 · 대출 제외 · 지연 반영 · 카드 구독 제외', () => {
  const ledger = [
    L({ method: '계좌', account: '기업', entry_date: '2026-11-20', balance_after: 5_000_000 }),
    L({ method: '계좌', account: '기업', entry_date: '2026-11-25', balance_after: 4_000_000 }),
    L({ method: '계좌', account: '우리 5091', entry_date: '2026-09-19', balance_after: 1_000_000 }),
    L({ method: '계좌', account: '기업 대출', entry_date: '2026-11-25', balance_after: 999 }),
  ]
  const acc = accountBalances(ledger, '2026-11-27')
  assert.equal(acc.find(a => a.account === '기업')?.balance, 4_000_000)
  assert.equal(acc.find(a => a.account === '우리 5091')?.stale, true)
  assert.equal(acc.find(a => a.account === '기업 대출')?.excluded, true)
  const payments = [
    P({ payee: '느린고객', status: '완료', due_date: '2026-06-01', paid_date: '2026-06-21' }),
    P({ payee: '느린고객', status: '완료', due_date: '2026-07-01', paid_date: '2026-07-21' }),
    P({ payee: '느린고객', amount: 3_000_000, due_date: '2026-12-10' }), // 기대 12-30, 낮음 01-09
    P({ payee: '밀린고객', amount: 2_000_000, due_date: '2026-10-01' }), // 57일 지남
    P({ payee: '날짜없음', amount: 7_000_000, due_date: null }),
    P({ direction: '지급', status: '대기', amount: 1_500_000, due_date: '2026-12-04', payee: '목공소' }),
  ]
  const d = paymentDelays(payments)
  assert.equal(d.byPayee.get('느린고객'), 20)
  const rec: LedgerRecurring[] = [
    { id: 1, name: '사무실 임대료', amount: 1_000_000, day_of_month: 2, category: '임대료', counterparty: null, method: '계좌', memo: null, active: true, start_month: null, end_month: null, created_by: 'u', created_at: '', updated_at: '' },
    { id: 2, name: '구독', amount: 50_000, day_of_month: 3, category: '구독 · 소프트웨어', counterparty: null, method: '카드', memo: null, active: true, start_month: null, end_month: null, created_by: 'u', created_at: '', updated_at: '' },
  ]
  assert.equal(recurringFlows(rec, '2026-11-27', 90).length, 3, '카드로 나가는 구독은 빼고 임대료 3번')
  const plan = cashPlan({ today: '2026-11-27', ledger, payments, recurring: rec })
  assert.equal(plan.opening, 4_000_000 + 1_000_000)
  const slow = plan.flows.find(f => f.who === '느린고객')!
  assert.equal(slow.exp, '2026-12-30')
  assert.equal(slow.low, '2027-01-09')
  const late = plan.flows.find(f => f.who === '밀린고객')!
  assert.equal(late.overdue, true)
  assert.equal(late.low, null)
  assert.equal(plan.undated.length, 1)
  const b30 = plan.buckets[0]
  assert.equal(b30.inHigh, 3_000_000 + 2_000_000)
  assert.equal(b30.inLow, 0)
  assert.equal(b30.out, 1_500_000 + 1_000_000) // 지급 + 12/2 임대료
  assert.equal(plan.buckets[2].endExp, 5_000_000 + 5_000_000 - 1_500_000 - 3_000_000)
  assert.ok(plan.risks.some(r => r.includes('오래된 통장')))
})

test('통장 잔액 이어짐: 같은 날 순서가 바뀌어도 맞고, 빠진 거래는 끊김으로', () => {
  const rows = [
    L({ id: 1, method: '계좌', account: '기업', entry_date: '2026-09-30', direction: '입금', amount: 100, balance_after: 1_000 }),
    L({ id: 3, method: '계좌', account: '기업', entry_date: '2026-10-01', direction: '출금', amount: 50, balance_after: 1_150 }),
    L({ id: 2, method: '계좌', account: '기업', entry_date: '2026-10-01', direction: '입금', amount: 200, balance_after: 1_200 }),
    L({ id: 4, method: '계좌', account: '기업', entry_date: '2026-10-02', direction: '출금', amount: 100, balance_after: 900 }), // 150 빠짐
  ]
  const r = balanceChain(rows, '기업', '2026-10')
  assert.equal(r.rows, 3)
  assert.equal(r.breaks.length, 1)
  assert.equal(r.breaks[0].id, 4)
  assert.equal(r.breaks[0].diff, -150)
})

test('은행 파일 순서(같은 날 최근 거래가 위): 잔액으로 시간 순서를 다시 맞춤', () => {
  // 같은 날 장부 번호가 작을수록 나중 거래 (은행 파일이 최근 것부터 적혀 있음)
  const rows = [
    L({ id: 20, method: '계좌', account: 'A', entry_date: '2026-11-05', direction: '입금', amount: 500, balance_after: 1_500 }),
    L({ id: 19, method: '계좌', account: 'A', entry_date: '2026-11-05', direction: '출금', amount: 300, balance_after: 1_200 }),
    L({ id: 12, method: '계좌', account: 'A', entry_date: '2026-11-10', direction: '출금', amount: 100, balance_after: 1_100 }),
    L({ id: 11, method: '계좌', account: 'A', entry_date: '2026-11-10', direction: '출금', amount: 50, balance_after: 1_050 }),
    L({ id: 10, method: '계좌', account: 'A', entry_date: '2026-11-10', direction: '출금', amount: 25, balance_after: 1_025 }),
  ]
  assert.equal(lastBalanceRow(rows)?.balance_after, 1_025, '그날 마지막 거래는 번호가 가장 작은 줄')
  assert.equal(accountBalances(rows, '2026-11-12')[0].balance, 1_025)
  assert.equal(balanceChain(rows, 'A', '2026-11').breaks.length, 0)
  assert.deepEqual(orderDay(rows.slice(2), null).ordered.map(r => r.id), [12, 11, 10])
  assert.deepEqual(orderDay(rows.slice(0, 2), null).ordered.map(r => r.id), [20, 19])
})

test('월마감 점검: 증빙 없는 3만 원 넘는 지출 · 중복 의심 · 가지급 누계', () => {
  const ledger = [
    L({ method: '계좌', account: '기업', amount: 500_000, category: '외주 · 협력사', counterparty: '개인작가', evidence: null }),
    L({ method: '계좌', account: '기업', amount: 30_000, category: '재료 · 소품', counterparty: '소액' }), // 3만 원은 넘지 않음
    L({ method: '계좌', account: '기업', amount: 3_000_000, category: '인건비', counterparty: '급여' }), // 예외
    L({ method: '계좌', account: '기업 기보', amount: 6_853, direction: '입금', category: '이자 · 환급', counterparty: '이자', entry_date: '2026-10-14' }),
    L({ method: '계좌', account: '기업 대출', amount: 6_853, direction: '입금', category: '이자 · 환급', counterparty: '이자', entry_date: '2026-10-14' }),
    L({ method: '계좌', account: '기업', amount: 1_000_000, category: '대표 가지급 · 가수', is_transfer: true, entry_date: '2026-03-01' }),
    L({ method: '계좌', account: '기업', amount: 300_000, category: '대표 가지급 · 가수', direction: '입금', is_transfer: true, entry_date: '2026-10-20' }),
  ]
  const r = closeReport({ month: '2026-10', ledger, invoices: [], openingCount: 0, close: null })
  const ev = r.checks.find(c => c.key === 'evidence')!
  assert.equal(ev.rows.length, 1)
  assert.match(ev.summary, /10,000원/) // 2% 가산세 위험
  assert.equal(r.checks.find(c => c.key === 'dup')!.rows.length, 1)
  assert.equal(r.checks.find(c => c.key === 'opening')!.ok, false)
  assert.deepEqual(r.advance, { out: 1_000_000, in: 300_000, net: 700_000 })
  assert.equal(r.ready, false)
  const closed = closeReport({ month: '2026-10', ledger, invoices: [], openingCount: 1, close: { company: 'AR', month: '2026-10', closed: true, closed_at: '2026-10-05T00:00:00Z', closed_by: null, snapshot: {}, note: null, reopened_at: null, updated_at: '' } })
  assert.equal(closed.changedAfterClose.length, ledger.filter(x => x.entry_date.startsWith('2026-10')).length)
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' })
})

test('분개 초안: 모든 전표 차대 일치 · 카드 · 이체 · 계산서 흐름 · 시산표', () => {
  const ledger = [
    L({ id: 501, amount: 110_000, counterparty: '문구점' }), // 카드 사용 → 미지급금(카드)
    L({ id: 502, method: '계좌', account: '기업', amount: 110_000, category: '카드대금', is_transfer: true, counterparty: '우리카드' }),
    L({ id: 503, method: '계좌', account: '기업', amount: 1_000_000, category: '내 통장 이체', is_transfer: true }),
    L({ id: 504, method: '계좌', account: '우리 2309', amount: 1_000_000, category: '내 통장 이체', direction: '입금', is_transfer: true }),
    L({ id: 505, method: '계좌', account: '기업', amount: 11_000_000, category: '매출 · 용역', direction: '입금', evidence: '세금계산서' }),
    L({ id: 506, method: '계좌', account: '기업', amount: 500_000, category: '대표 가지급 · 가수', is_transfer: true }),
    L({ id: 507, method: '계좌', account: '기업', amount: 1_062_860, category: '인건비', counterparty: '국민건강보험' }),
  ]
  const invoices = [T({ direction: '매출', total: 11_000_000, supply: 10_000_000, vat: 1_000_000, ledger_ids: [505] }), T({ direction: '매입', total: -330_000, supply: -300_000, vat: -30_000, item: '수정' })]
  const j = buildJournal({ from: '2026-10-01', to: '2026-10-31', ledger, invoices, company: 'AR' })
  for (const e of j) {
    const d = e.lines.reduce((n, l) => n + l.debit, 0)
    const c = e.lines.reduce((n, l) => n + l.credit, 0)
    assert.equal(d, c, `${e.source} 차대 일치`)
    assert.ok(e.lines.every(l => l.debit >= 0 && l.credit >= 0))
  }
  const tb = trialBalance(j)
  assert.equal(tb.debit, tb.credit)
  assert.equal(tb.transferLeft, 0, '내 통장끼리 이체는 서로 지워짐')
  assert.equal(tb.rows.find(r => r.account === CARD_PAYABLE)?.balance, 0, '카드 사용 = 카드대금이면 미지급금 0')
  assert.equal(tb.rows.find(r => r.account === '외상매출금')?.balance, 0, '계산서 발행 뒤 입금되면 외상매출금 0')
  assert.equal(tb.rows.find(r => r.account === '부가세예수금')?.balance, -1_000_000)
  assert.equal(tb.rows.find(r => r.account === '가지급금')?.balance, 500_000)
  assert.equal(tb.revenue, 10_000_000)
  assert.ok(j.some(e => e.review?.includes('4대보험')))
  assert.equal(cashAccount({ method: '카드', account: '우리카드' }), CARD_PAYABLE)
  assert.equal(expenseAccount({ category: '세금 · 공과금', counterparty: '원천세 (국세)', memo: null }).account, '예수금 (원천세)')
  assert.equal(groupOf('보통예금 (기업)'), '자산')
  assert.equal(groupOf(TRANSFER), '대체')
  assert.equal(groupOf('용역매출'), '수익')
  assert.equal(groupOf('복리후생비'), '비용')
})

test('표시 · 서버 규칙 문서', () => {
  assert.equal(dLabel('2026-11-30', '2026-11-27'), 'D-3')
  assert.equal(dLabel('2026-11-27', '2026-11-27'), '오늘')
  assert.equal(dLabel('2026-11-25', '2026-11-27'), '2일 지남')
  // 기한 규칙은 서버 한 곳(private.acct_tax_events)에만 — 2027 근로 간이지급명세서 매월 전환 · 부가세 · 법인세 규칙이 들어 있어야 함
  const sql = readFileSync(new URL('../supabase/migrations/20261127233000_accounting_tax.sql', import.meta.url), 'utf8')
  for (const k of ["'vat:'", "'wht:'", "'swage:'", "date '2027-01-01'", "'cit:'", "'citmid:'", 'acct_business_day', "'2027-02-09'", "'2027-10-11'"]) assert.ok(sql.includes(k), k)
  assert.ok(!/\d{6}-\d{7}/.test(sql), '주민번호 모양 없음')
})
