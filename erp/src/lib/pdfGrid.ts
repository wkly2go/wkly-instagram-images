/**
 * PDF 카드 명세서 → 장부 표 (대표 지시 2026-11-12 "pdf 카드내역을 주면 작업 가능하게 만들어")
 *  - PDF 안의 글자를 위치(가로 · 세로)대로 줄 · 칸으로 나눔 (pdf.js · 올릴 때만 불러옴)
 *  - 날짜로 시작하는 줄 = 카드 이용 한 건: 날짜 · 가맹점 · 첫 금액(이용금액) · 승인번호(8자리)
 *  - 연도 없는 날짜(10.03)는 명세서 안의 가장 늦은 날짜(결제일 · 발행일)를 기준으로 연도를 붙임
 *  - 합계 · 소계 · 이월 · 청구 금액 줄은 뺌
 *  - 비밀번호 걸린 PDF 는 그 자리에서 비밀번호를 물어봄 (인트라넷에 저장하지 않음)
 *  - 글자가 없는 스캔 PDF 는 읽을 수 없음 → 카드사에서 엑셀 · 글자 PDF 로 다시 받기
 */
type Cell = string | number | null
type Grid = Cell[][]

interface Item {
  s: string
  x: number
  y: number
  w: number
  h: number
}

let lastPassword: string | undefined

/** PDF → 줄마다 칸 (글자 사이가 벌어진 곳에서 칸을 나눔) */
export async function pdfLines(data: ArrayBuffer, name = ''): Promise<string[][]> {
  const pdfjs = await import('pdfjs-dist')
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  }
  const open = (password?: string) =>
    pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), password, cMapUrl: '/pdf-cmaps/', cMapPacked: true, isEvalSupported: false }).promise
  let doc
  try {
    doc = await open(lastPassword)
  } catch (e) {
    if ((e as { name?: string })?.name !== 'PasswordException' || typeof window === 'undefined') throw e
    doc = null
    for (let tries = 0; tries < 3 && !doc; tries++) {
      const pw = window.prompt(`'${name}' 은(는) 비밀번호가 걸린 PDF 입니다.\n비밀번호를 넣어 주세요 (인트라넷에 저장하지 않습니다).`)
      if (!pw) throw new Error('비밀번호가 걸린 PDF 라 읽지 않았습니다 — 다시 올리고 비밀번호를 넣어 주세요')
      try {
        doc = await open(pw)
        lastPassword = pw
      } catch (e2) {
        if ((e2 as { name?: string })?.name !== 'PasswordException') throw e2
      }
    }
    if (!doc) throw new Error('PDF 비밀번호가 맞지 않습니다')
  }
  const lines: string[][] = []
  let chars = 0
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const items: Item[] = []
    for (const it of tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      // 카드사 웹 명세서를 인쇄한 PDF 는 띄어쓰기가 제어 문자(\u0001)로 나옴
      const s = (it.str ?? '').replace(/[\u0000-\u001f\u00a0]/g, ' ').replace(/\s+/g, ' ')
      if (!s.trim() || !it.transform) continue
      const h = Math.abs(it.height || it.transform[3] || 8)
      items.push({ s, x: it.transform[4], y: it.transform[5], w: it.width ?? s.length * h * 0.5, h })
      chars += s.trim().length
    }
    // 위에서 아래로, 같은 높이(글자 높이의 절반 안)는 한 줄
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const rows: Item[][] = []
    for (const it of items) {
      const row = rows[rows.length - 1]
      if (row && Math.abs(row[0].y - it.y) <= Math.max(2, Math.min(row[0].h, it.h) * 0.5)) row.push(it)
      else rows.push([it])
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
      const cells: string[] = []
      let end = -Infinity
      for (const it of row) {
        const gap = it.x - end
        if (!cells.length || gap > Math.max(3, it.h * 0.9)) cells.push(it.s.trim())
        else cells[cells.length - 1] += (gap > it.h * 0.2 ? ' ' : '') + it.s.trim()
        end = Math.max(end, it.x + it.w)
      }
      lines.push(cells.filter(Boolean))
    }
    page.cleanup()
  }
  await doc.destroy()
  if (chars < 20) throw new Error('글자가 없는 스캔(사진) PDF 라 읽을 수 없습니다 — 카드사 홈페이지에서 엑셀이나 PDF 명세서를 다시 받아 올려 주세요')
  return lines
}

