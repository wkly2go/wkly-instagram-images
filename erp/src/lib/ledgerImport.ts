/**
 * 회계 자료 폴더 → 입출금 장부 자동 기입 (대표 지시 2026-11-11)
 *  - 은행 거래내역(엑셀 · CSV): 머리 줄을 찾아 날짜 · 입금 · 출금 · 잔액 · 내용 칸을 알아냄 (은행마다 이름이 달라 여러 이름을 봄)
 *  - 홈택스 사업용 카드 사용내역: 카드 결제 한 건씩 (공급가 · 부가세)
 *  - 홈택스 현금영수증 매입: 증빙 · 부가세 (은행 출금과 맞으면 그 줄에 붙임)
 *  - 홈택스 세금계산서 목록: 세금계산서 대장(tax_invoices)에 넣고, 맞는 은행 줄에 증빙 · 부가세를 붙임
 *  - 분류: 결제 대장(지급 · 수금 완료)과 금액 · 날짜로 맞추면 그 분류 · 프로젝트 · 거래처, 아니면 낱말 규칙, 그래도 모르면 '미분류'(확인 필요)
 *  - 카드대금 · 내 통장끼리 이체는 is_transfer (합계에서 뺌, 카드는 카드 사용내역으로 따로 잡힘)
 */
import type { LedgerDirection, Payment } from './types'

export type LedgerFileKind = '은행' | '카드' | '현금영수증' | '세금계산서' | '알 수 없음'
export interface LedgerRow {
  entry_date: string
  direction: LedgerDirection
  amount: number
  category: string
  counterparty: string | null
  method: '계좌' | '카드' | '현금' | '기타'
  memo: string | null
  project_id: string | null
  account: string | null
  source: '은행' | '홈택스'
  source_ref: string
  supply: number | null
  vat: number | null
  evidence: string | null
  balance_after: number | null
  is_transfer: boolean
  needs_review: boolean
}
/** 세금계산서 · 현금영수증처럼 은행 줄에 붙일 증빙 */
export interface Evidence {
  date: string
  direction: LedgerDirection
  total: number
  supply: number
  vat: number
  partner: string
  kind: '세금계산서' | '현금영수증'
  ref: string
}
type Grid = (string | number | null)[][]

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').trim()
const num = (v: unknown) => {
  const s = String(v ?? '').replace(/[,원\s]/g, '')
  if (!s || s === '-') return 0
  const n = Number(s.replace(/^\((.*)\)$/, '-$1'))
  return Number.isFinite(n) ? Math.round(n) : 0
}
const toDate = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  let m = s.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // 엑셀 날짜 일련번호
  const n = Number(s)
  if (n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10)
  return null
}
const timeOf = (v: unknown) => String(v ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)?.[0] ?? ''

async function hash(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function readGrid(data: ArrayBuffer, name: string): Promise<Grid[]> {
  const XLSX = await import('xlsx')
  const isCsv = /\.csv$/i.test(name)
  let wb
  if (isCsv) {
    // 한국 은행 CSV 는 EUC-KR 이 많음
    let text = new TextDecoder('utf-8').decode(data)
    if (text.includes('�')) text = new TextDecoder('euc-kr').decode(data)
    wb = XLSX.read(text, { type: 'string' })
  } else wb = XLSX.read(data, { type: 'array', cellDates: false })
  return wb.SheetNames.map(n => XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[n], { header: 1, raw: false, defval: null }))
}

const pick = (head: string[], names: string[]) => {
  for (const n of names) {
    const i = head.findIndex(h => h === n)
    if (i >= 0) return i
  }
  for (const n of names) {
    const i = head.findIndex(h => h.includes(n))
    if (i >= 0) return i
  }
  return -1
}

