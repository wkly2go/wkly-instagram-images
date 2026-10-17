import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { manwon, shortDate, todayKey } from '../lib/date'
import { budgetByCategory, isOverdue, projectMoney, supply } from '../lib/finance'
import { Link } from '../lib/router'
import type { BudgetLine, Client, Payment, Project, ProjectFinance } from '../lib/types'
import { Meter } from './charts'
import { PaymentForm, parseMoney } from './PaymentForm'
import { Badge, Button, Empty, Field, Modal, type Tone } from './ui'

const PAY_TONE: Record<Payment['status'], Tone> = { 예정: 'outline', 청구: 'yellow', 대기: 'yellow', 완료: 'acid', 보류: 'paper', 취소: 'paper' }

interface Data {
  finance: ProjectFinance | undefined
  payments: Payment[]
  all: Payment[]
  lines: BudgetLine[]
}

/** 프로젝트 상세의 재무 칸 (관리자만) */
export function FinancePanel({ project, clients, projects }: { project: Project; clients: Client[]; projects: Project[] }) {
  const { api, version } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const { data } = useAsync<Data>(
    async () => {
      const [finances, all, lines] = await Promise.all([api.listFinances(), api.listPayments(), api.listBudgetLines(project.id)])
      return { finance: finances.find(f => f.project_id === project.id), all, payments: all.filter(p => p.project_id === project.id), lines }
    },
    [project.id, version],
    { finance: undefined, payments: [], all: [], lines: [] },
  )
  const [editFin, setEditFin] = useState(false)
  const [form, setForm] = useState<Payment | 'new' | null>(null)
  const [quick, setQuick] = useState({ direction: '지급' as Payment['direction'], title: '', payee: '', amount: '', due: '' })
  const [line, setLine] = useState({ category: '', payee: '', budget: '' })
  const m = projectMoney(data.finance, data.payments, data.lines, today)
  const cats = budgetByCategory(data.lines, data.payments)
  const ok = m.marginRate != null && m.target != null ? m.marginRate >= m.target : null
  const inflow = data.payments.filter(p => p.direction === '수금')

  const addQuick = async () => {
    const amount = parseMoney(quick.amount)
    if (!quick.title.trim() || !amount) return
    const client = clients.find(c => c.name === quick.payee.trim())
    const ok = await run(
      () =>
        api.savePayment({
          direction: quick.direction,
          project_id: project.id,
          title: quick.title.trim(),
          payee: quick.payee.trim() || null,
          client_id: client?.id ?? null,
          amount,
          vat: Math.round(amount / 11),
          contract_type: '세금계산서',
          tax_invoice: '미발행',
          status: '예정',
          due_date: quick.due || null,
        }),
      '추가했습니다. (VAT 10% 포함으로 계산 · 눌러서 수정)',
    )
    if (ok) setQuick(q => ({ ...q, title: '', amount: '', due: '' }))
  }
  const addLine = async () => {
    if (!line.category.trim()) return
    const ok = await run(() => api.saveBudgetLine({ project_id: project.id, category: line.category.trim(), payee: line.payee.trim() || null, budget_amount: parseMoney(line.budget), sort_order: data.lines.length + 1 }))
    if (ok) setLine({ category: '', payee: '', budget: '' })
  }

  return (
    <section className="section" aria-label="재무">
      <div className="section-h">
        <span className="t-bodyb">재무 (관리자만 보임)</span>
        <span className="cap">공급가액 · VAT 별도</span>
        <Button kind="outline" size="sm" onClick={() => setEditFin(true)}>
          계약·목표
        </Button>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="kpi">
          <span className="t-cap">계약액</span>
          <span className="v">{m.contract != null ? manwon(m.contract) : '–'}</span>
          <span className="sub">{m.contract != null ? `수금 ${manwon(m.received) || '0'} · 미수 ${manwon(m.receivable) || '0'}` : '계약·목표에서 입력'}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">비용 {m.byBudget ? '(예산)' : '(지급 합계)'}</span>
          <span className="v">{manwon(m.cost) || '0'}</span>
          <span className="sub">{m.byBudget ? '지급 내역이 아직 없음' : `완료 ${manwon(m.paid) || '0'} · 미지급 ${manwon(m.payable) || '0'}${m.estimate ? ` · 예상 ${manwon(m.estimate)}` : ''}`}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">마진</span>
          <span className="v" style={m.margin != null && m.margin < 0 ? { color: 'var(--red)' } : undefined}>
            {m.margin != null ? manwon(m.margin) : '–'}
          </span>
          <span className="sub">{m.overdueOut.length || m.overdueIn.length ? <span className="t-red">연체 {m.overdueOut.length + m.overdueIn.length}건</span> : '연체 없음'}</span>
        </div>
        <div className="kpi">
          <span className="row" style={{ gap: 6 }}>
            <span className="t-cap grow">마진율</span>
            {ok != null && <Badge tone={ok ? 'acid' : 'yellow'}>{ok ? '달성' : '미달'}</Badge>}
          </span>
          <span className="v">{m.marginRate != null ? `${m.marginRate.toFixed(1)}%` : '–'}</span>
          <Meter value={Math.max(0, m.marginRate ?? 0)} max={50} target={m.target} red={(m.marginRate ?? 0) < 0} label="마진율" />
          <span className="sub">
            목표 {m.target != null ? `${m.target}%` : '–'} · 예산 {m.budget != null ? manwon(m.budget) : '–'}
          </span>
        </div>
      </div>

      <div className="section-h" style={{ marginTop: 6 }}>
        <span className="t-smallb">공사 구분별 실행 예산</span>
        <span className="cap">집행 = 완료 + 미지급 + 예상</span>
      </div>
      {cats.length === 0 && <span className="t-cap">공사 구분(목공·전기·운영비 …)별 예산을 넣으면 초과를 바로 알려 드려요.</span>}
      {cats.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>공사 구분</th>
                <th>업체</th>
                <th className="num">예산</th>
                <th className="num">집행</th>
                <th style={{ minWidth: 120 }}>집행률</th>
                <th className="num">초과</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cats.map(r => (
                <tr key={r.category}>
                  <td className="strong nowrap">{r.category}</td>
                  <td className="nowrap">{r.lines.length ? r.payee ?? '' : <span className="t-cap">예산 없음</span>}</td>
                  <td className="num">{r.budget ? manwon(r.budget) : '–'}</td>
                  <td className="num">{manwon(r.spent) || '0'}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <Meter value={r.rate ?? (r.spent ? 100 : 0)} red={r.over > 0} label={`${r.category} 집행률`} />
                      <span className="t-meta" style={{ width: 40, textAlign: 'right' }}>
                        {r.rate != null ? `${Math.round(r.rate)}%` : ''}
                      </span>
                    </span>
                  </td>
                  <td className={`num ${r.over ? 'red' : ''}`}>{r.over ? `+${manwon(r.over)}` : '–'}</td>
                  <td className="nowrap">
                    {r.lines.length === 1 && (
                      <>
                        <button
                          type="button"
                          className="icon-btn sm"
                          aria-label="예산 수정"
                          onClick={() => {
                            const v = window.prompt(`'${r.category}' 예산 (원)`, String(r.budget))
                            if (v !== null) run(() => api.saveBudgetLine({ id: r.lines[0].id, budget_amount: Math.max(0, parseMoney(v)) }))
                          }}
                        >
                          <Pencil size={12} />
                        </button>
                        <button type="button" className="icon-btn sm" aria-label="예산 삭제" onClick={() => window.confirm(`'${r.category}' 예산 줄을 삭제할까요?`) && run(() => api.deleteBudgetLine(r.lines[0].id))}>
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                    {r.lines.length > 1 && <span className="t-cap">{r.lines.length}줄</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row wrap">
        <input className="input" style={{ flex: '1 1 120px' }} placeholder="공사 구분" value={line.category} onChange={e => setLine({ ...line, category: e.target.value })} aria-label="새 예산 공사 구분" />
        <input className="input" style={{ flex: '1 1 120px' }} placeholder="업체 (선택)" value={line.payee} onChange={e => setLine({ ...line, payee: e.target.value })} aria-label="새 예산 업체" />
        <input className="input" style={{ flex: '1 1 110px' }} inputMode="numeric" placeholder="예산 (원)" value={line.budget} onChange={e => setLine({ ...line, budget: e.target.value })} aria-label="새 예산 금액" />
        <Button kind="outline" onClick={addLine} disabled={busy || !line.category.trim()}>
          예산 줄
        </Button>
      </div>

      <div className="section-h" style={{ marginTop: 6 }}>
        <span className="t-smallb">결제 내역</span>
        <span className="cap">{m.contract ? `수금 ${Math.round(((m.received || 0) / m.contract) * 100)}% 완료` : `수금 ${inflow.length}건`}</span>
        <Link to={`/projects?view=payments&project=${project.id}`} className="t-cap">
          결제 대장 ›
        </Link>
      </div>
      {data.payments.length === 0 ? (
        <Empty>결제 내역이 없습니다. 아래에서 바로 추가하거나 결제 대장에서 엑셀을 가져오세요.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>구분</th>
                <th>내용</th>
                <th>업체</th>
                <th className="num">금액</th>
                <th>계산서</th>
                <th className="num">예정일</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map(p => {
                const late = isOverdue(p, today)
                return (
                  <tr key={p.id} className={`click ${p.status === '취소' ? 'muted' : ''}`} onClick={() => setForm(p)} title="눌러서 수정">
                    <td>
                      <Badge tone={p.direction === '수금' ? 'blue' : 'gray'}>{p.direction}</Badge>
                    </td>
                    <td className="max">
                      <span className="strong truncate" style={{ display: 'block' }}>
                        {p.title}
                      </span>
                      <span className="t-cap">{[p.category, p.stage, p.is_estimate ? '예상' : null, p.advance_by ? `대지급 ${p.advance_by}` : null].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="nowrap">{p.payee ?? '–'}</td>
                    <td className="num" title={`공급가 ${supply(p).toLocaleString('ko-KR')}원 · VAT ${p.vat.toLocaleString('ko-KR')}원`}>
                      {manwon(p.amount)}
                    </td>
                    <td className="nowrap">{p.tax_invoice === '해당 없음' ? '–' : p.tax_invoice === '발행' ? (p.direction === '지급' ? '수취' : '발행') : <span className="t-cap">미발행</span>}</td>
                    <td className={`num ${late ? 'red' : ''}`}>{shortDate(p.paid_date ?? p.due_date) || '–'}</td>
                    <td>
                      <Badge tone={late ? 'red' : p.is_estimate ? 'paper' : PAY_TONE[p.status]}>{late ? '연체' : p.is_estimate ? '예상' : p.status}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row wrap">
        <select className="select" style={{ width: 84 }} value={quick.direction} onChange={e => setQuick({ ...quick, direction: e.target.value as Payment['direction'] })} aria-label="구분">
          <option>지급</option>
          <option>수금</option>
        </select>
        <input className="input" style={{ flex: '2 1 140px' }} placeholder="내용" value={quick.title} onChange={e => setQuick({ ...quick, title: e.target.value })} aria-label="결제 내용" />
        <input className="input" style={{ flex: '1 1 110px' }} list="fin-payees" placeholder="업체" value={quick.payee} onChange={e => setQuick({ ...quick, payee: e.target.value })} aria-label="업체" />
        <datalist id="fin-payees">
          {clients.map(c => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        <input className="input" style={{ flex: '1 1 100px' }} inputMode="numeric" placeholder="금액 (VAT 포함)" value={quick.amount} onChange={e => setQuick({ ...quick, amount: e.target.value })} aria-label="금액" />
        <input className="input" style={{ width: 136 }} type="date" value={quick.due} onChange={e => setQuick({ ...quick, due: e.target.value })} aria-label="예정일" />
        <Button onClick={addQuick} disabled={busy || !quick.title.trim() || !parseMoney(quick.amount)}>
          추가
        </Button>
        <Button kind="outline" onClick={() => setForm('new')}>
          자세히 입력
        </Button>
      </div>

      {editFin && <FinanceForm project={project} finance={data.finance} hasLines={data.lines.length > 0} onClose={() => setEditFin(false)} />}
      {form && <PaymentForm payment={form === 'new' ? null : form} preset={{ project_id: project.id }} projects={projects} clients={clients} payments={data.all} lines={data.lines} onClose={() => setForm(null)} />}
    </section>
  )
}

function FinanceForm({ project, finance, hasLines, onClose }: { project: Project; finance: ProjectFinance | undefined; hasLines: boolean; onClose: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  // 회사 계약금액은 VAT 포함으로 말하므로 기본은 VAT 포함 입력 → 공급가액(÷1.1)으로 저장
  const [vatIncl, setVatIncl] = useState(true)
  const shown = (incl: boolean) => (finance?.contract_amount == null ? '' : (incl ? Math.round(finance.contract_amount * 1.1) : finance.contract_amount).toLocaleString('ko-KR'))
  const [contract, setContract] = useState(shown(true))
  const contractSupply = () => {
    if (!contract.trim()) return null
    if (contract === shown(vatIncl) && finance?.contract_amount != null) return finance.contract_amount
    const n = Math.max(0, parseMoney(contract))
    return vatIncl ? Math.round(n / 1.1) : n
  }
  const [budget, setBudget] = useState(finance?.budget_cost?.toLocaleString('ko-KR') ?? '')
  const [target, setTarget] = useState(finance?.target_margin?.toString() ?? '')
  const [memo, setMemo] = useState(finance?.memo ?? '')
  const save = async () => {
    const t = target.trim() === '' ? null : Number(target)
    if (t != null && (!isFinite(t) || t < -100 || t > 100)) return
    const ok = await run(
      () =>
        api.saveFinance({
          project_id: project.id,
          contract_amount: contractSupply(),
          budget_cost: budget.trim() ? Math.max(0, parseMoney(budget)) : null,
          target_margin: t,
          memo: memo.trim() || null,
        }),
      '저장했습니다.',
    )
    if (ok) onClose()
  }
  return (
    <Modal
      title="계약 · 목표 마진"
      onClose={onClose}
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save} disabled={busy}>
            저장
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={vatIncl ? '계약금액 (VAT 포함)' : '계약금액 (공급가액, VAT 별도)'} className="full">
          <input className="input" inputMode="numeric" autoFocus value={contract} onChange={e => setContract(e.target.value)} placeholder={vatIncl ? '예) 49,500,000' : '예) 45,000,000'} />
          <span className="row t-cap" style={{ gap: 6, marginTop: 4 }}>
            <label className="row" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={vatIncl}
                onChange={e => {
                  setVatIncl(e.target.checked)
                  if (contract === shown(vatIncl)) setContract(shown(e.target.checked))
                }}
              />
              VAT 포함 금액으로 입력
            </label>
            {vatIncl && contract.trim() && <span>→ 공급가액 {(contractSupply() ?? 0).toLocaleString('ko-KR')}원으로 저장 (마진은 공급가액 기준)</span>}
          </span>
        </Field>
        <Field label="목표 마진율 (%)">
          <input className="input" inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} placeholder="30" />
        </Field>
        <Field label={hasLines ? '예산 총액 (공사 구분별 예산 합계 사용)' : '예산 총액'}>
          <input className="input" inputMode="numeric" value={budget} disabled={hasLines} onChange={e => setBudget(e.target.value)} placeholder="32,000,000" />
        </Field>
        <Field label="메모" className="full">
          <textarea className="textarea" rows={2} value={memo} onChange={e => setMemo(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