const DATE_HEAD = /^(?:(20\d{2}|\d{2})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})일?(?![\d,])/
const FULL_DATE = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g
const MONEY = /^[-−]?\(?\d{1,3}(,\d{3})+\)?(원)?$|^[-−]?\d{1,3}(원)?$/
const SKIP_LINE = /합\s*계|소\s*계|총\s*계|총\s*액|이\s*월|청구\s*금액|결제\s*예정|결제하실|납부하실|할인\s*합계|포인트\s*사용|연체/
const NOT_MERCHANT = /^(본인|가족|일시불|할부|국내|해외|신용|체크|일반|무이자|[0-9]{1,2}개월|\d{1,2}\/\d{1,2})$/
const CARD_NO = /^\d{4}[-*\s]|[*]{3,}|^\d{3,4}$/
const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/

const pad = (n: number | string) => String(n).padStart(2, '0')

/** 줄들 → 카드 이용 표 (머리 줄: 이용일자 · 가맹점명 · 이용금액 · 승인번호). 두 건 미만이면 null */
export function cardGridFromLines(lines: string[][], today = new Date()): Grid | null {
  // 기준일: 명세서 안 가장 늦은 날짜 (오늘 + 60일 안)
  const limit = new Date(today.getTime() + 60 * 864e5).toISOString().slice(0, 10)
  let ref = ''
  for (const l of lines)
    for (const m of l.join(' ').matchAll(FULL_DATE)) {
      const d = `${m[1]}-${pad(m[2])}-${pad(m[3])}`
      if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 && d <= limit && d > ref) ref = d
    }
  const rows: Grid = []
  let firstTx = -1
  lines.forEach((raw, li) => {
    // 맨 앞 순번(1 · 2 · 3 …) 칸은 건너뜀
    const line = raw.length > 1 && /^\d{1,4}$/.test(raw[0]) && DATE_HEAD.test(raw[1]) ? raw.slice(1) : raw
    if (!line.length) return
    const m = line[0].match(DATE_HEAD)
    if (!m) return
    const mo = +m[2]
    const da = +m[3]
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return
    let y = m[1] ? (m[1].length === 2 ? 2000 + +m[1] : +m[1]) : 0
    if (!y && ref) {
      y = +ref.slice(0, 4)
      if (`${y}-${pad(mo)}-${pad(da)}` > ref) y -= 1
    }
    const date = y ? `${y}-${pad(mo)}-${pad(da)}` : `${pad(mo)}.${pad(da)}`
    const cells = [line[0].slice(m[0].length), ...line.slice(1)].map(c => c.trim()).filter(Boolean)
    const merchant: string[] = []
    let amount: string | null = null
    let approval = ''
    for (const c of cells) {
      if (/^\d{8}$/.test(c)) {
        approval = c
        continue
      }
      if (amount) continue
      if (TIME.test(c) || DATE_HEAD.test(c) && /^\d/.test(c) && !MONEY.test(c)) continue
      if (MONEY.test(c)) {
        const v = Number(c.replace(/[−]/g, '-').replace(/[,원()\s]/g, ''))
        if (!v) continue
        amount = (/^\(|^[-−]/.test(c) ? '-' : '') + String(Math.abs(v))
        continue
      }
      // 글자가 붙어 나온 칸(예: '4140-****-****-7973대한항공', '본인 1234 스타벅스')에서 카드번호 · 본인/가족 표시를 걷어냄
      const t = c
        .replace(/\d{4}[-\s]?[\d*]{4}[-\s]?[\d*]{4}[-\s]?[\d*]{3,4}/g, ' ')
        .replace(/[\d*]*\*{3,}[\d*]*/g, ' ')
        .replace(/^(본인|가족)\s*\d{0,4}\s*/, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!t || NOT_MERCHANT.test(t) || CARD_NO.test(t)) continue
      merchant.push(t)
    }
    const shop = merchant.join(' ').trim()
    if (!amount || !shop || SKIP_LINE.test(shop)) return
    if (firstTx < 0) firstTx = li
    rows.push([date, shop.slice(0, 100), amount, approval || null])
  })
  if (rows.length < 2) return null
  // 머리 글(카드사 이름 등) — 머리 줄로 잘못 알아보지 않게 표 머리 낱말이 든 줄은 뺌
  const top = lines
    .slice(0, Math.max(firstTx, 0))
    .map(l => l.join(' '))
    .filter(t => !/가맹점|금액|일자|이용일|승인/.test(t))
    .join(' ')
    .slice(0, 400)
  return [[top || null], ['이용일자', '가맹점명', '이용금액', '승인번호'], ...rows]
}

