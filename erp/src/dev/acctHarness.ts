// 개발 서버(체험 모드)에서 장부 › 세무 · 결산 화면을 확인하기 위한 지어낸 [시험] 자료.
// 실제 장부 · 계산서 · 회사 자료가 아니며, VITE_ACCT_HARNESS=1 개발 서버에서만 불러온다 (배포 묶음에 없음).
import type { AcctSettings, TaxEvent } from '../lib/acct'
import type { LedgerEntry, LedgerRecurring, Payment, TaxInvoice } from '../lib/types'
import { addDays } from '../lib/date'

export const HARNESS_SETTINGS: AcctSettings[] = [
  { company: 'AR', withholding_cycle: '매월', fiscal_end_month: 12, vat_filing: '예정신고', has_payroll: true, has_freelancers: true, has_daily_workers: false, bookkeeper: '세무대리인 기장', payroll_day: 5, approval_limit: null, alerts: true, note: '', source: '[시험] 장부 자료로 추정한 값', confirmed_at: null, updated_at: new Date().toISOString() },
  { company: 'TW', withholding_cycle: '매월', fiscal_end_month: 12, vat_filing: '예정신고', has_payroll: false, has_freelancers: false, has_daily_workers: false, bookkeeper: '', payroll_day: null, approval_limit: null, alerts: true, note: '[시험] 신설 법인 — 예정신고 · 예정고지 구분 확인', source: '[시험] 기본값', confirmed_at: null, updated_at: new Date().toISOString() },
]

export const HARNESS_HOLIDAYS = [
  { day: '2026-12-25', name: '기독탄신일' },
  { day: '2027-01-01', name: '1월 1일' },
  { day: '2027-02-08', name: '설날 연휴' },
  { day: '2027-03-01', name: '3·1절' },
]

const ev = (company: 'AR' | 'TW', task_key: string, kind: string, title: string, period: string, base: string, due: string, prep: string, basis: string, note: string | null = null): TaxEvent => ({ company, task_key, kind, title, period, base_date: base, due_date: due, prep, basis, note, holidays_loaded: true, done: false, done_at: null, memo: null })

