import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { toCsv, downloadText } from '../lib/csv'
import { addDays, dateLabel, manwon, shortDate, todayKey } from '../lib/date'
import { advanceGroups, contractKey, contractRows, isAdvance, isAgency, isDone, isLabor, isOpen, isOverdue, laborMonthly, laborPeople, paymentChecks, paymentRun, projectMoney, runMonday, sameName, supply } from '../lib/finance'
import { useRouter, withQuery } from '../lib/router'
import type { BudgetLine, Client, Payment, Project, ProjectFinance } from '../lib/types'
import { AccountCell, PayDash, ProgressCell } from '../components/PayDash'
import { PayGroups } from '../components/PayGroups'
import { PaySheet } from '../components/PaySheet'
import { ContractGoal } from '../components/FinancePanel'
import { PaymentForm } from '../components/PaymentForm'
import { Badge, Button, Chip, Empty, Loading, type Tone } from '../components/ui'
import { PaymentImport } from './PaymentImport'
import { ask } from '../components/Ask'

const PAY_TONE: Record<Payment['status'], Tone> = { 예정: 'outline', 청구: 'yellow', 대기: 'yellow', 완료: 'acid', 보류: 'paper', 취소: 'paper' }

export interface PayData {
  payments: Payment[]
  lines: BudgetLine[]
  finances: ProjectFinance[]
}

/** 프로젝트 › 결제 대장 (관리자) */
export function Payments({ projects, clients }: { projects: Project[]; clients: Client[] }) {
  const { api, version } = useApp()
  const { query, path, navigate } = useRouter()
  const sub = query.get('sub') ?? 'register'
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })
  const { data, loading } = useAsync<PayData>(
    async () => {
      const [payments, lines, finances] = await Promise.all([api.listPayments(), api.listBudgetLines(), api.listFinances()])
      return { payments, lines, finances }
    },
    [version],
    { payments: [], lines: [], finances: [] },
  )
  const advances = advanceGroups(data.payments)
  // 현장을 고른 동안에는 위 메뉴를 숨기고 그 현장 결제 대장만 (대표 지시 2026-10-31 "맨 위 상단의 네비게이션은 비노출하고 프로젝트에 집중")
  const focus = !!query.get('project') && query.get('project') !== 'none'
  const checks = paymentChecks(data.payments, data.lines, projects, todayKey())
  return (
    <div className="col gap-10">
      {!focus && <div className="chips" role="tablist" aria-label="결제 대장 메뉴">
        <Chip active={sub === 'register'} onClick={() => go({ sub: null })}>
          결제 대장
        </Chip>
        <Chip active={sub === 'run'} onClick={() => go({ sub: 'run' })}>
          이번 주 지급
        </Chip>
        <Chip active={sub === 'check'} onClick={() => go({ sub: 'check' })}>
          점검 {checks.length ? checks.reduce((n, c) => n + c.items.length, 0) : ''}
        </Chip>
        <Chip active={sub === 'advance'} onClick={() => go({ sub: 'advance' })}>
          대지급 정산 {advances.length ? advances.reduce((n, g) => n + g.items.length, 0) : ''}
        </Chip>
        <Chip active={sub === 'labor'} onClick={() => go({ sub: 'labor' })}>
          노무비 대장
        </Chip>
        <Chip active={sub === 'import'} onClick={() => go({ sub: 'import' })}>
          엑셀 가져오기
        </Chip>
      </div>}
      {loading && !data.payments.length ? (
        <Loading />
      ) : focus ? (
        <Register data={data} projects={projects} clients={clients} />
      ) : sub === 'run' ? (
        <Run data={data} projects={projects} />
      ) : sub === 'check' ? (
        <Checks data={data} projects={projects} />
      ) : sub === 'advance' ? (
        <Advances data={data} projects={projects} />
      ) : sub === 'labor' ? (
        <Labor data={data} projects={projects} />
      ) : sub === 'import' ? (
        <PaymentImport projects={projects} existing={data.payments} onDone={() => go({ sub: null })} />
      ) : (
        <Register data={data} projects={projects} clients={clients} />
      )}
    </div>
  )
}

type StatusFilter = 'open' | 'done' | 'estimate' | 'all'

