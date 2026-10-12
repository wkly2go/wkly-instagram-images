import { useMemo, useState } from 'react'
import { Download, Plus, Search } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { toCsv, downloadText } from '../lib/csv'
import { manwon, shortDate, todayKey } from '../lib/date'
import { advanceGroups, isAgency, isDone, isLabor, isOpen, isOverdue, laborMonthly, maskAccount, sameName, supply } from '../lib/finance'
import { useRouter, withQuery } from '../lib/router'
import type { BudgetLine, Client, Payment, Project } from '../lib/types'
import { PaymentForm } from '../components/PaymentForm'
import { Badge, Button, Chip, Empty, Loading, type Tone } from '../components/ui'
import { PaymentImport } from './PaymentImport'

const PAY_TONE: Record<Payment['status'], Tone> = { 예정: 'outline', 청구: 'yellow', 대기: 'yellow', 완료: 'acid', 보류: 'paper', 취소: 'paper' }

export interface PayData {
  payments: Payment[]
  lines: BudgetLine[]
}

/** 프로젝트 › 결제 대장 (관리자) */
export function Payments({ projects, clients }: { projects: Project[]; clients: Client[] }) {
  const { api, version } = useApp()
  const { query, path, navigate } = useRouter()
  const sub = query.get('sub') ?? 'register'
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })
  const { data, loading } = useAsync<PayData>(
    async () => {
      const [payments, lines] = await Promise.all([api.listPayments(), api.listBudgetLines()])
      return { payments, lines }
    },
    [version],
    { payments: [], lines: [] },
  )
  const advances = advanceGroups(data.payments)
  return (
    <div className="col gap-10">
      <div className="chips" role="tablist" aria-label="결제 대장 메뉴">
        <Chip active={sub === 'register'} onClick={() => go({ sub: null })}>
          결제 대장
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
      </div>
      {loading && !data.payments.length ? (
        <Loading />
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
  const { api } = useApp()
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
  const [form, setForm] = useState<Payment | 'new' | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? ''

  const categories = useMemo(() => [...new Set(data.payments.map(p => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'ko')), [data.payments])
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
  const total = real.reduce((n, p) => n + p.amount, 0)
  const done = real.filter(isDone).reduce((n, p) => n + p.amount, 0)
  const open = real.filter(isOpen).reduce((n, p) => n + p.amount, 0)
  const late = real.filter(p => isOverdue(p, today))
  const estimate = rows.filter(p => p.is_estimate && p.status !== '취소').reduce((n, p) => n + p.amount, 0)
  const selected = rows.filter(p => sel.has(p.id))
  const opened = openId ? data.payments.find(p => p.id === openId) : undefined

  const toggleAll = (on: boolean) => setSel(on ? new Set(rows.map(p => p.id)) : new Set())
  const bulk = async (patch: Partial<Payment>, msg: string) => {
    if (await run(() => api.updatePayments([...sel], patch), msg)) setSel(new Set())
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
      <div className="filters">
        <select className="select" value={projectId} onChange={e => go({ project: e.target.value || null })} aria-label="프로젝트">
          <option value="">모든 현장</option>
          <option value="none">현장 없음</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
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
        <span className="grow" />
        <Button kind="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
          <Download size={12} /> CSV
        </Button>
        <Button size="sm" onClick={() => setForm('new')}>
          <Plus size={12} /> 결제 추가
        </Button>
      </div>
      <div className="note">
        {rows.length}건 · 합계 <b className="t-blue">{manwon(total) || '0'}</b> · 완료 {manwon(done) || '0'} · 미결제 <b className="t-blue">{manwon(open) || '0'}</b>
        {late.length > 0 && <span className="t-red"> · 연체 {late.length}건 {manwon(late.reduce((n, p) => n + p.amount, 0))}</span>}
        {estimate !== 0 && <> · 예상 비용 {manwon(estimate)} (합계 제외)</>} · 실제 금액(VAT 포함) 기준
      </div>
      {rows.length === 0 ? (
        <Empty>조건에 맞는 결제가 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="모두 선택" checked={sel.size > 0 && selected.length === rows.length} onChange={e => toggleAll(e.target.checked)} />
                </th>
                <th>요청일</th>
                {!projectId && <th>현장</th>}
                <th>공사 구분</th>
                <th>항목</th>
                <th>업체·성명</th>
                <th className="num">금액</th>
                <th>상태</th>
                <th className="num" title="완료면 지급일, 아니면 지급예정일">날짜</th>
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
                    <td className="num">{shortDate(p.requested_date) || '–'}</td>
                    {!projectId && (
                      <td className="max">
                        <span className="truncate" style={{ display: 'block', maxWidth: 130 }} title={projectName(p.project_id)}>
                          {projectName(p.project_id) || '–'}
                        </span>
                      </td>
                    )}
                    <td className="nowrap">{p.category ?? '–'}</td>
                    <td className="max">
                      <span className="strong truncate" style={{ display: 'block' }} title={p.title}>
                        {p.direction === '수금' && <Badge tone="blue">수금</Badge>} {p.title}
                      </span>
                      <span className="t-cap">{[p.stage, p.is_estimate ? '예상 비용' : null, p.advance_by ? `대지급 ${p.advance_by}` : null, p.approval_id ? '지출 승인' : null].filter(Boolean).join(' · ')}</span>
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
                    </td>
                    <td className="nowrap t-cap">{p.tax_invoice === '해당 없음' ? '–' : p.tax_invoice}</td>
                    <td className="nowrap t-cap" title={p.account_holder ? `예금주 ${p.account_holder}` : undefined}>
                      {p.bank_name || p.account_no ? `${p.bank_name ?? ''} ${maskAccount(p.account_no)}` : '–'}
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
          <Button size="sm" disabled={busy} onClick={() => bulk({ status: '완료', paid_date: today }, '완료 처리했습니다.')}>
            완료 처리 (오늘)
          </Button>
          <Button kind="outline" size="sm" disabled={busy} onClick={() => bulk({ status: '대기' }, '대기로 바꿨습니다.')}>
            대기
          </Button>
          <Button kind="outline" size="sm" disabled={busy} onClick={() => bulk({ status: '취소' }, '취소로 바꿨습니다.')}>
            취소
          </Button>
          <Button
            kind="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`선택한 ${sel.size}건을 삭제할까요?`)) return
              const ids = [...sel]
              if (await run(async () => {
                for (const id of ids) await api.deletePayment(id)
              }, '삭제했습니다.'))
                setSel(new Set())
            }}
          >
            삭제
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setSel(new Set())}>
            선택 해제
          </Button>
        </div>
      )}
      {(form || opened) && (
        <PaymentForm
          payment={form === 'new' ? null : (form ?? opened ?? null)}
          preset={{ project_id: projectId && projectId !== 'none' ? projectId : null, direction: (dir as Payment['direction']) || '지급' }}
          projects={projects}
          clients={clients}
          payments={data.payments}
          lines={data.lines}
          onClose={() => {
            setForm(null)
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
  const settled = data.payments.filter(p => p.advance_by && p.status === '완료').length
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
              <Button size="sm" disabled={busy} onClick={() => window.confirm(`${g.by}님에게 ${g.total.toLocaleString('ko-KR')}원 정산 완료로 처리할까요?`) && run(() => api.updatePayments(g.items.map(p => p.id), { status: '완료', paid_date: today }), '정산 완료로 처리했습니다.')}>
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
  const [year, setYear] = useState(today.slice(0, 4))
  const [month, setMonth] = useState<string | null>(today.slice(0, 7))
  const months = laborMonthly(data.payments, year)
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? ''
  const labor = data.payments.filter(isLabor)
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
      <div className="row">
        <select className="select" style={{ width: 110 }} value={year} onChange={e => setYear(e.target.value)} aria-label="연도">
          {years.map(y => (
            <option key={y}>{y}</option>
          ))}
        </select>
        <span className="t-cap">월을 누르면 아래에 명세가 나옵니다.</span>
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
      {month && (
        <section className="section">
          <div className="section-h">
            <span className="t-bodyb">{month.replace('-', '.')} 노무비 명세</span>
            <span className="cap">{rows.length}건 · {rows.reduce((n, p) => n + p.amount, 0).toLocaleString('ko-KR')}원</span>
            <Button kind="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
              <Download size={12} /> 세무사용 CSV
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
                      <td className="nowrap t-cap">
                        {p.bank_name ?? ''} {maskAccount(p.account_no)}
                        {p.account_holder && !sameName(p.account_holder, p.payee) ? ` (${p.account_holder})` : ''}
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