export function detectKind(grids: Grid[], name: string): { kind: LedgerFileKind; grid: Grid; hi: number } {
  for (const grid of grids) {
    for (let i = 0; i < Math.min(grid.length, 40); i++) {
      const h = grid[i].map(norm)
      const has = (k: string) => h.some(x => x.includes(k))
      if (has('승인번호') && has('작성일자') && has('공급가액')) return { kind: '세금계산서', grid, hi: i }
      if ((has('가맹점') || has('가맹점명')) && (has('승인') || has('사용일') || has('거래일')) && (has('합계') || has('승인금액') || has('이용금액') || has('공급가액'))) {
        if (/현금영수증/.test(name) || has('현금영수증') || has('발행구분')) return { kind: '현금영수증', grid, hi: i }
        return { kind: '카드', grid, hi: i }
      }
      if ((has('거래일') || has('일자') || has('거래일시')) && (has('출금') || has('찾으신') || has('지급') || has('거래금액')) && (has('입금') || has('맡기신') || has('구분') || has('잔액'))) return { kind: '은행', grid, hi: i }
    }
  }
  return { kind: '알 수 없음', grid: grids[0] ?? [], hi: -1 }
}

const BANKS = ['국민', '신한', '우리', '하나', '기업', '농협', '카카오', '토스', '케이', 'SC', '씨티', '수협', '부산', '대구', '경남', '광주', '전북', '제주', '새마을', '우체국', '신협', 'IBK', 'KB', 'NH']
function accountName(grid: Grid, hi: number, file: string): string {
  const top = grid.slice(0, Math.max(hi, 0)).flat().map(c => String(c ?? '')).join(' ') + ' ' + file
  const bank = BANKS.find(b => top.includes(b)) ?? '통장'
  const acct = top.match(/(\d{2,6}[-\s]?\d{2,6}[-\s]?\d{2,8}(?:[-\s]?\d{1,4})?)/)?.[1]?.replace(/\D/g, '')
  return `${bank} ${acct ? acct.slice(-4) : ''}`.trim()
}

// ---------- 분류 ----------
const RULES: { re: RegExp; dir?: LedgerDirection; cat: string; transfer?: boolean }[] = [
  { re: /(국민|신한|삼성|현대|롯데|하나|우리|비씨|BC|NH|농협|KB)\s*카드|카드대금|카드결제/, dir: '출금', cat: '카드대금', transfer: true },
  { re: /급여|월급|상여|퇴직/, dir: '출금', cat: '인건비' },
  { re: /국민연금|건강보험|고용보험|산재|4대보험|국민건강/, dir: '출금', cat: '인건비' },
  { re: /국세|지방세|부가세|부가가치세|원천세|세무서|구청|시청|관세|자동차세|재산세|주민세|법인세|종합소득/, dir: '출금', cat: '세금 · 공과금' },
  { re: /월세|임대료|임차|관리비/, dir: '출금', cat: '임대료' },
  { re: /이자|예금결산/, dir: '입금', cat: '이자 · 환급' },
  { re: /환급|환불/, dir: '입금', cat: '이자 · 환급' },
  { re: /대출이자|이자/, dir: '출금', cat: '이자 · 금융비용' },
  { re: /수수료/, dir: '출금', cat: '수수료' },
  { re: /네이버|구글|google|메타|facebook|페이스북|인스타|카카오모먼트|광고/i, dir: '출금', cat: '광고비' },
  { re: /KT|SKT|SK텔레콤|LG유플러스|U\+|통신|인터넷/i, dir: '출금', cat: '통신비' },
  { re: /adobe|어도비|notion|노션|slack|슬랙|figma|피그마|google workspace|microsoft|aws|구독/i, dir: '출금', cat: '구독 · 소프트웨어' },
  { re: /택시|주유|고속도로|하이패스|코레일|ktx|주차|퀵|화물|용달|운송/i, dir: '출금', cat: '교통 · 운반' },
  { re: /식당|카페|커피|스타벅스|배달의민족|쿠팡이츠|편의점|마트/, dir: '출금', cat: '식대 · 경비' },
  { re: /더위클리|아트리어|본인|자기앞|계좌이동|대체/, cat: '내 통장 이체', transfer: true },
]
const clean = (s: string) => s.replace(/\(주\)|주식회사|㈜|\s/g, '').toLowerCase()

