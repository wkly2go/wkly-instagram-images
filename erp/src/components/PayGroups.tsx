// 현장 결제를 업체(받는 사람) · 발주처별로 묶고 1차 · 2차 · 3차로 나눠 보여 줌 (대표 지시 2026-10-30
//   "입금 비율 나눠야 하고 지급률로 표시, 1 · 2 · 3차로 구분, 위아래 합쳐")
//   - 묶음 머리: 업체 · 계약(또는 합계) · 지급률(수금률) 막대 · 잔액 · 계좌 · [다음 차수] [비율로 나누기]
//   - 차수 줄: n차 · 비율(계약 또는 합계 대비) · 항목 · 금액 · 상태 · 날짜 · 계산서
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
/** 단계에 적힌 차수 (예: '2차 · 50%') */
const stageNo = (p: Payment) => {
  const m = /(\d+)\s*차/.exec(p.stage ?? '')
  return m ? Number(m[1]) : null
}
const bySeq = (a: Payment, b: Payment) => (stageNo(a) ?? 999) - (stageNo(b) ?? 999) || order(a).localeCompare(order(b)) || a.created_at.localeCompare(b.created_at)
/** 단계 글에서 'n차 · 50%' 같은 표시는 빼고 남은 말 (계약금 · 잔금 …) */
const stageWord = (s: string | null) => (s ?? '').replace(/\d+\s*차/g, '').replace(/\d+(\.\d+)?\s*%/g, '').replace(/[·\s]+/g, ' ').trim()

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

  // 차수 번호는 그 업체의 모든 결제 순서로 (필터와 상관없이 같은 번호)
  const seqOf = (g: Group, p: Payment) => {
    const own = stageNo(p)
    if (own) return own
    const list = all.filter(x => x.status !== '취소' && (g.dir === '수금' ? x.direction === '수금' && x.project_id === p.project_id : x.direction === '지급' && contractKey(x) === g.key)).sort(bySeq)
    const i = list.findIndex(x => x.id === p.id)
    return i < 0 ? null : i + 1
  }

  /** 한 건을 비율대로 n차로 나눔: 첫 몫은 그 건에, 나머지는 새 결제(예정)로 */
  const split = async (g: Group, p: Payment) => {
    const v = await askText(`'${p.title}' ${p.amount.toLocaleString('ko-KR')}원을 몇 대 몇으로 나눌까요? (예: 50/50, 30/40/30)`, '50/50')
    if (v == null) return
    const parts = v.split(/[^\d.]+/).map(Number).filter(n => n > 0)
    if (parts.length < 2) return
    const total = parts.reduce((a, b) => a + b, 0)
    const pcts = parts.map(n => Math.round((n / total) * 1000) / 10)
    const amounts = parts.map(n => Math.round((p.amount * n) / total))
    amounts[amounts.length - 1] = p.amount - amounts.slice(0, -1).reduce((a, b) => a + b, 0)
    const vats = parts.map(n => Math.round((p.vat * n) / total))
    vats[vats.length - 1] = p.vat - vats.slice(0, -1).reduce((a, b) => a + b, 0)
    // 업체 전체를 다시 번호 매김: 앞은 그대로, 나눈 몫이 이어지고, 뒤는 밀림
    const list = all.filter(x => x.status !== '취소' && (g.dir === '수금' ? x.direction === '수금' && x.project_id === p.project_id : x.direction === '지급' && contractKey(x) === g.key)).sort(bySeq)
    const idx = Math.max(0, list.findIndex(x => x.id === p.id))
    const start = idx + 1
    const word = stageWord(p.stage)
    const label = (i: number) => [`${start + i}차`, `${pcts[i]}%`, word || null].filter(Boolean).join(' · ')
    await run(async () => {
      for (let j = 0; j < list.length; j++) {
        if (j === idx) continue
        const no = j < idx ? j + 1 : j + parts.length
        if (stageNo(list[j]) !== no) await api.savePayment({ id: list[j].id, stage: [`${no}차`, stageWord(list[j].stage) || null].filter(Boolean).join(' · ') })
      }
      await api.savePayment({ id: p.id, amount: amounts[0], vat: vats[0], stage: label(0) })
      const { id: _id, created_at: _c, updated_at: _u, created_by: _b, ...rest } = p
      void _id
      void _c
      void _u
      void _b
      for (let i = 1; i < parts.length; i++) {
        await api.savePayment({ ...rest, amount: amounts[i], vat: vats[i], stage: label(i), status: '예정', paid_date: null, due_date: null, tax_invoice: p.tax_invoice === '발행' ? '미발행' : p.tax_invoice, tax_invoice_date: null, approval_id: null })
      }
    }, `${parts.length}차로 나눴습니다. 2차부터는 지급예정일을 넣어 주세요.`)
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
      stage: `${(seqOf(g, last) ?? g.items.length) + 1}차`,
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
            <th style={{ width: 54 }}>차수</th>
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
                      <Button kind="ghost" size="sm" onClick={() => next(g)} title="같은 업체 · 계좌로 다음 차수 결제 추가">
                        <Plus size={12} /> {g.dir === '수금' ? '다음 입금' : '다음 차수'}
                      </Button>
                    </span>
                  </div>
                </td>
              </tr>
              {g.items.map(p => {
                const late = isOverdue(p, today)
                const seq = seqOf(g, p)
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
                      <span className={`pg-seq ${isDone(p) ? 'done' : ''}`}>{seq ? `${seq}차` : '–'}</span>
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
                          <button type="button" className="icon-btn xs" disabled={busy} onClick={() => split(g, p)} aria-label="비율로 나누기" title="이 건을 1차 · 2차 · 3차 비율로 나누기 (예: 50/50)">
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
