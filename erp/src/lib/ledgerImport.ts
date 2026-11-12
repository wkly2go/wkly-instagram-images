/**
 * 회계 자료 폴더 → 입출금 장부 자동 기입 (대표 지시 2026-11-11)
 *  - 은행 거래내역(엑셀 · CSV): 머리 줄을 찾아 날짜 · 입금 · 출금 · 잔액 · 내용 칸을 알아냄 (은행마다 이름이 달라 여러 이름을 봄)
 *  - 홈택스 사업용 카드 사용내역: 카드 결제 한 건씩 (공급가 · 부가세)
 *  - 홈택스 현금영수증 매입: 증빙 · 부가세 (은행 출금과 맞으면 그 줄에 붙임)
 *  - 홈택스 세금계산서 목록: 세금계산서 대장(tax_invoices)에 넣고, 맞는 은행 줄에 증빙 · 부가세를 붙임
 *  - 은행 · 카드 자료가 기준 (2026-11-11 대표 지시: 결제 대장 연결보다 카드 · 통장 자료 우선 · 프로젝트와는 연결 안 함)
 *  - 분류: 결제 대장(완료)과 금액 · 날짜가 맞으면 그 분류 · 거래처 이름만 참고, 아니면 낱말 규칙, 그래도 모르면 '확인 필요'
 *  - 카드대금 · 내 통장끼리 이체는 is_transfer (합계에서 뺌, 카드는 카드 사용내역으로 따로 잡힘)
 */
import { LEDGER_CATEGORIES, type LedgerDirection, type Payment } from './types'

