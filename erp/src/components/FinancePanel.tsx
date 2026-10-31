import { useState } from 'react'
import { TextLinks } from './ui'
import { useAction, useApp, useAsync } from '../lib/app'
import { manwon, shortDate, todayKey } from '../lib/date'
import { isDone, isOpen, isOverdue, projectMoney, supply } from '../lib/finance'
import { Link } from '../lib/router'
import type { BudgetLine, Client, Payment, Project, ProjectFinance } from '../lib/types'
import { Meter } from './charts'
import { parseMoney } from './PaymentForm'
import { Button, Empty, Field, Modal } from './ui'

interface Data {
  finance: ProjectFinance | undefined
  payments: Payment[]
  all: Payment[]
  lines: BudgetLine[]
}

/** 프로젝트 상세의 재무 칸: 결제 대장을 원자료로 쓰고 여기서는 간단한 그림만 (대표 지시 2026-10-31
 *  "결제 대장을 로데이터로 사용하고 대시보드에서 간단히 시각화된 자료만 보이게") — 입력 · 수정은 결제 대장(한 줄 대장)에서 */
export function FinancePanel({ project }: { project: Project; clients?: Client[]; projects?: Project[] }) {
  const { api, version } = useApp()
  const today = todayKey()
  const [editFin, setEditFin] = useState(false)
  const { data } = useAsync<Data>(
    async () => {
      const [finances, all, lines] = await Promise.all([api.listFinances(), api.listPayments(), api.listBudgetLines(project.id)])
      return { finance: finances.find(f => f.project_id === project.id), all, payments: all.filter(p => p.project_id === project.id), lines }
    },
    [project.id, version],
    { finance: undefined, payments: [], all: [], lines: [] },
  )
  const m = projectMoney(data.finance, data.payments, data.lines, today)
  const ledger = `/projects?view=payments&project=${project.id}`
  // 공사 구분별 지급 (완료 + 미지급, 취소 · 예상 제외) — 많은 순 6개, 나머지는 '기타'
  const out = data.payments.filter(p => p.direction === '지급' && p.status !== '취소' && !p.is_estimate)
  const byCat = new Map<string, { done: number; open: number }>()
  for (const p of out) {
    const k = p.category?.trim() || '미분류'
    const r = byCat.get(k) ?? { done: 0, open: 0 }
    if (isDone(p)) r.done += supply(p)
    else r.open += supply(p)
    byCat.set(k, r)
  }
  let cats = [...byCat.entries()].map(([name, r]) => ({ name, ...r, total: r.done + r.open })).sort((a, b) => b.total - a.total)
  if (cats.length > 7) {
    const rest = cats.slice(6)
    cats = [...cats.slice(0, 6), { name: `기타 ${rest.length}개`, done: rest.reduce((n, r) => n + r.done, 0), open: rest.reduce((n, r) => n + r.open, 0), total: rest.reduce((n, r) => n + r.total, 0) }]
  }
  const max = Math.max(1, ...cats.map(c => c.total))
  const spent = m.paid + m.payable
  const late = data.payments.filter(p => isOverdue(p, today)).length
  const next = data.payments.filter(p => p.direction === '지급' && isOpen(p) && !p.is_estimate && p.due_date && p.due_date >= today).sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))[0]

  return (
    <section className="section fin-viz" aria-label="재무">
      <div className="section-h">
        <span className="t-bodyb">재무</span>
        <span className="cap">결제 대장 기준 · 공급가액</span>
        <Button kind="ghost" size="sm" onClick={() => setEditFin(true)}>
          계약 · 목표
        </Button>
        <Link to={ledger} className="btn btn-blue btn-sm">
          결제 대장에서 입력 ›
        </Link>
      </div>
      {data.payments.length === 0 && m.contract == null ? (
        <Empty>
          아직 결제가 없습니다. <Link to={ledger}>결제 대장</Link>에 한 줄씩 적으면 여기에 그림으로 나옵니다.
        </Empty>
      ) : (
        <>
          <div className="fin-tiles">
            <Tile label="계약" value={m.contract != null ? manwon(m.contract) : '–'} sub={m.target != null ? `목표 마진 ${m.target}%` : undefined} />
            <Tile label="수금" value={manwon(m.received) || '0'} sub={m.collectRate != null ? `${Math.round(m.collectRate)}% · 남은 ${manwon(Math.max(0, (m.contract ?? 0) - m.received)) || '0'}` : `미수 ${manwon(m.receivable) || '0'}`} rate={m.collectRate} />
            <Tile label="지급" value={manwon(m.paid) || '0'} sub={`미지급 ${manwon(m.payable) || '0'}`} rate={spent ? (m.paid / spent) * 100 : null} />
            <Tile label="예상 마진" value={m.margin != null ? manwon(m.margin) : '–'} sub={m.marginRate != null ? `${Math.round(m.marginRate)}%` : '계약을 넣으면 계산'} tone={m.marginRate != null && m.target != null && m.marginRate < m.target ? 'red' : undefined} />
          </div>
          {cats.length > 0 && (
            <div className="fin-bars" role="list" aria-label="공사 구분별 지급">
              {cats.map(c => (
                <div key={c.name} className="fin-bar" role="listitem" title={`${c.name} · 완료 ${c.done.toLocaleString('ko-KR')}원 · 미지급 ${c.open.toLocaleString('ko-KR')}원`}>
                  <span className="fb-name">{c.name}</span>
                  <span className="fb-track">
                    <span className="fb-done" style={{ width: `${(c.done / max) * 100}%` }} />
                    <span className="fb-open" style={{ width: `${(c.open / max) * 100}%` }} />
                  </span>
                  <span className="fb-val">{manwon(c.total)}</span>
                </div>
              ))}
              <span className="t-cap fin-legend">
                <i className="lg done" /> 지급 완료 <i className="lg open" /> 미지급
              </span>
            </div>
          )}
          {(late > 0 || next) && (
            <div className="t-cap">
              {late > 0 && <span className="t-red">연체 {late}건 · </span>}
              {next && <>다음 지급 {shortDate(next.due_date)} {next.payee ?? next.title} {manwon(next.amount)}</>}
            </div>
          )}
        </>
      )}
      {editFin && <FinanceForm project={project} finance={data.finance} hasLines={data.lines.length > 0} onClose={() => setEditFin(false)} />}
    </section>
  )
}

function Tile({ label, value, sub, rate, tone }: { label: string; value: string; sub?: string; rate?: number | null; tone?: 'red' }) {
  return (
    <div className="fin-tile">
      <span className="t-cap">{label}</span>
      <b className={`fin-num ${tone === 'red' ? 't-red' : ''}`}>{value}</b>
      {rate != null && <Meter value={Math.min(100, Math.max(0, rate))} label={`${label} 비율`} />}
      {sub && <span className="t-cap">{sub}</span>}
    </div>
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
          <TextLinks text={memo} />
        </Field>
      </div>
    </Modal>
  )
}