/** 서버 규칙으로 계산한 2026-11 ~ 2027-03 기한을 옮겨 둔 것 (화면 확인용) */
export function harnessTaxEvents(today: string): TaxEvent[] {
  const list = [
    ev('AR', 'sbiz:2026-10', 'sbiz', '간이지급명세서 (3.3% 사업 · 인적용역 기타소득)', '2026년 10월 지급분', '2026-11-30', '2026-11-30', '프리랜서 · 강사 등 3.3% · 8.8% 지급 내역', '소득세법 제164조의3 — 지급한 달의 다음 달 말일', '결제 대장에 이 달 3.3% 지급 기록이 없음 — 지급이 없었으면 끝냄 표시 (알림은 보내지 않음)'),
    ev('AR', 'wht:2026-11', 'wht', '원천세 신고 · 납부', '2026년 11월 지급분', '2026-12-10', '2026-12-10', '급여 · 3.3% 지급 내역으로 원천징수이행상황신고서 · 지방소득세 함께', '소득세법 제128조 — 다음 달 10일'),
    ev('AR', 'ins:2026-11', 'ins', '4대보험료 납부', '2026년 11월분', '2026-12-10', '2026-12-10', '고지 금액 확인 · 자동이체면 통장 잔액', '국민건강보험법 제78조 등 — 다음 달 10일'),
    ev('AR', 'einv:2026-11', 'einv', '세금계산서 발급 마감 (월합계 포함)', '2026년 11월 공급분', '2026-12-10', '2026-12-10', '지난달 공급분 중 발급 안 한 계산서 확인', '부가가치세법 제34조 ③ — 다음 달 10일'),
    ev('TW', 'einv:2026-11', 'einv', '세금계산서 발급 마감 (월합계 포함)', '2026년 11월 공급분', '2026-12-10', '2026-12-10', '지난달 공급분 중 발급 안 한 계산서 확인', '부가가치세법 제34조 ③ — 다음 달 10일'),
    ev('AR', 'sbiz:2026-11', 'sbiz', '간이지급명세서 (3.3% 사업 · 인적용역 기타소득)', '2026년 11월 지급분', '2026-12-31', '2026-12-31', '프리랜서 3.3% 지급 내역', '소득세법 제164조의3 — 다음 달 말일', '결제 대장 3.3% 지급 1건'),
    ev('AR', 'wht:2026-12', 'wht', '원천세 신고 · 납부', '2026년 12월 지급분', '2027-01-10', '2027-01-11', '급여 · 3.3% 지급 내역', '소득세법 제128조 — 다음 달 10일'),
    ev('AR', 'vat:2026-Q4', 'vat', '부가세 2기 확정 신고 · 납부', '2026년 10~12월', '2027-01-25', '2027-01-25', '합계표 대사 · 카드 공제 · 불공제 구분 → 부가세 신고 준비에서 내려받기', '부가가치세법 제48조 · 제49조'),
    ev('TW', 'vat:2026-Q4', 'vat', '부가세 2기 확정 신고 · 납부', '2026년 10~12월', '2027-01-25', '2027-01-25', '합계표 대사 · 카드 공제 · 불공제 구분', '부가가치세법 제48조 · 제49조', '[시험] 신설 법인 — 예정신고 · 예정고지 구분 확인'),
    ev('AR', 'swage:2026-H2', 'swage', '간이지급명세서 (근로소득)', '2026년 7~12월 지급분', '2027-01-31', '2027-02-01', '상용 근로자 급여 지급 내역', '소득세법 제164조의3 — 반기'),
    ev('AR', 'swage:2027-01', 'swage', '간이지급명세서 (근로소득)', '2027년 1월 지급분', '2027-02-28', '2027-03-02', '상용 근로자 급여 지급 내역', '소득세법 제164조의3 — 2027년 1월 지급분부터 매월', '2027년은 반기 기한 안에 내면 가산세 면제 — 세무대리인 확인'),
    ev('AR', 'stmt:2026', 'stmt', '지급명세서 제출 (근로 · 퇴직 · 사업소득)', '2026년 지급분', '2027-03-10', '2027-03-10', '연말정산 결과 · 연간 지급 내역', '소득세법 제164조 — 다음 해 3월 10일'),
    ev('AR', 'cit:2026', 'cit', '법인세 신고 · 납부', '2026년 사업연도', '2027-03-31', '2027-03-31', '결산 마감 · 재무제표 · 세무조정', '법인세법 제60조 — 3개월 이내'),
  ]
  // 지난 기한 하나 (끝내지 않은 것 보이기)
  list.unshift(ev('AR', 'einv:2026-10', 'einv', '세금계산서 발급 마감 (월합계 포함)', '2026년 10월 공급분', '2026-11-10', '2026-11-10', '지난달 공급분 중 발급 안 한 계산서 확인', '부가가치세법 제34조 ③'))
  return list.map(e => ({ ...e, done: e.due_date < addDays(today, -20) }))
}

let n = 9_000_000
const row = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: n++, company: 'AR', entry_date: '2026-11-01', direction: '출금', amount: 0, category: '재료 · 소품', counterparty: null, method: '카드', memo: null, project_id: null,
  account: '우리카드 (시험)', source: '은행', source_ref: `harness-${n}`, supply: null, vat: null, evidence: null, balance_after: null, is_transfer: false, needs_review: false, file_id: null,
  created_by: 'harness', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z', ...over,
})