export function classify(desc: string, dir: LedgerDirection, amount: number, date: string, payments: Payment[]) {
  // 1) 결제 대장(완료)과 금액 · 날짜(±7일) · 이름으로 맞추기
  const want = dir === '출금' ? '지급' : '수금'
  const d0 = Date.parse(date)
  const cands = payments.filter(p => p.direction === want && p.status === '완료' && Math.abs(p.amount + (p.vat ?? 0)) > 0)
  const near = (p: Payment) => {
    const pd = p.paid_date ?? p.due_date ?? p.requested_date
    return pd ? Math.abs(Date.parse(pd) - d0) <= 7 * 864e5 : false
  }
  const nameHit = (p: Payment) => !!p.payee && (clean(desc).includes(clean(p.payee).slice(0, 4)) || clean(p.payee).includes(clean(desc).slice(0, 4)))
  const sameAmt = (p: Payment) => p.amount === amount || p.amount + (p.vat ?? 0) === amount
  const hit = cands.find(p => sameAmt(p) && near(p) && nameHit(p)) ?? cands.find(p => sameAmt(p) && near(p)) ?? cands.find(p => sameAmt(p) && nameHit(p))
  if (hit)
    return {
      category: dir === '출금' ? hit.category || '외주 · 협력사' : '매출 · 용역',
      project_id: hit.project_id ?? null,
      counterparty: hit.payee || null,
      is_transfer: false,
      needs_review: false,
      matched: hit.id,
    }
  // 2) 낱말 규칙
  for (const r of RULES) if ((!r.dir || r.dir === dir) && r.re.test(desc)) return { category: r.cat, project_id: null, counterparty: null, is_transfer: !!r.transfer, needs_review: false, matched: null }
  // 3) 모르면 확인 필요
  return { category: dir === '입금' ? '기타 입금' : '기타 출금', project_id: null, counterparty: null, is_transfer: false, needs_review: true, matched: null }
}

// ---------- 은행 ----------
export async function parseBank(grid: Grid, hi: number, file: string, fileId: string, payments: Payment[]): Promise<LedgerRow[]> {
  const head = grid[hi].map(norm)
  const c = {
    date: pick(head, ['거래일시', '거래일자', '거래일', '일자', '날짜']),
    time: pick(head, ['거래시간', '시간']),
    out: pick(head, ['출금액', '출금금액', '찾으신금액', '지급액', '출금']),
    inn: pick(head, ['입금액', '입금금액', '맡기신금액', '입금']),
    amt: pick(head, ['거래금액', '금액']),
    type: pick(head, ['입출금구분', '거래구분', '구분']),
    bal: pick(head, ['거래후잔액', '잔액', '잔고']),
    descs: ['적요', '기재내용', '거래내용', '내용', '받는분', '보낸분', '입금자명', '상대방', '거래처', '거래점', '메모', '비고']
      .map(n => head.findIndex(h => h.includes(n)))
      .filter((i, k, a) => i >= 0 && a.indexOf(i) === k),
  }
  const account = accountName(grid, hi, file)
  const out: LedgerRow[] = []
  for (const r of grid.slice(hi + 1)) {
    const date = toDate(r[c.date])
    if (!date) continue
    let inn = c.inn >= 0 ? num(r[c.inn]) : 0
    let outAmt = c.out >= 0 ? num(r[c.out]) : 0
    if (!inn && !outAmt && c.amt >= 0) {
      const a = num(r[c.amt])
      const t = String(r[c.type] ?? '')
      if (/입금|맡기/.test(t) || (!t && a > 0)) inn = Math.abs(a)
      else outAmt = Math.abs(a)
    }
    if (!inn && !outAmt) continue
    const dir: LedgerDirection = inn ? '입금' : '출금'
    const amount = Math.abs(inn || outAmt)
    const desc = c.descs.map(i => String(r[i] ?? '').trim()).filter(Boolean).join(' · ').slice(0, 300)
    const bal = c.bal >= 0 ? num(r[c.bal]) : null
    const time = timeOf(r[c.time >= 0 ? c.time : c.date])
    const k = classify(desc, dir, amount, date, payments)
    out.push({
      entry_date: date,
      direction: dir,
      amount,
      category: k.category,
      counterparty: (k.counterparty ?? desc.split(' · ')[0] ?? '').slice(0, 100) || null,
      method: '계좌',
      memo: desc.slice(0, 500) || null,
      project_id: k.project_id,
      account,
      source: '은행',
      source_ref: `은행:${await hash([account, date, time, dir, amount, bal ?? '', desc].join('|'))}`,
      supply: null,
      vat: null,
      evidence: null,
      balance_after: bal,
      is_transfer: k.is_transfer,
      needs_review: k.needs_review,
    })
    void fileId
  }
  return out
}