function Register({ data, projects, clients }: { data: PayData; projects: Project[]; clients: Client[] }) {
  const { api, me } = useApp()
  const { query, path, navigate } = useRouter()
  const { busy, run } = useAction()
  const today = todayKey()
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })
  const projectId = query.get('project') ?? ''
  const dir = query.get('dir') ?? ''
  const st = (query.get('st') as StatusFilter | null) ?? 'all'
  const cat = query.get('cat') ?? ''
  const [q, setQ] = useState(query.get('q') ?? '')
  const openId = query.get('pid')
  const layout = query.get('layout') === 'group' ? 'group' : 'sheet'
  const [form, setForm] = useState<Payment | 'new' | null>(null)
  const [preset, setPreset] = useState<Partial<Payment> | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? ''

  // 현장을 고르면 그 현장 것만 (대표 지시 2026-10-31 "업체들도 해당 프로젝트에 속한 부분만")
  const inProject = projectId && projectId !== 'none' ? projectId : null
  const categories = useMemo(() => [...new Set(data.payments.filter(p => !inProject || p.project_id === inProject).map(p => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'ko')), [data.payments, inProject])
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = data.payments.filter(p => {
      if (projectId && (projectId === 'none' ? p.project_id : p.project_id !== projectId)) return false
      if (dir && p.direction !== dir) return false
      if (cat && p.category !== cat) return false
      if (st === 'open' && !isOpen(p)) return false
      if (st === 'done' && !isDone(p)) return false
      if (st === 'estimate' && !p.is_estimate) return false
      if (words.length) {
        const hay = [p.title, p.payee, p.category, p.memo, p.account_holder, p.stage, p.advance_by, projectName(p.project_id)].join(' ').toLowerCase()
        if (!words.every(w => hay.includes(w))) return false
      }
      return true
    })
    const key = (p: Payment) => (st === 'open' ? p.due_date ?? '9999' : p.paid_date ?? p.due_date ?? p.requested_date ?? '')
    return list.sort((a, b) => (st === 'open' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.payments, projectId, dir, cat, st, q, projects])

  const real = rows.filter(p => !p.is_estimate && p.status !== '취소')
  const sumDir = (list: Payment[], d: Payment['direction']) => list.filter(p => p.direction === d).reduce((n, p) => n + p.amount, 0)
  const total = real.reduce((n, p) => n + p.amount, 0)
  const done = real.filter(isDone).reduce((n, p) => n + p.amount, 0)
  const open = real.filter(isOpen).reduce((n, p) => n + p.amount, 0)
  const late = real.filter(p => isOverdue(p, today))
  const estimate = rows.filter(p => p.is_estimate && p.status !== '취소').reduce((n, p) => n + p.amount, 0)
  const selected = rows.filter(p => sel.has(p.id))
  const opened = openId ? data.payments.find(p => p.id === openId) : undefined
  // 업체별 계약 · 지급률 · 잔액, 현장별 수금률 (줄마다 보여 줌)
  const contracts = useMemo(() => new Map(contractRows(data.payments, data.lines).map(c => [c.key, c])), [data.payments, data.lines])
  const collect = useMemo(() => {
    const map = new Map<string, { contract: number | null; rate: number | null; remain: number }>()
    for (const pr of projects) {
      const fin = data.finances.find(f => f.project_id === pr.id)
      if (fin?.contract_amount == null) continue
      const m = projectMoney(fin, data.payments.filter(p => p.project_id === pr.id), [], today)
      map.set(pr.id, { contract: m.contract, rate: m.collectRate, remain: (m.contract ?? 0) - m.received })
    }
    return map
  }, [data.payments, data.finances, projects, today])

  const toggleAll = (on: boolean) => setSel(on ? new Set(rows.map(p => p.id)) : new Set())
  // 필터를 바꾸면 선택을 비움 (안 보이는 줄이 같이 바뀌지 않게)
  useEffect(() => setSel(new Set()), [projectId, dir, cat, st, q])
  const bulk = async (patch: Partial<Payment>, msg: string, only?: (p: Payment) => boolean) => {
    const ids = only ? rows.filter(p => sel.has(p.id) && only(p)).map(p => p.id) : [...sel]
    if (!ids.length) {
      setSel(new Set())
      return
    }
    if (await run(() => api.updatePayments(ids, patch), msg)) setSel(new Set())
  }
  const exportCsv = () => {
    const cols = [
      ['requested_date', '결제요청일'], ['project', '현장'], ['direction', '구분'], ['category', '공사 구분'], ['title', '항목'], ['payee', '업체명'], ['contract_type', '계약형태'], ['stage', '단계'],
      ['bank_name', '은행'], ['account_no', '계좌번호'], ['account_holder', '예금주'], ['amount', '결제금액'], ['vat', '부가세'], ['supply', '공급가액'], ['status', '상태'], ['due_date', '지급예정일'],
      ['paid_date', '지급일'], ['tax_invoice', '세금계산서'], ['advance_by', '대지급자'], ['is_estimate', '예상 비용'], ['memo', '비고'],
    ].map(([key, label]) => ({ key, label }))
    downloadText(`결제대장_${today}.csv`, toCsv(rows.map(p => ({ ...p, project: projectName(p.project_id), supply: supply(p), is_estimate: p.is_estimate ? 'Y' : '' })), cols))
  }

  return (
    <>
      <PayDash projectId={projectId === 'none' ? '' : projectId} projects={projects} payments={data.payments} lines={data.lines} finances={data.finances} onPick={id => go({ project: id })} />
      <div className="filters">
        {inProject ? (
          // 현장을 고른 동안에는 다른 현장 목록을 띄우지 않음 · 전체로 돌아갈 때만 이 버튼 (대표 지시 2026-10-31)
          <>
            <Button kind="ghost" size="sm" onClick={() => go({ project: null, cat: null, layout: null })} title="모든 현장 결제 대장으로">
              ← 전체 현장
            </Button>
            <b className="pay-focus-title">{[projects.find(p => p.id === inProject)?.code, projectName(inProject)].filter(Boolean).join(' ')} 결제 대장</b>
          </>
        ) : (
        <select className="select" value={projectId} onChange={e => go({ project: e.target.value || null })} aria-label="프로젝트">
          <option value="">모든 현장</option>
          <option value="none">현장 없음</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        )}
        <select className="select" value={dir} onChange={e => go({ dir: e.target.value || null })} aria-label="구분">
          <option value="">지급·수금</option>
          <option value="지급">지급</option>
          <option value="수금">수금</option>
        </select>
        <select className="select" value={cat} onChange={e => go({ cat: e.target.value || null })} aria-label="공사 구분">
          <option value="">모든 공사 구분</option>
          {categories.map(c => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="search">
          <Search size={14} />
          <input className="input" value={q} onChange={e => setQ(e.target.value)} onBlur={() => go({ q: q.trim() || null })} placeholder="업체·항목·예금주 검색" aria-label="검색" />
        </label>
      </div>
      <div className="row wrap">
        <div className="chips">
          {([
            ['all', '전체'],
            ['open', '미결제'],
            ['done', '완료'],
            ['estimate', '예상 비용'],
          ] as const).map(([k, label]) => (
            <Chip key={k} active={st === k} onClick={() => go({ st: k === 'all' ? null : k })}>
              {label}
            </Chip>
          ))}
        </div>
        {inProject && (
          <div className="chips" aria-label="보기">
            <Chip active={layout === 'sheet'} onClick={() => go({ layout: null })}>
              한 줄 대장
            </Chip>
            <Chip active={layout === 'group'} onClick={() => go({ layout: 'group' })}>
              업체별 · 계약금 · 중도금 · 잔금
            </Chip>
          </div>
        )}
        <span className="grow" />
        <Button kind="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
          CSV
        </Button>
        <Button size="sm" onClick={() => setForm('new')}>
          결제 추가
        </Button>
      </div>
      <div className="note">
        {dir ? (
          <>
            {rows.length}건 · 합계 <b className="t-blue">{manwon(total) || '0'}</b> · 완료 {manwon(done) || '0'} · 미결제 <b className="t-blue">{manwon(open) || '0'}</b>
          </>
        ) : (
          <>
            {rows.length}건 · 수금 <b className="t-blue">{manwon(sumDir(real, '수금')) || '0'}</b> (미수 {manwon(sumDir(real.filter(isOpen), '수금')) || '0'}) · 지급 <b className="t-blue">{manwon(sumDir(real, '지급')) || '0'}</b> (미지급 {manwon(sumDir(real.filter(isOpen), '지급')) || '0'})
          </>
        )}
        {late.length > 0 && <span className="t-red"> · 연체 {late.length}건 {manwon(late.reduce((n, p) => n + p.amount, 0))}</span>}
        {estimate !== 0 && <> · 예상 비용 {manwon(estimate)} (합계 제외)</>} · 실제 금액(VAT 포함) 기준
      </div>
      {inProject && layout === 'sheet' ? (
        <div>
          {projects.find(p => p.id === inProject) && <ContractGoal project={projects.find(p => p.id === inProject)!} finance={data.finances.find(f => f.project_id === inProject)} />}
          <PaySheet rows={rows} all={data.payments} projectId={inProject} sel={sel} setSel={setSel} onOpen={p => setForm(p)} />
        </div>
      ) : rows.length === 0 ? (
        <Empty>조건에 맞는 결제가 없습니다.</Empty>
      ) : projectId && projectId !== 'none' ? (
        <PayGroups
          rows={rows}
          all={data.payments.filter(p => p.project_id === projectId)}
          lines={data.lines.filter(l => l.project_id === projectId)}
          finance={data.finances.find(f => f.project_id === projectId)}
          sel={sel}
          setSel={setSel}
          onOpen={p => setForm(p)}
          onNew={p => {
            setPreset(p)
            setForm('new')
          }}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="모두 선택" checked={sel.size > 0 && selected.length === rows.length} onChange={e => toggleAll(e.target.checked)} />
                </th>
                {!projectId && <th>현장</th>}
                <th>항목 · 물품</th>
                <th>업체·성명</th>
                <th className="num">금액</th>
                <th>상태</th>
                <th className="num" title="완료면 지급일, 아니면 지급예정일">날짜</th>
                <th style={{ minWidth: 170 }} title="업체 계약금(공급가) 대비 지급 완료 비율 · 수금은 현장 계약 대비">계약 · 진행</th>
                <th>계산서</th>
                <th>계좌</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const isLate = isOverdue(p, today)
                return (
                  <tr key={p.id} className={`click ${sel.has(p.id) ? 'sel' : ''} ${p.status === '취소' || p.is_estimate ? 'muted' : ''}`} onClick={() => setForm(p)}>
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`${p.title} 선택`}
                        checked={sel.has(p.id)}
                        onChange={e => {
                          const next = new Set(sel)
                          if (e.target.checked) next.add(p.id)
                          else next.delete(p.id)
                          setSel(next)
                        }}
                      />
                    </td>
                    {!projectId && (
                      <td className="max">
                        <button type="button" className="link-btn truncate" style={{ display: 'block', maxWidth: 130 }} title={`${projectName(p.project_id)} — 이 현장만 보기`} onClick={e => { e.stopPropagation(); if (p.project_id) go({ project: p.project_id }) }}>
                          {projectName(p.project_id) || '–'}
                        </button>
                      </td>
                    )}
                    <td className="max">
                      <span className="strong truncate" style={{ display: 'block' }} title={p.title}>
                        {p.direction === '수금' && <Badge tone="blue">수금</Badge>} {p.title}
                      </span>
                      <span className="t-cap truncate" style={{ display: 'block', maxWidth: 260 }} title={p.memo ?? undefined}>
                        {[p.category, p.stage, p.is_estimate ? '예상 비용' : null, isAdvance(p) ? `대지급 ${p.advance_by!.trim()}` : null, p.approval_id ? '지출 승인' : null, p.memo].filter(Boolean).join(' · ') || '–'}
                      </span>
                    </td>
                    <td className="nowrap">
                      <span style={{ display: 'block' }}>{p.payee ?? '–'}</span>
                      <span className="t-cap">{p.contract_type ?? ''}</span>
                    </td>
                    <td className={`num ${p.amount < 0 ? 'red' : ''}`}>{p.amount.toLocaleString('ko-KR')}</td>
                    <td>
                      <Badge tone={isLate ? 'red' : PAY_TONE[p.status]}>{isLate ? '연체' : p.status}</Badge>
                    </td>
                    <td className={`num ${isLate ? 'red' : ''}`} title={p.paid_date ? `지급일 ${p.paid_date}` : p.due_date ? `지급예정일 ${p.due_date}` : undefined}>
                      {p.paid_date ? shortDate(p.paid_date) : p.due_date ? <span className="t-muted">{shortDate(p.due_date)} 예정</span> : '–'}
                      {p.requested_date && <span className="t-cap" style={{ display: 'block' }}>요청 {shortDate(p.requested_date)}</span>}
                    </td>
                    <td>
                      {(() => {
                        if (p.status === '취소' || p.is_estimate) return <span className="t-muted">–</span>
                        if (p.direction === '수금') {
                          const c = p.project_id ? collect.get(p.project_id) : undefined
                          return c ? <ProgressCell contract={c.contract} rate={c.rate} remain={c.remain} verb="수금" /> : <span className="t-muted">현장 계약 없음</span>
                        }
                        const c = contracts.get(contractKey(p))
                        return c ? <ProgressCell contract={c.contract} rate={c.rate} remain={c.remain} /> : <span className="t-muted">–</span>
                      })()}
                    </td>
                    <td className="nowrap t-cap">{p.tax_invoice === '해당 없음' ? '–' : p.tax_invoice}</td>
                    <td className="nowrap">
                      <AccountCell bank={p.bank_name} no={p.account_no} holder={p.account_holder} payee={p.payee} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {sel.size > 0 && (
        <div className="bulk" role="region" aria-label="선택한 결제">
          <span className="t-smallb">
            {sel.size}건 선택 · {manwon(selected.reduce((n, p) => n + p.amount, 0))}
          </span>
          <span className="grow" />
          <Button size="sm" disabled={busy} onClick={() => bulk({ status: '완료', paid_date: today }, '미결제 건을 오늘 날짜로 완료 처리했습니다.', isOpen)} title="이미 완료된 건의 지급일은 바꾸지 않습니다">
            완료 처리 (오늘)
          </Button>
          <Button kind="outline" size="sm" disabled={busy} onClick={() => bulk({ status: '대기' }, '대기로 바꿨습니다.')}>
            대기
          </Button>
          <Button kind="outline" size="sm" disabled={busy} onClick={() => bulk({ status: '취소' }, '취소로 바꿨습니다.')}>
            취소
          </Button>
          {me.role === 'admin' && <Button
            kind="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (!(await ask(`선택한 ${sel.size}건을 삭제할까요?`))) return
              const ids = [...sel]
              if (await run(async () => {
                for (const id of ids) await api.deletePayment(id)
              }, '삭제했습니다.'))
                setSel(new Set())
            }}
          >
            삭제
          </Button>}
          <Button kind="ghost" size="sm" onClick={() => setSel(new Set())}>
            선택 해제
          </Button>
        </div>
      )}
      {(form || opened) && (
        <PaymentForm
          key={form === 'new' ? 'new' : (form ?? opened)?.id ?? 'new'}
          payment={form === 'new' ? null : (form ?? opened ?? null)}
          preset={{ project_id: projectId && projectId !== 'none' ? projectId : null, direction: (dir as Payment['direction']) || '지급', ...(form === 'new' ? preset : null) }}
          projects={projects}
          clients={clients}
          payments={data.payments}
          lines={data.lines}
          lockProject={!!inProject}
          onClose={() => {
            setForm(null)
            setPreset(null)
            if (openId) go({ pid: null })
          }}
        />
      )}
    </>
  )
}

function Advances({ data, projects }: { data: PayData; projects: Project[] }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const groups = advanceGroups(data.payments)
  const settled = data.payments.filter(p => isAdvance(p) && p.status === '완료').length
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? '–'
  return (
    <>
      <div className="note">
        현장소장 등이 먼저 결제한 건(대지급)을 사람별로 모았습니다. 정산(이체)하면 <b>정산 완료</b>를 눌러 주세요. 지급 합계에는 각 항목이 한 번만 들어갑니다. · 정산 완료 {settled}건
      </div>
      {groups.length === 0 ? (
        <Empty>정산할 대지급이 없습니다. 결제 추가 시 '대지급자'를 적으면 여기에 모입니다.</Empty>
      ) : (
        groups.map(g => (
          <section key={g.by} className="section">
            <div className="section-h">
              <span className="t-bodyb">{g.by}</span>
              <Badge tone="yellow">{g.items.length}건</Badge>
              <span className="cap">
                정산할 금액 <b className="t-blue">{g.total.toLocaleString('ko-KR')}원</b>
              </span>
              <Button size="sm" disabled={busy} onClick={async () => (await ask(`${g.by}님에게 ${g.total.toLocaleString('ko-KR')}원 정산 완료로 처리할까요?`)) && run(() => api.updatePayments(g.items.map(p => p.id), { status: '완료', paid_date: today }), '정산 완료로 처리했습니다.')}>
                정산 완료
              </Button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>결제일</th>
                    <th>현장</th>
                    <th>공사 구분</th>
                    <th>항목</th>
                    <th>사용처</th>
                    <th>증빙</th>
                    <th className="num">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map(p => (
                    <tr key={p.id}>
                      <td className="num">{shortDate(p.requested_date) || '–'}</td>
                      <td className="max truncate">{projectName(p.project_id)}</td>
                      <td className="nowrap">{p.category ?? '–'}</td>
                      <td className="strong">{p.title}</td>
                      <td className="nowrap">{p.payee ?? '–'}</td>
                      <td className="nowrap t-cap">{p.contract_type ?? '–'}</td>
                      <td className="num">{p.amount.toLocaleString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </>
  )
}

function Labor({ data, projects }: { data: PayData; projects: Project[] }) {
  const today = todayKey()
  const { query, path, navigate } = useRouter()
  const projectId = query.get('project') ?? ''
  const [year, setYear] = useState(today.slice(0, 4))
  const [month, setMonth] = useState<string | null>(today.slice(0, 7))
  const [by, setBy] = useState<'person' | 'list'>('person')
  const scoped = projectId ? data.payments.filter(p => p.project_id === projectId) : data.payments
  const months = laborMonthly(scoped, year)
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? ''
  const labor = scoped.filter(isLabor)
  // 사람별: 고른 달(없으면 고른 해)의 지급 완료 + 미지급
  const period = month ?? year
  const people = laborPeople(labor.filter(p => ((p.status === '완료' ? p.paid_date : p.due_date ?? p.requested_date) ?? '').startsWith(period)))
  const rows = month ? labor.filter(p => p.status === '완료' && p.paid_date?.startsWith(month)).sort((a, b) => (a.paid_date ?? '').localeCompare(b.paid_date ?? '')) : []
  const unpaid = month ? labor.filter(p => isOpen(p) && (p.due_date ?? p.requested_date ?? '').startsWith(month)) : []
  const noType = rows.filter(p => !p.contract_type)
  const otherHolder = rows.filter(p => p.account_holder && p.payee && !sameName(p.account_holder, p.payee) && !p.account_holder.includes(p.payee) && !isAgency(p))
  const years = [...new Set([today.slice(0, 4), ...labor.map(p => (p.paid_date ?? '').slice(0, 4)).filter(Boolean)])].sort().reverse()
  const exportCsv = () => {
    if (!month) return
    const cols = [
      ['paid_date', '지급일'], ['project', '현장'], ['category', '공사 구분'], ['title', '항목'], ['payee', '성명'], ['contract_type', '고용형태'], ['bank_name', '은행'], ['account_no', '계좌번호'],
      ['account_holder', '예금주'], ['amount', '지급금액'], ['kind', '구분'], ['memo', '비고'],
    ].map(([key, label]) => ({ key, label }))
    downloadText(`노무비대장_${month}.csv`, toCsv(rows.map(p => ({ ...p, project: projectName(p.project_id), kind: isAgency(p) ? '인력업체(세금계산서)' : '개인 노무비' })), cols))
  }
  return (
    <>
      <div className="note">결제 대장에서 계약형태가 사업소득(3.3%)·일용근로·4대보험 근로이거나 공사 구분이 '노무비'인 지급 완료 건을 지급일 기준으로 모읍니다. 매달 첫째 주 세무사에게 CSV로 전달하세요.</div>
      <div className="row wrap">
        <select className="select" style={{ width: 110 }} value={year} onChange={e => setYear(e.target.value)} aria-label="연도">
          {years.map(y => (
            <option key={y}>{y}</option>
          ))}
        </select>
        <select className="select" style={{ width: 220 }} value={projectId} onChange={e => navigate(withQuery(path, query, { project: e.target.value || null }), { replace: true })} aria-label="현장">
          <option value="">모든 현장</option>
          {projects.filter(pr => data.payments.some(p => p.project_id === pr.id && isLabor(p))).map(pr => (
            <option key={pr.id} value={pr.id}>
              {pr.name}
            </option>
          ))}
        </select>
        <span className="t-cap">월을 누르면 아래에 사람별 합계와 명세가 나옵니다. 다시 누르면 한 해 전체.</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>월</th>
              <th className="num">건수</th>
              <th className="num">지급 인원</th>
              <th className="num">지급 총액</th>
              <th className="num">4대보험 적용</th>
              <th className="num">미적용</th>
              <th className="num">인력업체</th>
            </tr>
          </thead>
          <tbody>
            {months.map(m => (
              <tr key={m.month} className={`click ${m.month === month ? 'sel' : ''} ${m.count ? '' : 'muted'}`} onClick={() => setMonth(m.month === month ? null : m.month)}>
                <td className="strong">{Number(m.month.slice(5))}월</td>
                <td className="num">{m.count || '–'}</td>
                <td className="num">{m.people || '–'}</td>
                <td className="num">{m.total ? m.total.toLocaleString('ko-KR') : '–'}</td>
                <td className="num">{m.insured ? m.insured.toLocaleString('ko-KR') : '–'}</td>
                <td className="num">{m.uninsured ? m.uninsured.toLocaleString('ko-KR') : '–'}</td>
                <td className="num">{m.agency ? m.agency.toLocaleString('ko-KR') : '–'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>합계</td>
              <td className="num">{months.reduce((n, m) => n + m.count, 0)}</td>
              <td />
              <td className="num">{months.reduce((n, m) => n + m.total, 0).toLocaleString('ko-KR')}</td>
              <td className="num">{months.reduce((n, m) => n + m.insured, 0).toLocaleString('ko-KR')}</td>
              <td className="num">{months.reduce((n, m) => n + m.uninsured, 0).toLocaleString('ko-KR')}</td>
              <td className="num">{months.reduce((n, m) => n + m.agency, 0).toLocaleString('ko-KR')}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <section className="section">
        <div className="section-h">
          <span className="t-bodyb">{month ? `${month.replace('-', '.')}` : `${year}년`} 사람별 노무비</span>
          <span className="cap">
            {people.length}명 · 지급 {people.reduce((n, r) => n + r.total, 0).toLocaleString('ko-KR')}원
            {people.some(r => r.open) ? ` · 미지급 ${people.reduce((n, r) => n + r.open, 0).toLocaleString('ko-KR')}원` : ''}
          </span>
          {month && (
            <span className="seg" role="radiogroup" aria-label="보기">
              <button type="button" role="radio" aria-checked={by === 'person'} className={by === 'person' ? 'on' : ''} onClick={() => setBy('person')}>
                사람별
              </button>
              <button type="button" role="radio" aria-checked={by === 'list'} className={by === 'list' ? 'on' : ''} onClick={() => setBy('list')}>
                지급 명세
              </button>
            </span>
          )}
        </div>
        {(!month || by === 'person') &&
          (people.length === 0 ? (
            <Empty>이 기간 노무비가 없습니다.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>성명</th>
                    <th>고용형태</th>
                    <th>현장</th>
                    <th className="num">지급 건수</th>
                    <th className="num">지급 총액</th>
                    <th className="num">미지급</th>
                    <th>계좌</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map(r => (
                    <tr key={r.key}>
                      <td className="strong nowrap">{r.name}</td>
                      <td className="nowrap t-cap">{r.types.join(', ') || <span className="t-red">미입력</span>}</td>
                      <td className="max t-cap truncate" style={{ maxWidth: 200 }} title={r.projects.map(projectName).join(', ')}>
                        {r.projects.map(projectName).filter(Boolean).join(', ') || '–'}
                      </td>
                      <td className="num">{r.count || '–'}</td>
                      <td className="num">{r.total ? r.total.toLocaleString('ko-KR') : '–'}</td>
                      <td className={`num ${r.open ? 't-blue' : ''}`}>{r.open ? r.open.toLocaleString('ko-KR') : '–'}</td>
                      <td>
                        <AccountCell bank={r.bank} no={r.account} holder={r.holder} payee={r.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </section>
      {month && by === 'list' && (
        <section className="section">
          <div className="section-h">
            <span className="t-bodyb">{month.replace('-', '.')} 노무비 명세</span>
            <span className="cap">{rows.length}건 · {rows.reduce((n, p) => n + p.amount, 0).toLocaleString('ko-KR')}원</span>
            <Button kind="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
              세무사용 CSV
            </Button>
          </div>
          {(unpaid.length > 0 || noType.length > 0 || otherHolder.length > 0) && (
            <div className="note warn">
              {unpaid.length > 0 && <div>이 달 지급 예정인데 아직 미지급인 노무비 {unpaid.length}건 ({unpaid.reduce((n, p) => n + p.amount, 0).toLocaleString('ko-KR')}원)</div>}
              {noType.length > 0 && <div>고용형태(계약형태)가 비어 있는 {noType.length}건 — 4대보험 적용 여부를 나눌 수 없어 '미적용'으로 셉니다.</div>}
              {otherHolder.length > 0 && <div>성명과 예금주가 다른 {otherHolder.length}건 — 신고 대상자를 세무사와 확인하세요.</div>}
            </div>
          )}
          {rows.length === 0 ? (
            <Empty>이 달 지급 완료된 노무비가 없습니다.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>지급일</th>
                    <th>현장</th>
                    <th>공사 구분</th>
                    <th>항목</th>
                    <th>성명</th>
                    <th>고용형태</th>
                    <th>계좌</th>
                    <th className="num">지급금액</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => (
                    <tr key={p.id}>
                      <td className="num">{shortDate(p.paid_date)}</td>
                      <td className="max truncate">{projectName(p.project_id) || '–'}</td>
                      <td className="nowrap">{p.category ?? '–'}</td>
                      <td className="nowrap">{p.title}</td>
                      <td className="strong nowrap">
                        {p.payee ?? '–'} {isAgency(p) && <Badge tone="paper">업체</Badge>}
                      </td>
                      <td className="nowrap t-cap">{p.contract_type ?? '–'}</td>
                      <td>
                        <AccountCell bank={p.bank_name} no={p.account_no} holder={p.account_holder && !sameName(p.account_holder, p.payee) ? p.account_holder : null} />
                      </td>
                      <td className={`num ${p.amount < 0 ? 'red' : ''}`}>{p.amount.toLocaleString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  )
}

/** 월요일 지급 목록: 받는 계좌별로 묶어 이체용 CSV 와 일괄 완료 처리 */
function Run({ data, projects }: { data: PayData; projects: Project[] }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const [date, setDate] = useState(runMonday(today))
  const [off, setOff] = useState<Set<string>>(new Set())
  const [label, setLabel] = useState('더위클리')
  const r = paymentRun(data.payments, date)
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? ''
  const ready = r.groups.filter(g => g.account && !off.has(g.key))
  const total = ready.reduce((n, g) => n + g.total, 0)
  const count = ready.reduce((n, g) => n + g.items.length, 0)
  const noAccount = r.groups.filter(g => !g.account)
  const exportCsv = () => {
    const cols = [
      ['bank', '은행'], ['account', '계좌번호'], ['holder', '예금주'], ['total', '금액'], ['label', '받는 분 통장 표시'], ['mine', '내 통장 표시'], ['memo', '내용'],
    ].map(([key, l]) => ({ key, label: l }))
    downloadText(
      `월요일지급_${date}.csv`,
      toCsv(ready.map(g => ({ bank: g.bank ?? '', account: g.account, holder: g.holder, total: g.total, label, mine: g.holder.slice(0, 10), memo: [...new Set(g.items.map(p => [projectName(p.project_id), p.title].filter(Boolean).join(' ')))].join(' / ') })), cols),
    )
  }
  return (
    <>
      <div className="row wrap">
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, -7))} aria-label="지난 월요일">
          <ChevronLeft size={16} />
        </button>
        <span className="t-bodyb">{dateLabel(date)} 지급</span>
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(date, 7))} aria-label="다음 월요일">
          <ChevronRight size={16} />
        </button>
        {date !== runMonday(today) && (
          <Button kind="ghost" size="sm" onClick={() => setDate(runMonday(today))}>
            이번 지급일
          </Button>
        )}
        <span className="grow" />
        <label className="row t-cap" style={{ gap: 6 }}>
          받는 분 통장 표시
          <input className="input" style={{ width: 120 }} value={label} onChange={e => setLabel(e.target.value)} aria-label="받는 분 통장 표시" />
        </label>
      </div>
      <div className="note">
        지급예정일이 {shortDate(date)}까지인 예정·청구 지급을 받는 계좌별로 묶었습니다 · <b className="t-blue">{ready.length}곳 · {count}건 · {total.toLocaleString('ko-KR')}원</b>
        {r.waiting.length > 0 && ` · 대기 ${r.waiting.length}건 제외`}
        {r.held > 0 && ` · 보류 ${r.held}건 제외`}
        {r.advances > 0 && ` · 대지급 ${r.advances}건은 '대지급 정산'에서`}
      </div>
      {noAccount.length > 0 && <div className="note warn">계좌 정보가 없는 {noAccount.reduce((n, g) => n + g.items.length, 0)}건은 이체 목록에서 뺐습니다. 결제 대장에서 계좌를 넣어 주세요.</div>}
      {r.groups.length === 0 ? (
        <Empty>이 날까지 지급할 결제가 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>받는 분 (예금주)</th>
                <th>은행</th>
                <th>계좌번호</th>
                <th className="num">건수</th>
                <th className="num">금액</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {r.groups.map(g => (
                <tr key={g.key} className={!g.account ? 'muted' : off.has(g.key) ? 'muted' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${g.holder} 지급`}
                      disabled={!g.account}
                      checked={!!g.account && !off.has(g.key)}
                      onChange={e => {
                        const next = new Set(off)
                        if (e.target.checked) next.delete(g.key)
                        else next.add(g.key)
                        setOff(next)
                      }}
                    />
                  </td>
                  <td className="strong nowrap">{g.holder}</td>
                  <td className="nowrap">{g.bank ?? '–'}</td>
                  <td className="nowrap" style={{ fontFamily: 'var(--mono)' }}>
                    {g.account ?? <span className="t-red">계좌 없음</span>}
                  </td>
                  <td className="num">{g.items.length}</td>
                  <td className="num">{g.total.toLocaleString('ko-KR')}</td>
                  <td className="max">
                    {g.items.map(p => (
                      <span key={p.id} className="t-cap" style={{ display: 'block' }}>
                        {shortDate(p.due_date)} · {[projectName(p.project_id), p.title].filter(Boolean).join(' ')}
                        {p.due_date && p.due_date < today ? <span className="t-red"> (연체)</span> : ''}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.waiting.length > 0 && (
        <span className="t-cap">
          대기 중: {r.waiting.map(p => `${p.payee ?? p.title} ${manwon(p.amount)}`).join(', ')} — 지급하려면 결제 대장에서 상태를 '예정'으로 바꾸세요.
        </span>
      )}
      <div className="row wrap">
        <span className="t-cap grow">은행 대량이체 양식과 열 순서가 다르면 CSV를 열어 맞춰 붙여 넣으세요. 계좌번호는 관리자 화면에만 보입니다.</span>
        <Button kind="outline" onClick={exportCsv} disabled={!ready.length}>
          이체용 CSV
        </Button>
        <Button
          disabled={busy || !count}
          onClick={async () =>
            (await ask(`${ready.length}곳 ${count}건 (${total.toLocaleString('ko-KR')}원)을 오늘 지급 완료로 처리할까요?`)) &&
            run(() => api.updatePayments(ready.flatMap(g => g.items.map(p => p.id)), { status: '완료', paid_date: today }), '지급 완료로 처리했습니다.')
          }
        >
          지급 완료 처리 ({count}건)
        </Button>
      </div>
    </>
  )
}

/** 결제 대장 점검: 연체·계좌 없음·세금계산서·예산·노무비 */
function Checks({ data, projects }: { data: PayData; projects: Project[] }) {
  const { navigate } = useRouter()
  const today = todayKey()
  const checks = paymentChecks(data.payments, data.lines, projects, today)
  const [open, setOpen] = useState<string | null>(checks[0]?.key ?? null)
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? '–'
  if (!checks.length) return <Empty>점검할 항목이 없습니다. 연체·계좌·세금계산서·예산·노무비 모두 이상 없음.</Empty>
  return (
    <>
      <div className="note">엑셀 결제 대장에서 놓치기 쉬웠던 것들을 매번 자동으로 찾습니다. 항목을 누르면 결제 내용을 바로 고칠 수 있어요.</div>
      {checks.map(c => (
        <section key={c.key} className="section">
          <button type="button" className="section-h" style={{ border: 0, borderBottom: '1px dashed var(--line)', background: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setOpen(open === c.key ? null : c.key)} aria-expanded={open === c.key}>
            <Badge tone={c.level === 'high' ? 'red' : 'yellow'}>{c.level === 'high' ? '먼저' : '확인'}</Badge>
            <span className="t-bodyb">{c.title}</span>
            <Badge tone="outline">{c.items.length}건</Badge>
            <span className="cap">{c.why}</span>
          </button>
          {open === c.key && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>현장</th>
                    <th>항목</th>
                    <th>업체·성명</th>
                    <th className="num">금액</th>
                    <th>상태</th>
                    <th className="num">예정일</th>
                  </tr>
                </thead>
                <tbody>
                  {c.items.slice(0, 60).map(p => (
                    <tr key={p.id} className="click" onClick={() => navigate(`/projects?view=payments&pid=${p.id}`)}>
                      <td className="max truncate">{projectName(p.project_id)}</td>
                      <td className="strong max truncate">
                        {p.direction === '수금' ? '[수금] ' : ''}
                        {p.title}
                      </td>
                      <td className="nowrap">{p.payee ?? '–'}</td>
                      <td className="num">{p.amount.toLocaleString('ko-KR')}</td>
                      <td className="nowrap">{p.is_estimate ? '예상' : p.status}</td>
                      <td className={`num ${p.due_date && p.due_date < today && isOpen(p) ? 'red' : ''}`}>{shortDate(p.due_date) || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {c.items.length > 60 && <span className="t-cap">외 {c.items.length - 60}건</span>}
            </div>
          )}
        </section>
      ))}
    </>
  )
}
