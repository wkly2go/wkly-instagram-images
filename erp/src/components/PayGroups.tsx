// 현장 결제를 업체(받는 사람) · 발주처별로 묶고 1차 · 2차 · 3차로 나눠 보여 줌 (대표 지시 2026-10-30
//   "입금 비율 나눠야 하고 지급률로 표시, 1 · 2 · 3차로 구분, 위아래 합쳐")
//   - 묶음 머리: 업체 · 계약(또는 합계) · 지급률(수금률) 막대 · 잔액 · 계좌 · [다음 차수] [비율로 나누기]
//   - 차수 줄: n차 · 비율(계약 또는 합계 대비) · 항목 · 금액 · 상태 · 날짜 · 계산서
// 2026-10-31 대표 지시 "협력업체 · 클라이언트와의 현금 흐름을 계약금 · 중도금 · 잔금 구조로, 중도금 회차는 변경 가능하게"
//   - 단계 = 순서로 정함: 1건 일시불 · 2건 계약금/잔금 · 3건 이상 계약금 / 중도금 1~n차 / 잔금 (취소 · 예상 비용 제외)
//   - [계약금 · 중도금 · 잔금] 버튼: 비율(예 30/40/30, 중도금 2회면 30/20/20/30)로 업체(발주처) 전체를 다시 나눔
//     이미 끝난(완료) 단계는 그대로 두고 남은 금액만 남은 단계에 나눔 · 남는 줄은 '취소'(지우지 않음) · 모자라면 새 줄(예정)
import { Fragment } from 'react'
import { Plus, Split } from 'lucide-react'
import { useAction, useApp } from '../lib/app'
import { manwon, shortDate, todayKey } from '../lib/date'
import { contractKey, contractRows, isDone, isOverdue, projectMoney, supply } from '../lib/finance'
import type { BudgetLine, Payment, ProjectFinance } from '../lib/types'
import { askText } from './Ask'
import { AccountCell } from './PayDash'
import { Meter } from './charts'
import { Badge, Button, type Tone } from './ui'

const PAY_TONE: Record<Payment['status'], Tone> = { 예정: 'outline', 청구: 'yellow', 대기: 'yellow', 완료: 'acid', 보류: 'paper', 취소: 'paper' }
const order = (p: Payment) => p.requested_date ?? p.due_date ?? p.paid_date ?? p.created_at.slice(0, 10)
/** 단계 글의 순서 값: 계약금 0 · 중도금 n차 n · 잔금 끝 · 예전 'n차' 는 n · 없으면 null */
const stageNo = (p: Payment) => {
  const t = p.stage ?? ''
  if (/계약금/.test(t)) return 0
  if (/잔금|일시불/.test(t)) return 900
  const mid = /중도금\s*(\d+)?/.exec(t)
  if (mid) return Number(mid[1] ?? 1)
  const m = /(\d+)\s*차/.exec(t)
  return m ? Number(m[1]) : null
}
const bySeq = (a: Payment, b: Payment) => (stageNo(a) ?? 500) - (stageNo(b) ?? 500) || order(a).localeCompare(order(b)) || a.created_at.localeCompare(b.created_at)
/** 단계 글에서 구조 표시(계약금 · 중도금 n차 · 잔금 · n차 · 50%)는 빼고 남은 말 */
const stageWord = (s: string | null) =>
  (s ?? '')
    .replace(/계약금|중도금(\s*\d+\s*차)?|잔금|일시불|\d+\s*차/g, '')
    .replace(/\d+(\.\d+)?\s*%/g, '')
    .replace(/[·\s]+/g, ' ')
    .trim()
/** i 번째(0부터) · 전체 n 건일 때 단계 이름 */
export const stageLabel = (i: number, n: number) => (n <= 1 ? '일시불' : i === 0 ? '계약금' : i === n - 1 ? '잔금' : n === 3 ? '중도금' : `중도금 ${i}차`)
/** 단계에 드는 결제: 취소 · 예상 비용 · 환불(마이너스) 제외 */
/** 복사한 줄의 항목명에서 단계 표시(1차 · 선금 · 잔금 · 50% …)를 뺌 */
const plainTitle = (t: string) => t.replace(/\d+\s*차|선금|계약금|중도금|잔금|일시불|\d+(\.\d+)?\s*%/g, '').replace(/[·\s]+/g, ' ').trim() || '대금'
const live = (p: Payment) => p.status !== '취소' && !p.is_estimate && p.amount > 0

