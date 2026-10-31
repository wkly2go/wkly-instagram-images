import { useState, type ReactNode } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import { manwon, shortDate, todayKey } from '../lib/date'
import { isDone, isOpen, isOverdue, projectMoney, supply } from '../lib/finance'
import { Link } from '../lib/router'
import type { BudgetLine, Client, Payment, Project, ProjectFinance } from '../lib/types'
import { Meter } from './charts'
import { PaymentForm, parseMoney } from './PaymentForm'
import { PaySheet } from './PaySheet'

interface Data {
  finance: ProjectFinance | undefined
  payments: Payment[]
  all: Payment[]
  lines: BudgetLine[]
}

/** 프로젝트 상세의 재무 칸: 결제 대장을 원자료로 쓰고 여기서는 간단한 그림만 (대표 지시 2026-10-31
 *  "결제 대장을 로데이터로 사용하고 대시보드에서 간단히 시각화된 자료만 보이게") — 입력 · 수정은 결제 대장(한 줄 대장)에서 */
export function FinancePanel({ project, clients, projects, viz, part }: { project: Project; clients: Client[]; projects: Project[]; viz?: ReactNode; part?: 'viz' | 'ledger' }) {
  const { api, version } = useApp()
  const today = todayKey()
  // 결제 대장을 프로젝트 화면 안에 바로 (대표 지시 2026-10-31 "결제 대장은 메인 화면으로 이동")
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<Payment | null>(null)
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

  const vizBox = (
    <section className="section fin-viz" aria-label="재무">
      <div className="section-h">
        <span className="t-bodyb">재무</span>
        <span className="cap">결제 대장 기준 · 공급가액</span>
        <Link to={ledger} className="t-cap" title="이 현장 결제 대장만 크게 보기 (이번 주 지급 · 점검 · 업체별 묶음)">
          크게 보기 ›
        </Link>
      </div>
      {data.payments.length === 0 && m.contract == null ? (
        <span className="t-cap">아래 결제 대장에 계약 금액과 결제를 한 줄씩 적으면 여기에 그림으로 나옵니다.</span>
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
      {viz}
    </section>
  )
  // 결제 대장 (대표 지시 2026-10-31 배치: 개요 · 알람 → 재무 시각화 → 일정 → 업무일지 · 할 일 → 결제 대장 → 자재 입출고 → 현장 작업일지)
  const ledgerBox = (
    <section className="section" aria-label="결제 대장">
      <div className="section-h">
        <span className="t-bodyb">결제 대장</span>
        <span className="cap">노란 칸에 바로 입력 · 맨 아래 줄 Enter = 추가</span>
      </div>
      <ContractGoal project={project} finance={data.finance} />
      <PaySheet rows={data.payments} all={data.all} projectId={project.id} sel={sel} setSel={setSel} onOpen={p => setForm(p)} />
      {form && <PaymentForm key={form.id} payment={form} preset={{ project_id: project.id }} projects={projects} clients={clients} payments={data.all} lines={data.lines} lockProject onClose={() => setForm(null)} />}
    </section>
  )
  if (part === 'viz') return vizBox
  if (part === 'ledger') return ledgerBox
  return (
    <>
      {vizBox}
      {ledgerBox}
    </>
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

/** 결제 대장 맨 위 '계약 · 목표' 줄 (대표 지시 2026-10-31 "계약 목표는 결제 대장의 상세 항목에 포함")
 *  계약은 VAT 포함으로 적고 공급가(÷1.1)로 저장 · 목표 마진 % · 메모. 칸에서 나가면 저장 */
export function ContractGoal({ project, finance }: { project: Project; finance: ProjectFinance | undefined }) {
  const { api } = useApp()
  const { run } = useAction()
  const base = { contract_amount: finance?.contract_amount ?? null, budget_cost: finance?.budget_cost ?? null, target_margin: finance?.target_margin ?? null, memo: finance?.memo ?? null }
  const save = (patch: Partial<ProjectFinance>) => {
    const next = { ...base, ...patch }
    if (Object.entries(patch).every(([k, v]) => (base as Record<string, unknown>)[k] === v)) return
    void run(() => api.saveFinance({ project_id: project.id, ...next }), '계약 · 목표를 저장했습니다.')
  }
  const incl = finance?.contract_amount != null ? Math.round(finance.contract_amount * 1.1) : null
  return (
    <div className="contract-goal" key={finance?.updated_at ?? 'none'}>
      <label>
        <span>계약 (VAT 포함)</span>
        <input
          className="ps-in num"
          inputMode="numeric"
          defaultValue={incl != null ? incl.toLocaleString('ko-KR') : ''}
          placeholder="예) 49,500,000"
          onBlur={e => {
            const t = e.target.value.trim()
            const n = t ? Math.max(0, parseMoney(t)) : null
            save({ contract_amount: n == null ? null : n === incl ? finance!.contract_amount : Math.round(n / 1.1) })
          }}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="계약 금액 (VAT 포함)"
        />
      </label>
      <span className="t-cap">공급가 {finance?.contract_amount != null ? finance.contract_amount.toLocaleString('ko-KR') : '–'}</span>
      <label>
        <span>목표 마진</span>
        <input
          className="ps-in num w-s"
          inputMode="decimal"
          defaultValue={finance?.target_margin ?? ''}
          placeholder="30"
          onBlur={e => {
            const t = e.target.value.trim()
            const v = t === '' ? null : Number(t)
            if (v != null && (!isFinite(v) || v < -100 || v > 100)) return
            save({ target_margin: v })
          }}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="목표 마진율 (%)"
        />
        <span>%</span>
      </label>
      <label className="grow">
        <span>메모</span>
        <input className="ps-in" defaultValue={finance?.memo ?? ''} onBlur={e => save({ memo: e.target.value.trim() || null })} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="계약 메모" />
      </label>
    </div>
  )
}
