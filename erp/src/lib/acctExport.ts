// 세무대리인 전달용 엑셀 (첫 줄은 늘 '세무대리인 검토용 준비자료' 고지문)
import { ACCT_DISCLAIMER } from './acct.ts'
import type { VatPrep } from './acctVat.ts'
import type { JournalEntry, TbRow } from './acctJournal.ts'
import { journalRows } from './acctJournal.ts'

type Cell = string | number | null
export type Sheet = { name: string; rows: Cell[][]; widths?: number[] }

export async function downloadWorkbook(fileName: string, sheets: Sheet[]) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    if (s.widths) ws['!cols'] = s.widths.map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, fileName)
}

/** 부가세 준비 자료 — 요약 · 매출 계산서 · 매입 계산서 · 카드 · 현금영수증 · 계산서 없는 매출 입금 · 확인 질문 */
export function vatSheets(p: VatPrep, companyName: string, today: string): Sheet[] {
  const head = (title: string): Cell[][] => [[ACCT_DISCLAIMER], [`${companyName} · ${p.period.label} · ${title}`], [`기준일 ${today} · 인트라넷 장부 · 홈택스 목록 기준`], []]
  const summary: Cell[][] = [
    ...head('요약'),
    ['항목', '건수', '공급가액', '세액', '비고'],
    ['매출 세금계산서', p.sales.count, p.sales.supply, p.sales.vat, p.sales.amended ? `수정 ${p.sales.amended}건 포함` : ''],
    ['매입 세금계산서', p.buys.count, p.buys.supply, p.buys.vat, p.buys.amended ? `수정 ${p.buys.amended}건 포함` : ''],
    ['  그중 불공제 후보', p.buys.nondeduct.length, null, p.inputTaxNondeduct, '승용차 · 접대 관련 낱말'],
    ...(['공제 후보', '불공제 후보', '부가세 없음', '확인 필요'] as const).map(c => [`카드 · 현금영수증 ${c}`, p.byClass[c].count, p.byClass[c].gross - p.byClass[c].vat, p.byClass[c].vat, '부가세 포함 금액 × 10/110 추정'] as Cell[]),
    ['계산서 없는 매출 입금', p.uninvoiced.length, null, p.uninvoiced.reduce((n, u) => n + u.vat, 0), '발행 여부 확인 (발행 안 했으면 매출 누락)'],
    [],
    ['예상 납부(환급)세액', '기대 값', p.expected, null, '매출세액 − 매입세액(불공제 후보 제외) − 카드 공제 후보'],
    ['', '낮은 값', p.low, null, '불공제 후보 · 확인 필요까지 모두 공제될 때'],
    ['', '높은 값', p.high, null, '카드 공제를 하나도 못 받을 때'],
    [],
    ['가정', '내용', '영향'],
    ...p.assumptions.map(a => [a.item, a.assumption, a.effect] as Cell[]),
  ]
  const inv = (list: VatPrep['sales']['list'], extra?: (i: VatPrep['sales']['list'][number]) => string): Cell[][] => [
    ['작성일자', '승인번호', '거래처', '사업자번호', '품목', '공급가액', '세액', '합계', '종류', '비고'],
    ...list.map(i => [i.write_date, i.approval_no, i.partner_name, i.partner_biz_no, i.item, i.supply, i.vat, i.total, i.invoice_kind, extra?.(i) ?? ''] as Cell[]),
  ]
  const nd = new Map(p.buys.nondeduct.map(x => [x.inv.id, x.reason]))
  return [
    { name: '요약', rows: summary, widths: [26, 12, 16, 14, 40] },
    { name: '매출 세금계산서', rows: [...head('매출 세금계산서'), ...inv(p.sales.list)], widths: [12, 26, 24, 14, 24, 14, 12, 14, 10, 20] },
    { name: '매입 세금계산서', rows: [...head('매입 세금계산서'), ...inv(p.buys.list, i => nd.get(i.id) ?? '')], widths: [12, 26, 24, 14, 24, 14, 12, 14, 10, 36] },
    {
      name: '카드 · 현금영수증',
      rows: [...head('카드 · 현금영수증 매입 (장부)'), ['이용일', '가맹점', '카드 · 통장', '장부 분류', '금액(부가세 포함)', '추정 세액', '구분', '사유'], ...p.purchases.map(x => [x.date, x.who, x.account, x.category, x.gross, x.vat, x.cls, x.reason] as Cell[])],
      widths: [12, 26, 16, 14, 16, 12, 12, 48],
    },
    { name: '계산서 없는 매출', rows: [...head('세금계산서와 짝이 없는 매출 입금'), ['입금일', '보낸 곳', '분류', '금액', '부가세 포함이면 세액'], ...p.uninvoiced.map(u => [u.date, u.who, u.category, u.amount, u.vat] as Cell[])], widths: [12, 26, 14, 16, 18] },
    { name: '확인 질문', rows: [...head('세무대리인 확인 질문'), ['번호', '질문'], ...p.questions.map((q, i) => [i + 1, q] as Cell[])], widths: [6, 100] },
  ]
}

/** 분개장 · 시산표 */
export function journalSheets(entries: JournalEntry[], tb: { rows: TbRow[]; debit: number; credit: number }, companyName: string, label: string, today: string): Sheet[] {
  const head: Cell[][] = [[ACCT_DISCLAIMER], [`${companyName} · ${label} · 분개 초안 (회계 프로그램에 옮기기 전 검토용)`], [`기준일 ${today} · 계정 코드는 세무대리인이 맞춤`], []]
  const rows = journalRows(entries)
  return [
    { name: '분개장', rows: [...head, Object.keys(rows[0] ?? { 전표번호: '' }), ...rows.map(r => Object.values(r) as Cell[])], widths: [14, 12, 30, 14, 14, 22, 30, 12, 18, 40] },
    { name: '시산표', rows: [...head, ['구분', '계정과목', '차변', '대변', '잔액(차변−대변)'], ...tb.rows.map(r => [r.group, r.account, r.debit, r.credit, r.balance] as Cell[]), ['', '합계', tb.debit, tb.credit, tb.debit - tb.credit]], widths: [8, 36, 16, 16, 18] },
  ]
}