/** 카드 청구 요약(이용대금명세서 첫 화면만 인쇄한 PDF): 카드사 · 청구 금액 · 결제일 · 이용기간 · 결제 계좌 */
export interface CardBill {
  company: string
  total: number
  payDate: string | null
  from: string | null
  to: string | null
  account: string | null
}
export const CARD_BILL_MARK = '카드 청구 요약'
export function cardBillFromLines(lines: string[][]): CardBill | null {
  const text = lines.map(l => l.join(' ')).join('\n')
  if (!/이용\s*대금\s*명세서|청구서/.test(text)) return null
  const amt = text.match(/결제금액\s*요약내역\s+([\d,]+)\s*원/) ?? text.match(/총\s*결제\s*금액[\s\S]{0,300}?([\d,]{5,})\s*원/) ?? text.match(/청구\s*금액[\s\S]{0,60}?([\d,]{5,})\s*원/)
  if (!amt) return null
  const d = (y: string, m: string, dd: string) => `${y}-${pad(m)}-${pad(dd)}`
  const pay = text.match(/결제일[\s\S]{0,60}?(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ?? text.match(/결제일[\s\S]{0,30}?(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  const per = text.match(/일시불[^\n]*이용\s*기간\s*:?\s*(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*~\s*(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ?? text.match(/이용\s*기간\s*:?\s*(20\d{2})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})일?\s*~\s*(20\d{2})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/)
  const company = text.match(/(우리|현대|국민|KB국민|신한|삼성|롯데|하나|비씨|BC|NH농협|농협|IBK|기업)\s*카드/)?.[1] ?? '카드'
  const acc = text.match(/결제\s*계좌\s+(\S*?은행)\s*([\d*\-]+)/)
  return {
    company: company === 'KB국민' ? '국민' : company === 'NH농협' ? '농협' : company,
    total: Number(amt[1].replace(/,/g, '')),
    payDate: pay ? d(pay[1], pay[2], pay[3]) : null,
    from: per ? d(per[1], per[2], per[3]) : null,
    to: per ? d(per[4], per[5], per[6]) : null,
    account: acc ? `${acc[1]} ${acc[2].replace(/[^\d]/g, '').slice(-3)}` : null,
  }
}

/** PDF → readGrid 와 같은 모양 (카드 명세서면 카드 표, 은행 거래내역이면 줄 그대로) */
export async function pdfGrids(data: ArrayBuffer, name: string): Promise<Grid[]> {
  const lines = await pdfLines(data, name)
  // 은행 거래내역: 한 줄(머리 줄)에 잔액 · 입금 · 출금이 함께 있음 (카드 명세서의 '결제 후 잔액' · '출금 계좌'와 구분)
  const bankish = lines.some(l => {
    const t = l.join(' ')
    return /잔\s*액/.test(t) && /(입\s*금|맡기신)/.test(t) && /(출\s*금|찾으신)/.test(t) && !/가맹점/.test(t)
  })
  const card = bankish ? null : cardGridFromLines(lines)
  if (card) return [card]
  // 건별 내역 없이 청구 요약만 있는 명세서 (예: 우리카드 웹 명세서 첫 화면 인쇄)
  const bill = bankish ? null : cardBillFromLines(lines)
  if (bill) return [[[CARD_BILL_MARK, bill.company, bill.total, bill.payDate, bill.from, bill.to, bill.account]]]
  return [lines]
}