/** 체험 저장소에 [시험] 장부 · 계산서 · 결제 · 정기 출금을 넣음 (비어 있을 때만) */
export function seedAcct(store: { ledger?: LedgerEntry[]; recurring?: LedgerRecurring[]; taxInvoices?: TaxInvoice[]; payments: Payment[] }, today: string) {
  if ((store.ledger ?? []).some(r => r.created_by === 'harness')) return
  const d = (k: number) => addDays(today, k)
  // 통장 '기업 (시험)': 잔액이 이어지게 — 한 건은 일부러 빠뜨려 '끊김'을 보임
  const bank: Partial<LedgerEntry>[] = [
    { entry_date: d(-56), direction: '입금', amount: 33_000_000, category: '매출 · 용역', counterparty: '(시험) 오브제랩', evidence: '세금계산서', memo: '성수 팝업 잔금' },
    { entry_date: d(-55), direction: '출금', amount: 2_200_000, category: '외주 · 협력사', counterparty: '(시험) 목공소', evidence: '세금계산서' },
    { entry_date: d(-53), direction: '출금', amount: 1_430_000, category: '임대료', counterparty: '(시험) 건물주', evidence: '세금계산서' },
    { entry_date: d(-51), direction: '출금', amount: 9_800_000, category: '인건비', counterparty: '급여 (시험 3명)' },
    { entry_date: d(-48), direction: '출금', amount: 1_062_860, category: '인건비', counterparty: '국민건강보험' },
    { entry_date: d(-48), direction: '출금', amount: 293_590, category: '세금 · 공과금', counterparty: '원천세 (국세)' },
    { entry_date: d(-40), direction: '출금', amount: 880_000, category: '외주 · 협력사', counterparty: '(시험) 개인 사진작가' },
    { entry_date: d(-35), direction: '출금', amount: 3_000_000, category: '대표 가지급 · 가수', counterparty: '대표', is_transfer: true },
    { entry_date: d(-33), direction: '출금', amount: 16_714_035, category: '카드대금', counterparty: '우리카드', is_transfer: true },
    { entry_date: d(-30), direction: '출금', amount: 5_000_000, category: '내 통장 이체', counterparty: '우리 (시험)', is_transfer: true },
    { entry_date: d(-24), direction: '입금', amount: 12_100_000, category: '매출 · 용역', counterparty: '(시험) 루프앤코', memo: '쇼룸 설계 2차' },
    { entry_date: d(-22), direction: '출금', amount: 450_000, category: '기타 출금', counterparty: '(시험) 알 수 없는 이체', needs_review: true },
    { entry_date: d(-20), direction: '출금', amount: 1_430_000, category: '임대료', counterparty: '(시험) 건물주', evidence: '세금계산서' },
    { entry_date: d(-18), direction: '출금', amount: 9_800_000, category: '인건비', counterparty: '급여 (시험 3명)' },
    { entry_date: d(-15), direction: '출금', amount: 4_400_000, category: '외주 · 협력사', counterparty: '(시험) 전기공사', evidence: '세금계산서' },
    { entry_date: d(-12), direction: '출금', amount: 66_000, category: '수수료', counterparty: '(시험) 세무 기장료', evidence: '세금계산서' },
    { entry_date: d(-8), direction: '입금', amount: 8_800_000, category: '매출 · 용역', counterparty: '(시험) 오브제랩', evidence: '세금계산서', memo: '디자인 기획' },
    { entry_date: d(-3), direction: '출금', amount: 1_200_000, category: '재료 · 소품', counterparty: '(시험) 자재상' },
  ]
  let bal = 52_000_000
  const rows: LedgerEntry[] = []
  bank.forEach((b, i) => {
    bal += (b.direction === '입금' ? 1 : -1) * (b.amount ?? 0)
    if (i === 15) return // 이 거래는 장부에 빠짐 → 잔액이 끊김
    rows.push(row({ ...b, method: '계좌', account: '기업 (시험)', balance_after: bal }))
  })
  // 다른 통장: 잔액 기준일이 오래됨
  rows.push(row({ entry_date: d(-30), direction: '입금', amount: 5_000_000, category: '내 통장 이체', counterparty: '기업 (시험)', is_transfer: true, method: '계좌', account: '우리 (시험)', balance_after: 21_350_000 }))
  rows.push(row({ entry_date: d(-29), direction: '입금', amount: 3_610, category: '이자 · 환급', counterparty: '이자', method: '계좌', account: '우리 (시험)', balance_after: 21_353_610 }))
  // 카드 (잔액 없음)
  const card: [number, number, string, string][] = [
    [-50, 286_000, '(시험) 문구 · 사무용품', '재료 · 소품'],
    [-46, 68_000, '(시험) GS칼텍스 셀프주유소', '교통 · 운반'],
    [-44, 23_400, '(시험) 카카오T 택시', '교통 · 운반'],
    [-41, 597_601, 'FIGMA', '구독 · 소프트웨어'],
    [-38, 104_598, 'FACEBK*TEST01', '광고비'],
    [-36, 186_000, '(시험) 한식당 점심', '식대 · 경비'],
    [-31, 150_000, '(시험) 꽃집 화환', '식대 · 경비'],
    [-27, 1_320_000, '(시험) 조명 자재', '재료 · 소품'],
    [-23, 45_000, '(시험) 번개퀵서비스', '교통 · 운반'],
    [-19, 92_000, '(시험) 어딘가', '기타 출금'],
    [-14, 212_000, '(시험) 한식당 점심', '식대 · 경비'],
    [-9, 604_302, 'ANTHROPIC*CLAUDE', '구독 · 소프트웨어'],
    [-6, 418_000, '(시험) 인쇄소', '광고비'],
    [-2, 77_000, '(시험) 주차장', '교통 · 운반'],
  ]
  for (const [k, amount, who, category] of card) rows.push(row({ entry_date: d(k), amount, counterparty: who, category, evidence: '카드' }))
  rows.push(row({ entry_date: d(-25), direction: '입금', amount: 68_000, counterparty: '(시험) 문구 · 사무용품', category: '이자 · 환급', memo: '승인 취소', evidence: '카드' }))
  store.ledger = [...(store.ledger ?? []), ...rows]
  const id = (who: string, k: number) => rows.find(r => r.counterparty === who && r.entry_date === d(k))?.id
  const inv = (over: Partial<TaxInvoice>): TaxInvoice => ({
    id: `harness-${n++}`, approval_no: `HARNESS-${n}`, direction: '매출', write_date: d(-30), issue_date: null, our_biz_no: '302-88-02334', our_name: '주식회사 아트리어디자인스튜디오',
    partner_biz_no: '000-00-00001', partner_name: '(시험) 거래처', partner_email: null, total: 0, supply: 0, vat: 0, receipt_kind: '청구', invoice_kind: '일반', item: null, note: null,
    project_id: null, payment_id: null, memo: null, settled: 0, ledger_ids: [], settle_how: null, settled_at: new Date().toISOString(), created_at: new Date().toISOString(), ...over,
  })
  const s = (gross: number) => ({ total: gross, supply: Math.round(gross / 1.1), vat: gross - Math.round(gross / 1.1) })
  store.taxInvoices = [
    inv({ write_date: d(-60), partner_name: '(시험) 오브제랩', partner_biz_no: '000-00-00011', item: '성수 팝업 잔금', ...s(33_000_000), settled: 33_000_000, ledger_ids: [id('(시험) 오브제랩', -56)!].filter(Boolean), settle_how: '한 번에' }),
    inv({ write_date: d(-26), partner_name: '(시험) 루프앤코', partner_biz_no: '000-00-00012', item: '쇼룸 설계 2차', ...s(13_200_000), settled: 12_100_000, settle_how: '나눠서' }),
    inv({ write_date: d(-10), partner_name: '(시험) 오브제랩', partner_biz_no: '000-00-00011', item: '디자인 기획', ...s(8_800_000), settled: 8_800_000, ledger_ids: [id('(시험) 오브제랩', -8)!].filter(Boolean), settle_how: '한 번에' }),
    inv({ write_date: d(-78), partner_name: '(시험) 한빛건설', partner_biz_no: '000-00-00013', item: '로비 가구 제작 설치', ...s(68_640_000) }),
    inv({ write_date: d(-4), partner_name: '(시험) 성수 브랜드', partner_biz_no: '000-00-00014', item: '팝업 계약금', ...s(24_750_000) }),
    inv({ direction: '매입', write_date: d(-56), partner_name: '(시험) 목공소', partner_biz_no: '000-00-00021', item: '가구 제작', ...s(2_200_000), settled: 2_200_000, ledger_ids: [id('(시험) 목공소', -55)!].filter(Boolean), settle_how: '한 번에' }),
    inv({ direction: '매입', write_date: d(-54), partner_name: '(시험) 건물주', partner_biz_no: '000-00-00022', item: '임대료', ...s(1_430_000), settled: 1_430_000, ledger_ids: [id('(시험) 건물주', -53)!].filter(Boolean), settle_how: '한 번에' }),
    inv({ direction: '매입', write_date: d(-21), partner_name: '(시험) 건물주', partner_biz_no: '000-00-00022', item: '임대료', ...s(1_430_000), settled: 1_430_000, ledger_ids: [id('(시험) 건물주', -20)!].filter(Boolean), settle_how: '한 번에' }),
    inv({ direction: '매입', write_date: d(-16), partner_name: '(시험) 전기공사', partner_biz_no: '000-00-00023', item: '조명 전기 공사', ...s(4_400_000), settled: 4_400_000, ledger_ids: [id('(시험) 전기공사', -15)!].filter(Boolean), settle_how: '한 번에' }),
    inv({ direction: '매입', write_date: d(-40), partner_name: '(시험) 오토리스', partner_biz_no: '000-00-00024', item: '업무용 승용차 리스료', ...s(847_600) }),
    inv({ direction: '매입', write_date: d(-70), partner_name: '(시험) 도장 업체', partner_biz_no: '000-00-00025', item: '벽체 도장', ...s(5_500_000) }),
  ]
  const pay = (over: Partial<Payment>): Payment => ({
    id: `harness-${n++}`, direction: '수금', project_id: null, client_id: null, budget_line_id: null, approval_id: null, category: null, title: '(시험) 결제', payee: '(시험) 거래처', contract_type: '세금계산서',
    stage: null, amount: 0, vat: 0, tax_invoice: '발행', tax_invoice_date: null, status: '청구', is_estimate: false, requested_date: null, due_date: null, paid_date: null,
    advance_by: null, bank_name: null, account_no: null, account_holder: null, memo: null, created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  })
  store.payments = [
    ...store.payments.filter(p => p.status !== '청구' && p.status !== '예정' && p.status !== '대기'),
    pay({ title: '(시험) 쇼룸 설계 잔금', payee: '(시험) 루프앤코', amount: 1_100_000, due_date: d(-15) }),
    pay({ title: '(시험) 로비 가구 잔금', payee: '(시험) 한빛건설', amount: 68_640_000, due_date: d(-48) }),
    pay({ title: '(시험) 팝업 계약금', payee: '(시험) 성수 브랜드', amount: 24_750_000, due_date: d(12) }),
    pay({ title: '(시험) 팝업 중도금', payee: '(시험) 성수 브랜드', amount: 37_125_000, due_date: d(46) }),
    pay({ title: '(시험) 전시 기획', payee: '(시험) 미정 고객', amount: 15_000_000, status: '예정' }),
    pay({ title: '(시험) 지난 잔금', payee: '(시험) 성수 브랜드', amount: 5_000_000, status: '완료', due_date: d(-120), paid_date: d(-104) }),
    pay({ title: '(시험) 지난 계약금', payee: '(시험) 성수 브랜드', amount: 5_000_000, status: '완료', due_date: d(-90), paid_date: d(-76) }),
    pay({ direction: '지급', title: '(시험) 도장 공사비', payee: '(시험) 도장 업체', amount: 5_500_000, status: '대기', due_date: d(6) }),
    pay({ direction: '지급', title: '(시험) 팝업 목공', payee: '(시험) 목공소', amount: 18_700_000, status: '대기', due_date: d(20) }),
  ]
  const rec = (over: Partial<LedgerRecurring>): LedgerRecurring => ({ id: n++, name: '', amount: 0, day_of_month: 25, category: '기타 출금', counterparty: null, method: '계좌', memo: null, active: true, start_month: null, end_month: null, created_by: 'harness', created_at: '', updated_at: '', ...over })
  store.recurring = [
    rec({ name: '(시험) 사무실 임대료', amount: 1_430_000, day_of_month: 2, category: '임대료' }),
    rec({ name: '(시험) 급여 3명', amount: 9_800_000, day_of_month: 5, category: '인건비' }),
    rec({ name: '(시험) 4대보험', amount: 2_366_410, day_of_month: 10, category: '인건비' }),
    rec({ name: '(시험) 우리카드 대금', amount: 4_200_000, day_of_month: 25, category: '카드대금' }),
    rec({ name: '(시험) 디자인 구독', amount: 597_601, day_of_month: 11, category: '구독 · 소프트웨어', method: '카드' }),
  ]
}