interface Group {
  key: string
  dir: Payment['direction']
  name: string
  category: string | null
  items: Payment[]
  /** 비율 기준 (공급가): 계약이 있으면 계약, 없으면 차수 합계 */
  base: number
  contract: number | null
  done: number
  rate: number | null
  remain: number
  bank: string | null
  account: string | null
  holder: string | null
}

export function PayGroups({ rows, all, lines, finance, sel, setSel, onOpen, onNew }: { rows: Payment[]; all: Payment[]; lines: BudgetLine[]; finance: ProjectFinance | undefined; sel: Set<string>; setSel: (s: Set<string>) => void; onOpen: (p: Payment) => void; onNew: (preset: Partial<Payment>) => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const contracts = new Map(contractRows(all, lines).map(c => [c.key, c]))
  const m = projectMoney(finance, all.filter(p => p.direction === '수금'), [], today)

  // 필터에 걸린 줄(rows)만 묶되, 비율 · 지급률은 그 업체의 모든 결제(all)로 계산
  const map = new Map<string, Payment[]>()
  for (const p of rows) {
    const k = p.direction === '수금' ? `in|${p.project_id}` : contractKey(p)
    map.set(k, [...(map.get(k) ?? []), p])
  }
  const groups: Group[] = [...map.entries()].map(([key, items]) => {
    const first = items[0]
    const dir = first.direction
    const everyone = all.filter(p => p.status !== '취소' && !p.is_estimate && (dir === '수금' ? p.direction === '수금' && p.project_id === first.project_id : p.direction === '지급' && contractKey(p) === key))
    const sumAll = everyone.reduce((n, p) => n + supply(p), 0)
    const c = dir === '지급' ? contracts.get(key) : undefined
    const contract = dir === '수금' ? m.contract : c?.contract ?? null
    const base = contract ?? sumAll
    const done = everyone.filter(isDone).reduce((n, p) => n + supply(p), 0)
    const withAcc = [...everyone].reverse().find(p => p.account_no)
    return {
      key,
      dir,
      name: dir === '수금' ? `수금 · ${first.payee?.trim() || '발주처'}` : first.payee?.trim() || first.title,
      category: dir === '수금' ? '계약 대비 입금' : c?.category ?? first.category,
      items: [...items].sort(bySeq),
      base,
      contract,
      done,
      rate: base > 0 ? (done / base) * 100 : null,
      remain: base - done,
      bank: withAcc?.bank_name ?? null,
      account: withAcc?.account_no ?? null,
      holder: withAcc?.account_holder ?? null,
    }
  })
  groups.sort((a, b) => (a.dir === b.dir ? b.remain - a.remain : a.dir === '수금' ? -1 : 1))

  /** 그 업체(발주처)의 살아 있는 결제 전부, 단계 순서대로 (필터와 상관없이 같은 단계) */
  const chain = (g: Group, pid: string) => all.filter(x => live(x) && (g.dir === '수금' ? x.direction === '수금' && x.project_id === pid : x.direction === '지급' && contractKey(x) === g.key)).sort(bySeq)
  const stageOf = (g: Group, p: Payment) => {
    if (!live(p)) return null
    const list = chain(g, p.project_id ?? '')
    const i = list.findIndex(x => x.id === p.id)
    return i < 0 ? null : stageLabel(i, list.length)
  }
  /** 단계 글을 순서에 맞게 다시 적음 (비율 · 다른 말은 유지) */
  const relabel = async (list: Payment[], base: number) => {
    for (let i = 0; i < list.length; i++) {
      const x = list[i]
      const pct = base > 0 ? `${Math.round((supply(x) / base) * 1000) / 10}%` : null
      const want = [stageLabel(i, list.length), pct, stageWord(x.stage) || null].filter(Boolean).join(' · ')
      if (x.stage !== want) await api.savePayment({ id: x.id, stage: want })
    }
  }

  /** 계약금 · 중도금(n회) · 잔금 비율로 업체 전체를 다시 나눔 */
  const structure = async (g: Group) => {
    const pid = g.items[0].project_id ?? ''
    const list = chain(g, pid)
    if (!list.length) return
    const totalAmt = list.reduce((n, x) => n + x.amount, 0)
    const totalVat = list.reduce((n, x) => n + x.vat, 0)
    const target = g.contract != null && g.contract > 0 ? Math.round(g.contract * (totalAmt && totalAmt - totalVat ? totalAmt / (totalAmt - totalVat) : 1.1)) : totalAmt
    const cur = list.length >= 2 ? list.map(x => (totalAmt ? Math.round((x.amount / totalAmt) * 100) : 0)).join('/') : '30/40/30'
    const v = await askText(
      `계약금 / 중도금 / 잔금 비율을 적어 주세요. 처음 = 계약금, 마지막 = 잔금, 가운데 = 중도금 회차입니다.\n예) 30/40/30 (중도금 1회) · 30/20/20/30 (중도금 2회) · 50/50 (계약금 · 잔금)\n기준 금액 ${target.toLocaleString('ko-KR')}원 (VAT 포함)`,
      cur,
    )
    if (v == null) return
    const parts = v.split(/[^\d.]+/).map(Number).filter(n => n > 0)
    if (!parts.length) return
    const done = list.filter(isDone)
    const open = list.filter(x => !isDone(x))
    if (done.length >= parts.length) return void (await run(async () => undefined, '이미 끝난 단계가 나눌 단계보다 많습니다. 비율 칸 수를 늘려 주세요.'))
    // 끝난 단계는 앞에서부터 그대로, 남은 금액을 남은 비율대로
    const rest = parts.slice(done.length)
    const restSum = rest.reduce((a, b) => a + b, 0)
    const leftAmt = Math.max(0, target - done.reduce((n, x) => n + x.amount, 0))
    const vatRate = totalAmt ? totalVat / totalAmt : 1 / 11
    const amounts = rest.map(r => Math.round((leftAmt * r) / restSum))
    amounts[amounts.length - 1] = leftAmt - amounts.slice(0, -1).reduce((a, b) => a + b, 0)
    const tpl = open[open.length - 1] ?? list[list.length - 1]
    await run(async () => {
      const keep: Payment[] = []
      for (let i = 0; i < rest.length; i++) {
        const amount = amounts[i]
        const vat = Math.round(amount * vatRate)
        const reuse = open[i]
        if (reuse) {
          keep.push(await api.savePayment({ id: reuse.id, amount, vat }))
        } else {
          const { id: _id, created_at: _c, updated_at: _u, created_by: _b, ...copy } = tpl
          void _id
          void _c
          void _u
          void _b
          keep.push(await api.savePayment({ ...copy, title: plainTitle(copy.title), amount, vat, status: '예정', paid_date: null, due_date: null, requested_date: null, tax_invoice: tpl.tax_invoice === '발행' ? '미발행' : tpl.tax_invoice, tax_invoice_date: null, approval_id: null, stage: null }))
        }
      }
      // 남는 줄은 지우지 않고 '취소'
      for (const x of open.slice(rest.length)) await api.savePayment({ id: x.id, status: '취소', memo: [x.memo, '단계 재구성으로 취소'].filter(Boolean).join(' · ') })
      const final = [...done, ...keep]
      const base = g.contract != null && g.contract > 0 ? g.contract : final.reduce((n, x) => n + supply(x), 0)
      await relabel(final, base)
    }, `${parts.length <= 1 ? '일시불' : parts.length === 2 ? '계약금 · 잔금' : `계약금 · 중도금 ${parts.length - 2}회 · 잔금`}으로 나눴습니다. 새 단계는 예정일을 넣어 주세요.`)
  }

  /** 한 건을 비율대로 나눔: 첫 몫은 그 건에, 나머지는 바로 뒤 새 결제(예정)로 → 업체 전체 단계 이름을 다시 적음 */
  const split = async (g: Group, p: Payment) => {
    const v = await askText(`'${p.title}' ${p.amount.toLocaleString('ko-KR')}원을 몇 대 몇으로 나눌까요? (예: 50/50, 30/40/30)`, '50/50')
    if (v == null) return
    const parts = v.split(/[^\d.]+/).map(Number).filter(n => n > 0)
    if (parts.length < 2) return
    const total = parts.reduce((a, b) => a + b, 0)
    const amounts = parts.map(n => Math.round((p.amount * n) / total))
    amounts[amounts.length - 1] = p.amount - amounts.slice(0, -1).reduce((a, b) => a + b, 0)
    const vats = parts.map(n => Math.round((p.vat * n) / total))
    vats[vats.length - 1] = p.vat - vats.slice(0, -1).reduce((a, b) => a + b, 0)
    // 나눈 뒤 업체 전체를 계약금 · 중도금 · 잔금 순서로 다시 적음
    const list = chain(g, p.project_id ?? '')
    const idx = Math.max(0, list.findIndex(x => x.id === p.id))
    await run(async () => {
      const first = await api.savePayment({ id: p.id, amount: amounts[0], vat: vats[0] })
      const { id: _id, created_at: _c, updated_at: _u, created_by: _b, ...rest } = p
      void _id
      void _c
      void _u
      void _b
      const added: Payment[] = []
      for (let i = 1; i < parts.length; i++) {
        added.push(await api.savePayment({ ...rest, title: plainTitle(rest.title), amount: amounts[i], vat: vats[i], stage: null, status: '예정', paid_date: null, due_date: null, tax_invoice: p.tax_invoice === '발행' ? '미발행' : p.tax_invoice, tax_invoice_date: null, approval_id: null }))
      }
      const final = [...list.slice(0, idx), first, ...added, ...list.slice(idx + 1)]
      await relabel(final, g.base)
    }, `${parts.length}개로 나눴습니다. 새 단계는 예정일을 넣어 주세요.`)
  }

  const next = (g: Group) => {
    const last = g.items[g.items.length - 1]
    onNew({
      direction: g.dir,
      project_id: last.project_id,
      client_id: last.client_id,
      payee: last.payee,
      category: last.category,
      contract_type: last.contract_type,
      bank_name: last.bank_name,
      account_no: last.account_no,
      account_holder: last.account_holder,
      title: last.title,
      stage: null,
      amount: g.remain > 0 ? Math.round(g.remain * (last.amount && supply(last) ? last.amount / supply(last) : 1.1)) : 0,
    })
  }

  const allIds = rows.map(p => p.id)
  return (
    <div className="table-wrap">
      <table className="table pay-groups">
        <thead>
          <tr>
            <th>
              <input type="checkbox" aria-label="모두 선택" checked={sel.size > 0 && allIds.every(id => sel.has(id))} onChange={e => setSel(e.target.checked ? new Set(allIds) : new Set())} />
            </th>
            <th style={{ width: 84 }}>단계</th>
            <th className="num" style={{ width: 64 }} title="계약(없으면 합계) 대비 이 차수의 비율, 공급가 기준">
              비율
            </th>
            <th>항목 · 물품</th>
            <th className="num">금액</th>
            <th>상태</th>
            <th className="num">날짜</th>
            <th>계산서</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <Fragment key={g.key}>
              <tr className="pg-head">
                <td colSpan={8}>
                  <div className="pg-h">
                    <span className="pg-name">
                      {g.dir === '수금' && <Badge tone="blue">수금</Badge>} <b>{g.name}</b>
                      <span className="t-cap"> {[g.category, `${g.items.length}건`].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="pg-prog">
                      <span className="t-cap">
                        {g.contract != null ? <b>계약 {manwon(g.contract)}</b> : <span className="t-muted">계약 없음 · 합계 {manwon(g.base) || '0'}</span>}
                        {' · '}
                        <b className={g.rate != null && g.rate >= 100 ? 't-blue' : ''}>
                          {g.rate == null ? '–' : `${Math.round(g.rate)}%`} {g.dir === '수금' ? '수금' : '지급'}
                        </b>
                        {' · '}
                        {g.remain > 0 ? `잔액 ${manwon(g.remain)}` : g.remain < 0 ? <span className="t-red">초과 {manwon(-g.remain)}</span> : '모두 완료'}
                      </span>
                      <Meter value={Math.min(100, Math.max(0, g.rate ?? 0))} label={g.dir === '수금' ? '수금률' : '지급률'} />
                    </span>
                    {g.dir === '지급' && <AccountCell bank={g.bank} no={g.account} holder={g.holder} payee={g.name} />}
                    <span className="pg-act">
                      <Button kind="outline" size="sm" disabled={busy} onClick={() => structure(g)} title="계약금 · 중도금(회차) · 잔금 비율로 다시 나누기 (끝난 단계는 그대로)">
                        <Split size={12} /> 계약금 · 중도금 · 잔금
                      </Button>
                      <Button kind="ghost" size="sm" onClick={() => next(g)} title="같은 업체 · 계좌로 결제 한 줄 추가 (순서대로 단계가 붙음)">
                        <Plus size={12} /> {g.dir === '수금' ? '입금 추가' : '지급 추가'}
                      </Button>
                    </span>
                  </div>
                </td>
              </tr>
              {g.items.map(p => {
                const late = isOverdue(p, today)
                const seq = stageOf(g, p)
                const ratio = g.base > 0 && p.status !== '취소' ? (supply(p) / g.base) * 100 : null
                const word = stageWord(p.stage)
                return (
                  <tr key={p.id} className={`click pg-item ${sel.has(p.id) ? 'sel' : ''} ${p.status === '취소' || p.is_estimate ? 'muted' : ''}`} onClick={() => onOpen(p)}>
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`${p.title} 선택`}
                        checked={sel.has(p.id)}
                        onChange={e => {
                          const n = new Set(sel)
                          if (e.target.checked) n.add(p.id)
                          else n.delete(p.id)
                          setSel(n)
                        }}
                      />
                    </td>
                    <td className="nowrap">
                      <span className={`pg-seq ${isDone(p) ? 'done' : ''}`}>{seq ?? (p.amount < 0 ? '환불' : '–')}</span>
                    </td>
                    <td className="num strong">{ratio != null ? `${Math.round(ratio * 10) / 10}%` : '–'}</td>
                    <td className="max">
                      <span className="strong truncate" style={{ display: 'block' }} title={p.title}>
                        {p.title}
                      </span>
                      <span className="t-cap truncate" style={{ display: 'block', maxWidth: 360 }} title={p.memo ?? undefined}>
                        {[word, p.contract_type, p.is_estimate ? '예상 비용' : null, p.memo].filter(Boolean).join(' · ') || '–'}
                      </span>
                    </td>
                    <td className={`num ${p.amount < 0 ? 'red' : ''}`}>{p.amount.toLocaleString('ko-KR')}</td>
                    <td>
                      <Badge tone={late ? 'red' : PAY_TONE[p.status]}>{late ? '연체' : p.status}</Badge>
                    </td>
                    <td className={`num ${late ? 'red' : ''}`}>
                      {p.paid_date ? shortDate(p.paid_date) : p.due_date ? <span className="t-muted">{shortDate(p.due_date)} 예정</span> : <span className="t-muted">날짜 없음</span>}
                    </td>
                    <td className="nowrap t-cap" onClick={e => e.stopPropagation()}>
                      <span className="row" style={{ gap: 6 }}>
                        {p.tax_invoice === '해당 없음' ? '–' : p.tax_invoice}
                        {p.status !== '완료' && p.status !== '취소' && (
                          <button type="button" className="icon-btn xs" disabled={busy} onClick={() => split(g, p)} aria-label="비율로 나누기" title="이 건을 비율로 여러 단계로 나누기 (예: 50/50) · 단계 이름은 순서대로 계약금 · 중도금 · 잔금">
                            <Split size={12} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