// ---------- 홈택스 카드 · 현금영수증 ----------
export async function parseCardLike(grid: Grid, hi: number, kind: '카드' | '현금영수증', payments: Payment[]): Promise<{ rows: LedgerRow[]; evidence: Evidence[] }> {
  const head = grid[hi].map(norm)
  const c = {
    date: pick(head, ['승인일자', '사용일자', '거래일자', '매출일시', '거래일시', '이용일자', '일자']),
    merchant: pick(head, ['가맹점명', '가맹점상호', '가맹점', '상호']),
    supply: pick(head, ['공급가액']),
    vat: pick(head, ['부가세', '세액', '부가가치세']),
    total: pick(head, ['합계금액', '합계', '총금액', '승인금액', '이용금액', '거래금액']),
    no: pick(head, ['승인번호', '카드번호']),
    card: pick(head, ['카드번호', '카드사']),
  }
  const rows: LedgerRow[] = []
  const evidence: Evidence[] = []
  for (const r of grid.slice(hi + 1)) {
    const date = toDate(r[c.date])
    if (!date) continue
    const vat = c.vat >= 0 ? num(r[c.vat]) : 0
    let total = c.total >= 0 ? num(r[c.total]) : 0
    const supply = c.supply >= 0 ? num(r[c.supply]) : total - vat
    if (!total) total = supply + vat
    if (!total) continue
    const merchant = String(r[c.merchant] ?? '').trim().slice(0, 100)
    const ref = `${kind}:${await hash([date, merchant, total, String(r[c.no] ?? ''), timeOf(r[c.date])].join('|'))}`
    if (kind === '현금영수증') {
      evidence.push({ date, direction: total < 0 ? '입금' : '출금', total: Math.abs(total), supply: Math.abs(supply), vat: Math.abs(vat), partner: merchant, kind: '현금영수증', ref })
      continue
    }
    const dir: LedgerDirection = total < 0 ? '입금' : '출금' // 카드 취소는 들어온 돈으로
    const k = classify(merchant, dir, Math.abs(total), date, payments)
    rows.push({
      entry_date: date,
      direction: dir,
      amount: Math.abs(total),
      category: k.is_transfer ? '기타 출금' : k.category,
      counterparty: merchant || null,
      method: '카드',
      memo: `홈택스 사업용 카드${total < 0 ? ' · 취소' : ''}`,
      project_id: k.project_id,
      account: '사업용 카드',
      source: '홈택스',
      source_ref: ref,
      supply: Math.abs(supply),
      vat: Math.abs(vat),
      evidence: '카드',
      balance_after: null,
      is_transfer: false,
      needs_review: k.needs_review,
    })
  }
  return { rows, evidence }
}

/** 은행 줄에 세금계산서 · 현금영수증 붙이기: 금액 같고 날짜 ±45일 · 이름 비슷하면 */
export function attachEvidence(rows: { id?: number; entry_date: string; direction: LedgerDirection; amount: number; counterparty: string | null; memo: string | null; evidence?: string | null }[], ev: Evidence[]) {
  const used = new Set<number>()
  const out: { index: number; ev: Evidence }[] = []
  for (const e of ev) {
    const d0 = Date.parse(e.date)
    let best = -1
    rows.forEach((r, i) => {
      if (used.has(i) || r.evidence || r.direction !== e.direction || r.amount !== e.total) return
      const gap = Math.abs(Date.parse(r.entry_date) - d0)
      if (gap > 45 * 864e5) return
      const name = clean(`${r.counterparty ?? ''}${r.memo ?? ''}`)
      const p = clean(e.partner).slice(0, 4)
      if (best < 0 || (p && name.includes(p))) best = i
    })
    if (best >= 0) {
      used.add(best)
      out.push({ index: best, ev: e })
    }
  }
  return out
}