export type LedgerFileKind = '은행' | '카드' | '현금영수증' | '세금계산서' | '계산서 합계표' | '카드 청구 요약' | '알 수 없음'
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
/** 연도 없는 날짜(카드 명세서 '06.04')를 기준일로 연도 채우기: 기준일보다 뒤면 지난해 */
const toDateRef = (v: unknown, ref: Date | null): string | null => {
  const d = toDate(v)
  if (d) return d
  if (!ref) return null
  const m = String(v ?? '').trim().match(/^(\d{1,2})[.\-/월]\s*(\d{1,2})일?$/)
  if (!m) return null
  const mo = +m[1]
  const da = +m[2]
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
  let y = ref.getFullYear()
  if (mo * 100 + da > (ref.getMonth() + 1) * 100 + ref.getDate()) y -= 1
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`
}
/** 카드 명세서 기준일: 파일 이름의 'N월'(청구 달) + 파일 날짜 → 그 달 말일. 없으면 파일 날짜 */
export function statementRef(name: string, modified: string | null): Date {
  const raw = modified && /^\d{10,}$/.test(modified) ? new Date(+modified) : modified ? new Date(modified) : new Date()
  const base = Number.isNaN(raw.getTime()) ? new Date() : raw
  const m = name.match(/(?:^|\D)(\d{1,2})\s*월/)
  const ym = name.match(/(20\d{2})[.\-_]?(\d{2})[.\-_]?(\d{2})?/)
  if (ym) return new Date(+ym[1], +ym[2], 0)
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    const mo = +m[1]
    const y = mo <= base.getMonth() + 1 ? base.getFullYear() : base.getFullYear() - 1
    return new Date(y, mo, 0)
  }
  return base
}
const timeOf = (v: unknown) => String(v ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)?.[0] ?? ''

async function hash(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function readGrid(data: ArrayBuffer, name: string): Promise<Grid[]> {
  // PDF 카드 명세서 (2026-11-12)
  if (/\.pdf$/i.test(name)) return (await import('./pdfGrid')).pdfGrids(data, name)
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
  // PDF 카드 청구 요약 (건별 내역 없이 청구 금액만 — pdfGrid.cardBillFromLines)
  for (const grid of grids) if (grid[0]?.[0] === '카드 청구 요약') return { kind: '카드 청구 요약', grid, hi: 0 }
  // 홈택스 '세금계산서 합계표'(매출처별 · 매입처별 기간 합계) — 거래 내역이 아니라 계산서 대장 대조용 (2026-11-12)
  for (const grid of grids) {
    const hi = grid.findIndex(r => norm(r[0]) === '일련번호' && r.some(c => /등록번호/.test(String(c ?? ''))))
    if (hi >= 0 && grid.slice(0, hi).some(r => r.some(c => /합계표\s*명세서|매출처\s*수|매입처\s*수/.test(String(c ?? ''))))) return { kind: '계산서 합계표', grid, hi }
  }
  for (const grid of grids) {
    for (let i = 0; i < Math.min(grid.length, 60); i++) {
      const h = grid[i].map(norm)
      const has = (k: string) => h.some(x => x.includes(k))
      if (has('승인번호') && has('작성일자') && has('공급가액')) return { kind: '세금계산서', grid, hi: i }
      if ((has('가맹점') || has('가맹점명')) && (has('승인') || has('사용일') || has('거래일') || has('이용일')) && (has('합계') || has('승인금액') || has('이용금액') || has('공급가액'))) {
        if (/현금영수증/.test(name) || has('현금영수증') || has('발행구분')) return { kind: '현금영수증', grid, hi: i }
        return { kind: '카드', grid, hi: i }
      }
      if ((has('거래일') || has('일자') || has('거래일시')) && (has('출금') || has('찾으신') || has('지급') || has('거래금액')) && (has('입금') || has('맡기신') || has('구분') || has('잔액'))) return { kind: '은행', grid, hi: i }
    }
  }
  // 머리 줄이 없는 카드 사용내역 (기업카드 'IBK컴퍼니카드' 등): 가린 카드번호(4140-****-****-7973) 칸으로 알아봄
  for (const grid of grids) {
    const g = guessCardGrid(grid)
    if (g) return { kind: '카드', grid: g, hi: 0 }
  }
  // 머리 줄이 없는 은행 파일 (기업은행 거래내역조회 등): 잔액이 맞는 칸 조합을 찾아 읽음
  for (const grid of grids) if (guessBankCols(grid)) return { kind: '은행', grid, hi: -1 }
  return { kind: '알 수 없음', grid: grids[0] ?? [], hi: -1 }
}

const CARD_NO = /^\d{4}-[*\\]{4,8}-[*\\]{4,8}-\d{3,4}$/
/** 머리 줄 없는 카드 표 → 머리 줄을 만들어 붙임 (이용일자 · 가맹점명 · 이용금액 · 승인번호) */
export function guessCardGrid(grid: Grid): Grid | null {
  const rows = grid.filter(r => r.some(c => CARD_NO.test(String(c ?? '').trim())) && r.some(c => /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(String(c ?? '').trim())))
  if (rows.length < 2) return null
  const width = Math.max(...rows.map(r => r.length))
  const col = (f: (v: string) => boolean) => {
    const counts = Array.from({ length: width }, (_, j) => rows.filter(r => f(String(r[j] ?? '').trim())).length)
    const best = Math.max(...counts)
    return best >= rows.length * 0.8 ? counts.indexOf(best) : -1
  }
  const date = col(v => /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(v))
  const card = col(v => CARD_NO.test(v))
  const amount = col(v => /^-?\d{1,3}(,\d{3})+$|^-?\d{1,6}$/.test(v) && v !== '0' && /,/.test(v) || /^[1-9]\d{2,6}$/.test(v) && false)
  if (date < 0 || card < 0 || amount < 0) return null
  // 가맹점: 글자 칸 중 값이 가장 다양한 칸 (카드 종류 · 통화 · 할부 같은 되풀이 칸은 제외)
  let merchant = -1
  let most = 0
  for (let j = 0; j < width; j++) {
    if ([date, card, amount].includes(j)) continue
    const vals = rows.map(r => String(r[j] ?? '').trim()).filter(v => v && !isNum(v) && !/^\d{4}[.\-/]/.test(v))
    const distinct = new Set(vals).size
    if (vals.length >= rows.length * 0.8 && distinct > most) { most = distinct; merchant = j }
  }
  if (merchant < 0) return null
  // 승인번호: 8자리 숫자 칸
  const approval = col(v => /^\d{8}$/.test(v))
  const head: (string | null)[] = Array.from({ length: width }, () => null)
  head[date] = '이용일자'
  head[merchant] = '가맹점명'
  head[amount] = '이용금액'
  if (approval >= 0) head[approval] = '승인번호'
  return [head, ...rows]
}

interface BankCols {
  date: number
  time: number
  out: number
  inn: number
  amt: number
  type: number
  bal: number
  descs: number[]
  /** 머리 줄 없는 파일: 여러 줄에 되풀이되는 값(은행 이름 · '기업스마트뱅킹' 등)은 내용에서 뺌 */
  common?: Set<string>
  start: number
}
/** 내용에서 뺄 값: 은행 이름 · 거래 경로 (기업스마트뱅킹 · 타행이체 등) */
const CHANNEL = /^(.{1,6}(은행|뱅크|금고|농축협|우체국)|기업스마트뱅킹|인터넷|인터넷뱅킹|스마트뱅킹|모바일|타행이체|타행환|펌이체|펌뱅킹|CMS|CC|BC|ATM|창구)$/
const isNum = (v: unknown) => /^-?[\d,]+(\.\d+)?$/.test(String(v ?? '').trim())
/** 머리 줄 없는 은행 표: 날짜 칸 + 숫자 칸 셋(출금 · 입금 · 잔액)을 잔액 계산이 맞는 조합으로 고름 */
export function guessBankCols(grid: Grid): BankCols | null {
  const rows = grid.map((r, i) => ({ r, i })).filter(({ r }) => r.some(c => /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(String(c ?? '').trim())))
  if (rows.length < 3) return null
  const width = Math.max(...rows.map(x => x.r.length))
  const count = (f: (v: unknown) => boolean) => Array.from({ length: width }, (_, j) => rows.filter(x => f(x.r[j])).length)
  const dc = count(v => /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(String(v ?? '').trim()))
  const date = dc.indexOf(Math.max(...dc))
  const nc = count(isNum)
  const numCols = nc.map((n, j) => (j !== date && n >= rows.length * 0.8 ? j : -1)).filter(j => j >= 0).slice(0, 7)
  if (numCols.length < 3) return null
  let best: { o: number; i: number; b: number; score: number } | null = null
  for (const o of numCols)
    for (const i of numCols)
      for (const b of numCols) {
        if (o === i || o === b || i === b) continue
        let desc = 0
        let asc = 0
        for (let k = 0; k + 1 < rows.length; k++) {
          const a = rows[k].r
          const z = rows[k + 1].r
          if (num(a[b]) === num(z[b]) + num(a[i]) - num(a[o])) desc++
          if (num(z[b]) === num(a[b]) + num(z[i]) - num(z[o])) asc++
        }
        const score = Math.max(desc, asc) / (rows.length - 1)
        if (!best || score > best.score) best = { o, i, b, score }
      }
  if (!best || best.score < 0.7) return null
  const text = Array.from({ length: width }, (_, j) => j).filter(j => j !== date && !numCols.includes(j))
  // 거래 내용(상대방 · 적요) 칸이 없으면 거래 내역이 아님 (예: 카드 월별 청구 요약표)
  if (!text.some(j => rows.filter(({ r }) => String(r[j] ?? '').trim() && !isNum(r[j])).length >= rows.length * 0.5)) return null
  const freq = new Map<string, number>()
  for (const { r } of rows) for (const v of new Set(text.map(j => String(r[j] ?? '').trim()))) if (v) freq.set(v, (freq.get(v) ?? 0) + 1)
  const common = new Set([...freq].filter(([, n]) => n >= Math.max(8, rows.length * 0.6)).map(([v]) => v))
  return { date, time: -1, out: best.o, inn: best.i, amt: -1, type: -1, bal: best.b, descs: text, common, start: rows[0].i }
}

const BANKS = ['국민', '신한', '우리', '하나', '기업', '농협', '카카오', '토스', '케이', 'SC', '씨티', '수협', '부산', '대구', '경남', '광주', '전북', '제주', '새마을', '우체국', '신협', 'IBK', 'KB', 'NH']
function accountName(grid: Grid, hi: number, file: string): string {
  const top = grid.slice(0, Math.max(hi, 0)).flat().map(c => String(c ?? '')).join(' ') + ' ' + file
  const bank = BANKS.find(b => top.includes(b)) ?? '통장'
  const acct = top.match(/(\d{2,6}[-\s]?\d{2,6}[-\s]?\d{2,8}(?:[-\s]?\d{1,4})?)/)?.[1]?.replace(/\D/g, '')
  if (acct) return `${bank} ${acct.slice(-4)}`
  // 기술보증기금 대출 통장 (파일 이름 '기보통장' · '기업은행-기보') 은 한 통장으로
  if (/기보/.test(file)) return '기업 기보'
  // 계좌번호가 없으면 파일 이름으로 통장 구분 (예: '기업은행-기보' → '기업 기보', '기업은행 거래내역조회-2' → '기업')
  const extra = file
    .replace(/\.[^.]+$/, '')
    .replace(/거래내역조회|거래내역|입출식|예금|통장내역/g, '')
    .replace(/\(\d+\)|[-_ ]\d+$/g, '')
    .replace(new RegExp(`${bank}(은행)?`), '')
    .replace(/[-_()\s]+/g, ' ')
    .trim()
  return `${bank} ${extra}`.trim()
}

// ---------- 분류 ----------
const RULES: { re: RegExp; dir?: LedgerDirection; cat: string; transfer?: boolean }[] = [
  // 카드사 리스 · 렌트료는 카드대금이 아니라 비용 (2026-11-11 대사에서 확인)
  { re: /카드\s*(리스|렌트)/, dir: '출금', cat: '임대료' },
  { re: /(국민|신한|삼성|현대|롯데|하나|우리|비씨|BC|NH|농협|KB)\s*카드|카드대금|카드결제/, dir: '출금', cat: '카드대금', transfer: true },
  // 우리 회사(아트리어) 통장끼리 옮긴 돈. 더위클리컴퍼니는 세금계산서를 받는 거래처라 매출 (2026-11-12 대사: 계산서 8억 3천 = 입금 순액)
  // 신탁사가 대신 보낸 돈(받는 이름에 우리 회사가 찍힘)은 이체가 아님
  { re: /^(?!.*신탁)(?=.*(아트리어|본인|자기앞|계좌이동|대체))/, cat: '내 통장 이체', transfer: true },
  { re: /더위클리컴퍼니|신탁/, dir: '입금', cat: '매출 · 용역' }, // 가민 프로젝트 거래처 · 신탁사 대리 입금
  // 대표가 직접 정한 가게 (2026-11-11)
  { re: /프리웨이파켓/, dir: '출금', cat: '교통 · 운반' },
  { re: /바이브컴퍼니/, dir: '출금', cat: '구독 · 소프트웨어' },
  { re: /브리즘/, dir: '출금', cat: '재료 · 소품' },
  { re: /시드디자인/, dir: '출금', cat: '임대료' }, // 사무실 임대료 (대표 확인 2026-11-11)
  { re: /급여|월급|상여|퇴직/, dir: '출금', cat: '인건비' },
  { re: /국민연금|건강보험|고용보험|산재|4대보험|국민건강/, dir: '출금', cat: '인건비' },
  { re: /국세|지방세|부가세|부가가치세|원천세|세무서|구청|시청|관세|자동차세|재산세|주민세|법인세|종합소득/, dir: '출금', cat: '세금 · 공과금' },
  { re: /법원|대법원|등기|인지세|공증|주민센터|민원/, dir: '출금', cat: '세금 · 공과금' },
  { re: /월세|임대료|임차|관리비/, dir: '출금', cat: '임대료' },
  { re: /이자|결산/, dir: '입금', cat: '이자 · 환급' },
  { re: /환급|환불/, dir: '입금', cat: '이자 · 환급' },
  { re: /대출이자|이자/, dir: '출금', cat: '이자 · 금융비용' },
  { re: /기술보증기금|보증보험|신용보증/, dir: '출금', cat: '이자 · 금융비용' },
  { re: /손해보험|화재보험|생명보험|자동차보험/, dir: '출금', cat: '보험료' },
  { re: /세무서|국세환급|지방세환급/, dir: '입금', cat: '이자 · 환급' },
  { re: /수수료|벤처기업확인|산업연합회|세무회계|회계법인|노무법인|법무사/, dir: '출금', cat: '수수료' },
  { re: /고용노동부|고용센터|근로복지공단|중소벤처기업진흥|창업진흥|지원금|보조금/, dir: '입금', cat: '지원금' },
  { re: /네이버|구글|google|메타|facebook|FACEBK|페이스북|인스타|카카오모먼트|광고/i, dir: '출금', cat: '광고비' },
  { re: /(^|[^A-Za-z])KT([^A-Za-z]|$)|SKT|SK텔레콤|LG유플러스|U\+|통신요금|이동통신|인터넷요금/, dir: '출금', cat: '통신비' },
  { re: /adobe|어도비|notion|노션|slack|슬랙|figma|피그마|google workspace|microsoft|aws|구독/i, dir: '출금', cat: '구독 · 소프트웨어' },
  { re: /택시|주유|고속도로|하이패스|코레일|ktx|srt|주차|퀵|화물|용달|운송|교통버스|교통지하철|카카오\s?T|대리운전|티머니|항공|철도|도로공사|순환도로|톨게이트|통행료|카카오모빌리티|파킹|파크|세차|워시|wash|휴게소|대교|지하도로|관통도로|시내버스|렌트카|렌터카|물류|택배|아마노|주차장|시설관리공단/i, dir: '출금', cat: '교통 · 운반' },
  { re: /쿠팡이츠|배달의민족|요기요/, dir: '출금', cat: '식대 · 경비' },
  { re: /다이소|쿠팡|철물|건재|목재|볼트|공구|자재|문구|오피스|화방|인쇄|출력|전자|조명|페인트|타일|유리|하드웨어|홈플러스|트레이더스|코스트코|이케아|ikea|오늘의집/i, dir: '출금', cat: '재료 · 소품' },
  { re: /shutterstock|셔터스톡|게티|getty|envato|canva|캔바|openai|chatgpt|claude|apple\.com|nice\(빌링\)|apple|autodesk|넷플릭스|netflix|유튜브|youtube|멜론|코웨이|렌탈|멤버십/i, dir: '출금', cat: '구독 · 소프트웨어' },
  { re: /식당|카페|커피|다방|스타벅스|투썸|이디야|메가|컴포즈|편의점|씨유|CU\)|GS25|세븐일레븐|이마트24|마트|국밥|짬뽕|짜장|돈까스|돈가스|치킨|피자|버거|롯데리아|KFC|맥도날드|설렁탕|순대|김밥|분식|밥|식육|고기|갈비|삼겹|족발|보쌈|초밥|스시|라멘|우동|국수|냉면|베이커리|빵|제과|떡|도시락|푸드|키친|다이닝|레스토랑|비스트로|주점|호프|포차|닭|쌀국수|타코|샐러드|백화점|파리바게뜨|뚜레쥬르|카츠|던킨|배스킨|공차|쥬스|주스|샤브|반점|회관|곰탕|삼계탕|흑돼지|장어|찌개|덤플링|브루어리|탭하우스|써브웨이|애슐리|식품관|노래바|양대창|한식/i, dir: '출금', cat: '식대 · 경비' },
  { re: /호텔|리조트|모텔|숙박|에어비앤비|airbnb/i, dir: '출금', cat: '교통 · 운반' },
  // 2025 카드 명세서 대사에서 확인한 가게 (2026-11-12)
  { re: /휴대폰메시지|승인안내|연회비/, dir: '출금', cat: '수수료' },
  { re: /agoda|아고다|나이스인프라|와이이에스|동일빌딩|서교흥업|리더스타워|서울디자인재단|타다|TADA|자동차.*(센터|서비스)|블루핸즈|FreewayMarket/i, dir: '출금', cat: '교통 · 운반' },
  { re: /엔에이엘소프트|다우데이타/, dir: '출금', cat: '구독 · 소프트웨어' },
  { re: /교보문고|영풍문고|무인양품|포장|올리브영|씨제이올리브/, dir: '출금', cat: '재료 · 소품' },
  // 대표 확인 2026-11-12: 의류 · 아울렛 · 꽃 · 피아노 · 통신판매는 촬영 · 팝업 소품
  { re: /아울렛|유니클로|플라워|꽃집|피아노|통신판매/, dir: '출금', cat: '재료 · 소품' },
  { re: /지에스\s*(\(GS\))?25|노브랜드|스타필드마켓|하나로|농협.*유통|오아시스|우아한형제들|감자탕|마라탕|만두|면옥|생선|어가|과메기|파스타|오픈더도우|크리스피|노티드|포케|다운타우너|아웃백|할리스|금옥당|한과|꿀타래|크리스탈제이드|스테이키|애니버셔리|생활협동/i, dir: '출금', cat: '식대 · 경비' },
]
const clean = (s: string) => s.replace(/\(주\)|주식회사|㈜|\s/g, '').toLowerCase()

/** 급여 받는 사람 이름 (팀원 + 예전에 인건비로 분류한 상대방) — 대표 지시 2026-11-11 '급여처리' */
let STAFF = new Set<string>()
/** 대표 이름 (CLAUDE.md: 대표 박기호) */
const OWNER = '박기호'
export function setStaffNames(names: string[]) {
  STAFF = new Set(names.map(n => n.trim()).filter(n => /^[가-힣]{2,4}$/.test(n)))
}
export function classify(desc: string, dir: LedgerDirection, amount: number, date: string, payments: Payment[]) {
  const who = desc.split(' · ')[0].trim()
  // 대표 ↔ 회사 자금 (100만 원 단위 송금 · 대표가 넣은 돈) = 가지급 · 가수 (합계 제외)
  if (who.startsWith(OWNER) && (dir === '입금' || amount % 1000000 === 0))
    return { category: '대표 가지급 · 가수', project_id: null, counterparty: who, is_transfer: true, needs_review: false, matched: null }
  // 0) 팀원 이름으로 보낸 돈 = 급여 (단, 100만 원 단위로 딱 떨어지는 대표 송금 등은 제외)
  if (dir === '출금' && STAFF.has(who) && amount % 1000000 !== 0)
    return { category: '인건비', project_id: null, counterparty: who, is_transfer: false, needs_review: false, matched: null }
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
      // 결제 대장의 공종(금속공사 · 부스설치 등)은 회계 분류 '외주 · 협력사'로 (대표 지시 2026-11-11)
      category: dir === '출금' ? (hit.category && LEDGER_CATEGORIES['출금'].includes(hit.category) ? hit.category : '외주 · 협력사') : '매출 · 용역',
      // 프로젝트와는 연결하지 않음 (대표 지시 2026-11-11)
      project_id: null,
      counterparty: hit.payee || null,
      is_transfer: false,
      needs_review: false,
      matched: hit.id,
    }
  // 2) 낱말 규칙
  for (const r of RULES) if ((!r.dir || r.dir === dir) && r.re.test(desc)) return { category: r.cat, project_id: null, counterparty: null, is_transfer: !!r.transfer, needs_review: false, matched: null }
  // 3) 계좌이체 기본값 (대표 지시 '전부 반영' 2026-11-11): 회사 · 사람에게 보낸 돈 = 외주 · 협력사, 회사에서 받은 돈 = 매출
  const company = /\(주\)|（주）|㈜|주식회사|유한회사|법인|건설|디자인|공사|산업|기업/.test(who)
  const person = /^[가-힣]{2,4}([（(].*)?$/.test(who)
  if (!/카드|이자|결산/.test(who) && (company || person) && amount >= 10000) {
    if (dir === '출금') return { category: '외주 · 협력사', project_id: null, counterparty: who, is_transfer: false, needs_review: false, matched: null }
    if (company) return { category: '매출 · 용역', project_id: null, counterparty: who, is_transfer: false, needs_review: false, matched: null }
  }
  // 4) 모르면 확인 필요
  return { category: dir === '입금' ? '기타 입금' : '기타 출금', project_id: null, counterparty: null, is_transfer: false, needs_review: true, matched: null }
}

// ---------- 은행 ----------
export async function parseBank(grid: Grid, hi: number, file: string, fileId: string, payments: Payment[]): Promise<LedgerRow[]> {
  let c: BankCols | null
  if (hi < 0) c = guessBankCols(grid)
  else {
    const head = grid[hi].map(norm)
    c = {
      date: pick(head, ['거래일시', '거래일자', '거래일', '일자', '날짜']),
      time: pick(head, ['거래시간', '시간']),
      out: pick(head, ['출금액', '출금금액', '찾으신금액', '지급액', '출금']),
      inn: pick(head, ['입금액', '입금금액', '맡기신금액', '입금']),
      amt: pick(head, ['거래금액', '금액']),
      type: pick(head, ['입출금구분', '거래구분', '구분']),
      bal: pick(head, ['거래후잔액', '잔액', '잔고']),
      descs: ['적요', '기재내용', '거래내용', '내용', '받는분', '보낸분', '입금자명', '상대방', '예금주', '거래처', '거래점', '메모', '비고']
        .map(n => head.findIndex(h => h.includes(n)))
        .filter((i, k, a) => i >= 0 && a.indexOf(i) === k),
      start: hi + 1,
    }
  }
  if (!c) return []
  const account = accountName(grid, hi, file)
  const out: LedgerRow[] = []
  const cc = c
  for (const r of grid.slice(c.start)) {
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
    const desc = [...new Set(cc.descs.map(i => String(r[i] ?? '').trim()).filter(v => v && !/^[\d\-]+$/.test(v) && !CHANNEL.test(v) && !cc.common?.has(v)))].join(' · ').slice(0, 300)
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
export async function parseCardLike(grid: Grid, hi: number, kind: '카드' | '현금영수증', payments: Payment[], file = '', modified: string | null = null): Promise<{ rows: LedgerRow[]; evidence: Evidence[] }> {
  let refDate = statementRef(file, modified)
  // 파일 이름에 달이 없으면 명세서 안의 달들로 청구 달을 짐작 (11 · 12 · 01월이 섞이면 01월이 청구 달)
  if (!/(?:^|\D)\d{1,2}\s*월|20\d{2}[.\-_]?\d{2}/.test(file)) {
    const dc = pick(grid[hi].map(norm), ['승인일자', '사용일자', '거래일자', '매출일시', '거래일시', '이용일자', '일자'])
    const months = grid.slice(hi + 1).map(r => String(r[dc] ?? '').trim().match(/^(\d{1,2})[.\-/]\d{1,2}$/)?.[1]).filter(Boolean).map(Number)
    if (months.length) {
      const wrap = months.some(m => m >= 10) && months.some(m => m <= 3)
      const mo = wrap ? Math.max(...months.filter(m => m <= 6)) : Math.max(...months)
      const y = mo <= refDate.getMonth() + 1 ? refDate.getFullYear() : refDate.getFullYear() - 1
      refDate = new Date(y, mo, 0)
    }
  }
  const top = grid.slice(0, hi + 1).flat().map(x => String(x ?? '')).join(' ') + ' ' + file
  const company = ['현대', '우리', '국민', 'KB', '신한', '삼성', '롯데', '하나', 'IBK', '기업', '비씨', 'BC', 'NH', '농협'].find(b => top.toUpperCase().includes(b))
  const label = /홈택스|사업용/.test(top) || !company ? '사업용 카드' : company === 'IBK' || company === '기업' ? '기업카드' : `${company}카드`
  const seen = new Map<string, number>()
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
    const date = toDateRef(r[c.date], refDate)
    if (!date) continue
    const vat = c.vat >= 0 ? num(r[c.vat]) : 0
    let total = c.total >= 0 ? num(r[c.total]) : 0
    const supply = c.supply >= 0 ? num(r[c.supply]) : total - vat
    if (!total) total = supply + vat
    if (!total) continue
    const merchant = String(r[c.merchant] ?? '').trim().slice(0, 100)
    const key = [date, merchant, total, String(r[c.no] ?? ''), timeOf(r[c.date])].join('|')
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    // 같은 날 같은 가게 같은 금액이 여러 번이면 두 번째부터 번호를 붙여 따로 기입
    const ref = `${kind}:${await hash(n > 1 ? `${key}#${n}` : key)}`
    if (kind === '현금영수증') {
      evidence.push({ date, direction: total < 0 ? '입금' : '출금', total: Math.abs(total), supply: Math.abs(supply), vat: Math.abs(vat), partner: merchant, kind: '현금영수증', ref })
      continue
    }
    const dir: LedgerDirection = total < 0 ? '입금' : '출금' // 카드 취소는 들어온 돈으로
    // 취소도 같은 가게의 출금 규칙으로 알아보고, 알아보면 '이자 · 환급' (다시 분류 버튼과 같은 방식)
    const k = classify(merchant.replace(/^취소/, ''), '출금', Math.abs(total), date, dir === '입금' ? [] : payments)
    rows.push({
      entry_date: date,
      direction: dir,
      amount: Math.abs(total),
      category: dir === '입금' ? (k.needs_review ? '기타 입금' : '이자 · 환급') : k.is_transfer ? '기타 출금' : k.category,
      counterparty: merchant || null,
      method: '카드',
      memo: `${label}${total < 0 ? ' · 취소' : ''}`,
      project_id: k.project_id,
      account: label,
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
  const hit = (r: (typeof rows)[number], e: Evidence) => {
    const p = clean(e.partner.replace(/\(.*?\)/g, '')).slice(0, 4)
    return !!p && clean(`${r.counterparty ?? ''}${r.memo ?? ''}`).includes(p)
  }
  // 이름이 맞는 짝을 모두 먼저 정한 뒤(1차), 금액만 맞는 짝은 개인 사업자(대표 이름) · 신탁사 대리 입금만 7일 안에서(2차)
  // — 2026-11-12 대사: 금액만 보고 붙이면 다른 업체 · 팀원 급여에 잘못 붙음
  for (const pass of [1, 2]) {
    for (const e of ev) {
      if (out.some(o => o.ev === e)) continue
      const d0 = Date.parse(e.date)
      let best = -1
      let bestGap = Infinity
      rows.forEach((r, i) => {
        if (used.has(i) || r.evidence || r.direction !== e.direction || r.amount !== e.total) return
        const gap = Math.abs(Date.parse(r.entry_date) - d0)
        if (pass === 1 ? gap > 45 * 864e5 || !hit(r, e) : gap > 7 * 864e5) return
        if (pass === 2) {
          const who = (r.counterparty ?? '').trim()
          const ok = e.kind !== '세금계산서' || (e.direction === '출금' ? /^[가-힣]{2,4}([（(].*)?$/.test(who) && !STAFF.has(who) : /신탁/.test(`${who}${r.memo ?? ''}`))
          if (!ok) return
        }
        if (gap < bestGap) {
          best = i
          bestGap = gap
        }
      })
      if (best >= 0) {
        used.add(best)
        out.push({ index: best, ev: e })
      }
    }
  }
  return out
}

/** 홈택스 세금계산서 합계표 읽기: 머리 '거래기간 2026-01-01 ~ 2026-06-30' · '매출(매입) 합계표 명세서' 아래 거래처별 줄 */
export interface InvoiceSummaryRow {
  direction: '매출' | '매입'
  period_from: string
  period_to: string
  partner_biz_no: string
  partner_name: string | null
  count: number
  supply: number
  vat: number
  total: number
}
export function parseInvoiceSummary(grid: Grid, hi: number): InvoiceSummaryRow[] {
  const top = grid.slice(0, hi).flat().map(c => String(c ?? '')).join(' ')
  const period = top.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/)
  if (!period) return []
  const direction = /매출\s*합계표|매출처\s*수/.test(top) ? '매출' : '매입'
  const head = grid[hi].map(norm)
  const col = (k: string[]) => head.findIndex(h => k.some(x => h.includes(x)))
  const c = { biz: col(['등록번호']), name: col(['상호']), cnt: col(['매수']), supply: col(['공급가액']), vat: col(['세액']), total: col(['합계금액', '합계']) }
  const out: InvoiceSummaryRow[] = []
  for (const r of grid.slice(hi + 1)) {
    if (!/^\d+$/.test(String(r[0] ?? '').trim())) continue
    const biz = String(r[c.biz] ?? '').trim()
    if (!biz) continue
    out.push({ direction, period_from: period[1], period_to: period[2], partner_biz_no: biz, partner_name: String(r[c.name] ?? '').trim() || null, count: num(r[c.cnt]), supply: num(r[c.supply]), vat: num(r[c.vat]), total: num(r[c.total]) })
  }
  return out
}
