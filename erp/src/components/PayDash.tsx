// 결제 대장 위 대시보드 (대표 지시 2026-10-29 "프로젝트별 대시보드 · 목표 수익률 · 계약 · 지급률 · 남은 금액")
//   - 현장을 고르지 않으면: 현장별 요약 (계약 · 수금률 · 지급 · 마진율 vs 목표) → 누르면 그 현장
//   - 현장을 고르면: 그 현장의 계약 · 수금 · 지급 · 마진 · 목표 수익률(바로 수정) + 업체별 계약 · 지급률 · 잔액 + 연결 자료
import { useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { useAction, useApp } from '../lib/app'
import { manwon, todayKey } from '../lib/date'
import { isOpen, projectMoney } from '../lib/finance'
import { Link } from '../lib/router'
import type { BudgetLine, Payment, Project, ProjectFinance } from '../lib/types'
import { Meter } from './charts'
import { Badge } from './ui'

const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n)}%`)

/** 계좌 전체 + 복사 (이체할 때 바로 붙여 넣기) */
export function AccountCell({ bank, no, holder, payee }: { bank: string | null; no: string | null; holder?: string | null; payee?: string | null }) {
  const { toast } = useApp()
  if (!bank && !no) return <span className="t-muted">–</span>
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(`${bank ?? ''} ${no ?? ''}`.trim())
      toast('계좌번호를 복사했습니다.')
    } catch {
      toast('복사하지 못했습니다. 직접 선택해 복사해 주세요.')
    }
  }
  return (
    <span className="acct">
      <span className="acct-no">
        {bank && <span className="acct-bank">{bank}</span>} <span className="mono">{no ?? ''}</span>
        {no && (
          <button type="button" className="icon-btn xs" onClick={copy} aria-label="계좌번호 복사" title="계좌번호 복사">
            <Copy size={12} />
          </button>
        )}
      </span>
      {holder && (!payee || holder.replace(/\s/g, '') !== payee.replace(/\s/g, '')) && <span className="t-cap">예금주 {holder}</span>}
    </span>
  )
}

/** 계약 · 지급률 · 잔액 한 칸 */
export function ProgressCell({ contract, rate, remain, verb = '지급' }: { contract: number | null; rate: number | null; remain: number; verb?: string }) {
  return (
    <span className="prog">
      <span className="prog-h">
        {contract != null ? <span className="strong">계약 {manwon(contract) || '0'}</span> : <span className="t-muted">계약 없음 · 건별</span>}
        <span className="grow" />
        <span className={rate != null && rate >= 100 ? 't-blue strong' : ''}>
          {pct(rate)} {verb}
        </span>
      </span>
      <Meter value={Math.min(100, Math.max(0, rate ?? 0))} max={100} label={`${verb}률`} />
      <span className="t-cap">{remain > 0 ? `잔액 ${manwon(remain)}` : remain < 0 ? <span className="t-red">초과 {manwon(-remain)}</span> : '모두 완료'}</span>
    </span>
  )
}

export function PayDash({ projectId, projects, payments, lines, finances, onPick }: { projectId: string; projects: Project[]; payments: Payment[]; lines: BudgetLine[]; finances: ProjectFinance[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(true)
  const today = todayKey()
  const project = projects.find(p => p.id === projectId)
  if (project) return <ProjectBoard project={project} payments={payments.filter(p => p.project_id === project.id)} lines={lines.filter(l => l.project_id === project.id)} fin={finances.find(f => f.project_id === project.id)} />
  if (projectId) return null
  const rows = projects
    .map(pr => {
      const pay = payments.filter(p => p.project_id === pr.id)
      const fin = finances.find(f => f.project_id === pr.id)
      if (!pay.length && fin?.contract_amount == null) return null
      const m = projectMoney(fin, pay, lines.filter(l => l.project_id === pr.id), today)
      const out = m.paid + m.payable
      return { pr, m, out, payRate: out > 0 ? (m.paid / out) * 100 : null, late: m.overdueIn.length + m.overdueOut.length }
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => b.late - a.late || (a.m.marginRate != null && a.m.target != null ? a.m.marginRate - a.m.target : 999) - (b.m.marginRate != null && b.m.target != null ? b.m.marginRate - b.m.target : 999))
  if (!rows.length) return null
  const miss = rows.filter(r => r.m.marginRate != null && r.m.target != null && r.m.marginRate < r.m.target).length
  return (
    <section className="section pay-dash" aria-label="현장별 요약">
      <button type="button" className="section-h fold" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="t-bodyb">현장별 요약</span>
        <span className="cap">
          {rows.length}곳{miss ? <span className="t-red"> · 목표 수익률 미달 {miss}곳</span> : ''} · 공급가 기준 · 누르면 그 현장 대시보드
        </span>
        <span className="t-cap">{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>현장</th>
                <th className="num">계약</th>
                <th style={{ minWidth: 120 }}>수금</th>
                <th style={{ minWidth: 120 }}>지급</th>
                <th className="num">미지급</th>
                <th className="num">마진율</th>
                <th className="num">목표</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ pr, m, out, payRate, late }) => {
                const ok = m.marginRate != null && m.target != null ? m.marginRate >= m.target : null
                return (
                  <tr key={pr.id} className="click" onClick={() => onPick(pr.id)}>
                    <td className="max">
                      <span className="strong truncate" style={{ display: 'block', maxWidth: 220 }}>
                        {pr.name}
                      </span>
                      <span className="t-cap">{[pr.code, pr.status, late ? `연체 ${late}건` : null].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="num">{m.contract != null ? manwon(m.contract) : '–'}</td>
                    <td>
                      <span className="t-cap">
                        {pct(m.collectRate)} · 미수 {manwon(m.receivable) || '0'}
                      </span>
                      <Meter value={Math.min(100, m.collectRate ?? 0)} label="수금률" />
                    </td>
                    <td>
                      <span className="t-cap">
                        {pct(payRate)} · {manwon(m.paid) || '0'}/{manwon(out) || '0'}
                      </span>
                      <Meter value={Math.min(100, payRate ?? 0)} label="지급률" />
                    </td>
                    <td className="num">{manwon(m.payable) || '–'}</td>
                    <td className={`num ${m.marginRate != null && m.marginRate < 0 ? 'red' : ''}`}>{m.marginRate != null ? `${m.marginRate.toFixed(1)}%` : '–'}</td>
                    <td className="num">{m.target != null ? `${m.target}%` : '–'}</td>
                    <td>{ok != null && <Badge tone={ok ? 'acid' : 'yellow'}>{ok ? '달성' : '미달'}</Badge>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ProjectBoard({ project, payments, lines, fin }: { project: Project; payments: Payment[]; lines: BudgetLine[]; fin: ProjectFinance | undefined }) {
  const { api, me } = useApp()
  // 팀원 모두 수정 (2026-10-30)
  const admin = !!me
  const { run } = useAction()
  const today = todayKey()
  const m = projectMoney(fin, payments, lines, today)
  const [target, setTarget] = useState(m.target != null ? String(m.target) : '')
  const out = m.paid + m.payable
  const payRate = out > 0 ? (m.paid / out) * 100 : null
  const material = payments.filter(p => p.direction === '지급' && p.status !== '취소' && !p.is_estimate && (p.category ?? '').includes('자재')).reduce((n, p) => n + p.amount - p.vat, 0)
  const labor = payments.filter(p => p.direction === '지급' && p.status !== '취소' && !p.is_estimate && (p.category ?? '').replace(/\s/g, '') === '노무비').reduce((n, p) => n + p.amount, 0)
  // 목표 마진에 맞추려면 쓸 수 있는 비용 한도
  const costCap = m.contract != null && m.target != null ? Math.round(m.contract * (1 - m.target / 100)) : null
  const saveTarget = () => {
    const v = target.trim() === '' ? null : Number(target)
    if (v != null && (Number.isNaN(v) || v < -100 || v > 100)) return
    if (v === m.target) return
    void run(() => api.saveFinance({ project_id: project.id, target_margin: v }), '목표 수익률을 바꿨습니다.')
  }
  const ok = m.marginRate != null && m.target != null ? m.marginRate >= m.target : null
  return (
    <section className="section pay-dash" aria-label="현장 대시보드">
      <div className="section-h">
        <span className="t-bodyb">{project.name}</span>
        <span className="cap">{[project.code, project.status, '공급가 기준'].filter(Boolean).join(' · ')}</span>
        <span className="row" style={{ gap: 10 }}>
          <Link to={`/projects?id=${project.id}`} className="t-cap">
            프로젝트 상세 · 자재 입출고 <ExternalLink size={11} />
          </Link>
          <Link to={`/projects?view=payments&sub=labor&project=${project.id}`} className="t-cap">
            노무비 대장
          </Link>
        </span>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <div className="kpi">
          <span className="t-cap">계약액</span>
          <span className="v">{m.contract != null ? manwon(m.contract) : '–'}</span>
          <span className="sub">{m.contract != null ? `예산 ${m.budget != null ? manwon(m.budget) : '–'}` : '프로젝트 재무에서 입력'}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">수금 {pct(m.collectRate)}</span>
          <span className="v">{manwon(m.received) || '0'}</span>
          <Meter value={Math.min(100, m.collectRate ?? 0)} label="수금률" />
          <span className="sub">미수 {manwon(m.receivable) || '0'}{m.contract != null ? ` · 남은 청구 ${manwon(Math.max(0, m.contract - m.received - m.receivable)) || '0'}` : ''}</span>
        </div>
        <div className="kpi">
          <span className="t-cap">지급 {pct(payRate)}</span>
          <span className="v">{manwon(m.paid) || '0'}</span>
          <Meter value={Math.min(100, payRate ?? 0)} label="지급률" />
          <span className="sub">
            남은 지급 {manwon(m.payable) || '0'}
            {m.estimate ? ` · 예상 ${manwon(m.estimate)}` : ''}
          </span>
        </div>
        <div className="kpi">
          <span className="t-cap">비용 구성</span>
          <span className="v">{manwon(m.cost) || '0'}</span>
          <span className="sub">
            자재 {manwon(material) || '0'} · 노무비 {manwon(labor) || '0'}
            {costCap != null ? ` · 목표 한도 ${manwon(costCap)}` : ''}
          </span>
        </div>
        <div className="kpi">
          <span className="row" style={{ gap: 6 }}>
            <span className="t-cap grow">마진율 / 목표 수익률</span>
            {ok != null && <Badge tone={ok ? 'acid' : 'yellow'}>{ok ? '달성' : '미달'}</Badge>}
          </span>
          <span className="v" style={m.marginRate != null && m.marginRate < 0 ? { color: 'var(--red)' } : undefined}>
            {m.marginRate != null ? `${m.marginRate.toFixed(1)}%` : '–'}
          </span>
          <Meter value={Math.max(0, m.marginRate ?? 0)} max={50} target={m.target} red={(m.marginRate ?? 0) < 0} label="마진율" />
          <span className="sub row" style={{ gap: 4 }}>
            목표
            {admin ? (
              <input className="input xs" style={{ width: 52 }} inputMode="decimal" value={target} onChange={e => setTarget(e.target.value.replace(/[^\d.-]/g, ''))} onBlur={saveTarget} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="목표 수익률 %" />
            ) : (
              <b>{m.target ?? '–'}</b>
            )}
            % · 마진 {m.margin != null ? manwon(m.margin) : '–'}
          </span>
        </div>
      </div>
      {m.overdueOut.length + m.overdueIn.length > 0 && (
        <div className="note warn">
          연체 {m.overdueOut.length + m.overdueIn.length}건: {[...m.overdueIn, ...m.overdueOut].slice(0, 4).map(p => `${p.direction === '수금' ? '[수금] ' : ''}${p.payee ?? p.title} ${manwon(p.amount)}`).join(', ')}
          {payments.filter(isOpen).length > 4 ? ' …' : ''}
        </div>
      )}
    </section>
  )
}
