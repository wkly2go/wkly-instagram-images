// 장부 › 세무 · 결산 (2026-11-27 대표 지시 '우리 인트라넷에 경리 회계관련 전문성있게 고도화시켜')
//  세무 일정 · 부가세 신고 준비 · 미수 · 미지급 연령 · 자금 계획 · 월마감 점검 · 분개 초안 · 시산표
//  장부 비밀번호로 연 동안만 보이고(장부 화면 안), 숫자는 장부 · 홈택스 목록 · 결제 대장에서 자동으로 모은다.
//  산출물은 세무대리인 검토용 준비 자료 — 신고 · 납부 · 이체 · 발송은 사람이 한다.
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BookOpen, CalendarClock, ClipboardCheck, Copy, Download, Hourglass, Receipt, Wallet } from 'lucide-react'
import './Accounting.css'
import { Button, Empty } from './ui'
import { useApp } from '../lib/app'
import { addDays, dateLabel, todayKey, weekday, won } from '../lib/date'
import { downloadText, toCsv } from '../lib/csv'
import { COMPANIES, companyOfProject, setCompany, useCompany, type CompanyKey } from '../lib/company'
import { ACCT_DISCLAIMER, TAX_KIND_LABEL, dLabel, daysBetween, type AcctSettings, type AcctSettingsPatch, type MonthClose, type TaxEvent } from '../lib/acct'
import { AGING_BUCKETS, agingTable, openInvoices, reminderText } from '../lib/acctAging'
import type { LedgerEntry, LedgerRecurring, Payment, TaxInvoice, TaxInvoiceSummary } from '../lib/types'

const Views = lazy(() => import('./AccountingViews'))

export type AcctView = 'tax' | 'vat' | 'aging' | 'cash' | 'close' | 'journal'
export type AcctData = {
  today: string
  company: CompanyKey | 'all'
  ledger: LedgerEntry[]
  invoices: TaxInvoice[]
  sums: TaxInvoiceSummary[]
  payments: Payment[]
  recurring: LedgerRecurring[]
  settings: AcctSettings[]
  closes: MonthClose[]
  openingCount: number
  events: TaxEvent[]
}

const VIEWS: { key: AcctView; label: string; icon: ReactNode }[] = [
  { key: 'tax', label: '세무 일정', icon: <CalendarClock size={14} /> },
  { key: 'vat', label: '부가세 신고 준비', icon: <Receipt size={14} /> },
  { key: 'aging', label: '미수 · 미지급', icon: <Hourglass size={14} /> },
  { key: 'cash', label: '자금 계획', icon: <Wallet size={14} /> },
  { key: 'close', label: '월마감 점검', icon: <ClipboardCheck size={14} /> },
  { key: 'journal', label: '분개 · 시산표', icon: <BookOpen size={14} /> },
]
const VIEW_KEY = 'wkly-acct-view'
const readView = (): AcctView => {
  try {
    const v = sessionStorage.getItem(VIEW_KEY)
    return VIEWS.some(x => x.key === v) ? (v as AcctView) : 'tax'
  } catch {
    return 'tax'
  }
}

export default function AccountingHub({ onExpired }: { onExpired: () => void }) {
  const { api } = useApp()
  const company = useCompany()
  const [view, setViewState] = useState<AcctView>(readView)
  const setView = (v: AcctView) => {
    setViewState(v)
    try { sessionStorage.setItem(VIEW_KEY, v) } catch { /* 기억 못 해도 화면은 바뀜 */ }
  }
  const [data, setData] = useState<AcctData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = todayKey()

  const loadEvents = useCallback(() => api.acctTaxCalendar(addDays(today, -45), addDays(today, 400)), [api, today])
  const load = useCallback(async () => {
    setError(null)
    const y = Number(today.slice(0, 4))
    let ledger: LedgerEntry[]
    try {
      ledger = await api.listLedger(`${y - 1}-07-01`, `${y}-12-31`)
    } catch {
      onExpired() // 잠겼거나 시간이 지남
      return
    }
    try {
      const [invoices, sums, payments, projects, recurring, settings, closes, opening, events] = await Promise.all([
        api.listTaxInvoices(),
        api.listTaxInvoiceSummaries().catch(() => [] as TaxInvoiceSummary[]),
        api.listPayments().catch(() => [] as Payment[]),
        api.listProjects().catch(() => []),
        api.listRecurring().catch(() => [] as LedgerRecurring[]),
        api.listAcctSettings().catch(() => [] as AcctSettings[]),
        api.listMonthClose().catch(() => [] as MonthClose[]),
        api.listLedgerOpening(y).catch(() => []),
        loadEvents().catch(() => [] as TaxEvent[]),
      ])
      // 결제 대장 → 회사 (프로젝트 연번 앞 두 글자 · 프로젝트 없으면 아트리어)
      const projCo = new Map(projects.map(p => [p.id, companyOfProject(p)]))
      const payCo = (p: Payment): CompanyKey => (p.project_id ? projCo.get(p.project_id) : null) ?? 'AR'
      setData({
        today,
        company,
        ledger,
        invoices,
        sums,
        payments: payments.filter(p => company === 'all' || payCo(p) === company),
        // 정기 출금 표에는 회사 칸이 없음 — 아트리어 것으로 봄
        recurring: company === 'TW' ? [] : recurring,
        settings,
        closes: closes.filter(c => company === 'all' || c.company === company),
        openingCount: opening.length,
        events: events.filter(e => company === 'all' || e.company === company),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.')
    }
  }, [api, company, loadEvents, onExpired, today])
  useEffect(() => void load(), [load])
  const refreshEvents = useCallback(async () => {
    const [events, settings] = await Promise.all([loadEvents(), api.listAcctSettings()])
    setData(d => (d ? { ...d, settings, events: events.filter(e => company === 'all' || e.company === company) } : d))
  }, [api, company, loadEvents])
  const refreshCloses = useCallback(async () => {
    const closes = await api.listMonthClose()
    setData(d => (d ? { ...d, closes: closes.filter(c => company === 'all' || c.company === company) } : d))
  }, [api, company])

  return (
    <div className="acct">
      <div className="acct-views" role="tablist" aria-label="세무 · 결산 화면">
        {VIEWS.map(v => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={`chip${view === v.key ? ' active' : ''}`} onClick={() => setView(v.key)}>
            {v.icon} {v.label}
          </button>
        ))}
      </div>
      <p className="acct-disclaimer">{ACCT_DISCLAIMER} 신고 · 납부 · 이체 · 발송은 대표 · 세무대리인이 합니다.</p>
      {error ? (
        <Empty>
          {error} <Button kind="outline" size="sm" onClick={() => void load()}>다시 시도</Button>
        </Empty>
      ) : !data ? (
        <Empty>장부 · 세금계산서 · 결제 대장을 모으는 중…</Empty>
      ) : view === 'tax' ? (
        <TaxCalendar data={data} onChanged={refreshEvents} />
      ) : company === 'all' ? (
        <NeedCompany />
      ) : view === 'aging' ? (
        <AgingView data={data} company={company} />
      ) : (
        <Suspense fallback={<Empty>불러오는 중…</Empty>}>
          <Views view={view} data={data} company={company} onClosed={refreshCloses} />
        </Suspense>
      )}
    </div>
  )
}

/** 두 회사 장부는 섞지 않는다 — 회사를 먼저 고름 */
function NeedCompany() {
  return (
    <div className="acct-card">
      <h3>회사를 골라 주세요</h3>
      <p className="acct-sub">두 회사 장부를 섞지 않도록 부가세 · 미수 · 자금 · 마감 · 분개는 회사별로 봅니다. 세무 일정만 두 회사를 함께 봅니다.</p>
      <div className="acct-row">
        {(['AR', 'TW'] as CompanyKey[]).map(k => (
          <Button key={k} kind="outline" size="sm" onClick={() => setCompany(k)}>
            {COMPANIES[k].label} 보기
          </Button>
        ))}
      </div>
    </div>
  )
}

export const CoTag = ({ k }: { k: CompanyKey }) => <span className={`acct-tag co-${k}`}>{COMPANIES[k].label}</span>

// ---------------------------------------------------------------- 세무 일정
function TaxCalendar({ data, onChanged }: { data: AcctData; onChanged: () => Promise<void> }) {
  const { api, toast } = useApp()
  const { today, events, settings } = data
  const [showDone, setShowDone] = useState(false)
  const [kind, setKind] = useState<string>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const kinds = useMemo(() => [...new Set(events.map(e => e.kind))], [events])
  const shown = events.filter(e => kind === 'all' || e.kind === kind)
  const late = shown.filter(e => !e.done && e.due_date < today)
  const upcoming = shown.filter(e => e.due_date >= today && (showDone || !e.done))
  const byMonth = new Map<string, TaxEvent[]>()
  for (const e of upcoming) byMonth.set(e.due_date.slice(0, 7), [...(byMonth.get(e.due_date.slice(0, 7)) ?? []), e])
  const week = events.filter(e => !e.done && e.due_date >= today && daysBetween(today, e.due_date) <= 7)
  const month = events.filter(e => !e.done && e.due_date.slice(0, 7) === today.slice(0, 7))
  const nextVat = events.find(e => e.kind === 'vat' && !e.done && e.due_date >= today)
  const unconfirmed = settings.filter(s => !s.confirmed_at && (data.company === 'all' || s.company === data.company))
  const noHolidays = events.some(e => !e.holidays_loaded)

  const mark = async (e: TaxEvent) => {
    setBusy(`${e.company}|${e.task_key}`)
    try {
      await api.acctTaxMark(e.company, e.task_key, !e.done)
      await onChanged()
      toast(e.done ? '다시 할 일로 돌렸습니다.' : '끝냄으로 표시했습니다 — 이 일정 알림이 멈춥니다.')
    } catch (x) {
      toast(x instanceof Error ? x.message : '고치지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const row = (e: TaxEvent) => {
    const key = `${e.company}|${e.task_key}`
    const left = daysBetween(today, e.due_date)
    const tone = e.done ? 'ok' : left < 0 ? 'warn' : left <= 3 ? 'warn' : left <= 7 ? 'mid' : ''
    return (
      <div key={key} className={`acct-ev${e.done ? ' done' : ''}${!e.done && left < 0 ? ' late' : ''}`}>
        <div className="acct-ev-date">
          {e.due_date.slice(5).replace('-', '.')} ({weekday(e.due_date)})
          {e.base_date !== e.due_date && <small title="법정 날짜가 주말 · 공휴일이라 다음 날로">원래 {e.base_date.slice(5).replace('-', '.')}</small>}
        </div>
        <div className="acct-ev-d">
          <span className={`acct-tag ${tone}`}>{e.done ? '끝냄' : dLabel(e.due_date, today)}</span>
        </div>
        <div className="acct-ev-body">
          <b>
            {e.title} <CoTag k={e.company} />
          </b>
          <span>
            {e.period}
            {e.note ? ` · ${e.note}` : ''}
          </span>
          <button type="button" className="acct-ev-more" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
            {open === key ? '접기' : '준비물 · 근거'}
          </button>
          {open === key && (
            <span>
              준비물: {e.prep}
              <br />
              근거: {e.basis}
              {!e.holidays_loaded && <><br />이 해 공휴일 자료가 없어 주말만 넘겨 계산했습니다.</>}
              {e.done && e.done_at && <><br />끝냄 표시 {e.done_at.slice(0, 16).replace('T', ' ')}</>}
            </span>
          )}
        </div>
        <div className="acct-ev-act">
          <Button kind={e.done ? 'ghost' : 'outline'} size="sm" disabled={busy === key} onClick={() => void mark(e)}>
            {e.done ? '되돌리기' : '끝냄'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="acct">
      <div className="acct-kpis">
        <div className={`acct-kpi${week.length ? ' warn' : ''}`}>
          <span>7일 안</span>
          <b>{week.length}건</b>
          <em>{week[0] ? `${week[0].title.split(' (')[0]} ${dLabel(week[0].due_date, today)}` : '급한 기한 없음'}</em>
        </div>
        <div className="acct-kpi">
          <span>이번 달 남은 일</span>
          <b>{month.length}건</b>
          <em>{today.slice(0, 7).replace('-', '년 ')}월</em>
        </div>
        <div className={`acct-kpi${late.length ? ' warn' : ' key'}`}>
          <span>기한 지났는데 안 끝냄</span>
          <b>{late.length}건</b>
          <em>{late.length ? '끝냈으면 끝냄 표시' : '없음'}</em>
        </div>
        <div className="acct-kpi key">
          <span>다음 부가세</span>
          <b>{nextVat ? dLabel(nextVat.due_date, today) : '—'}</b>
          <em>{nextVat ? `${dateLabel(nextVat.due_date)} · ${nextVat.period}` : '일정 없음'}</em>
        </div>
      </div>
      {unconfirmed.length > 0 && (
        <p className="acct-note warn">
          회사 설정 확인 필요 — {unconfirmed.map(s => COMPANIES[s.company].label).join(' · ')}: 원천세 주기 · 급여 · 3.3% 지급 여부로 일정이 달라집니다. 아래 '회사 설정'에서 맞는지 보고 저장해 주세요.
        </p>
      )}
      {noHolidays && <p className="acct-note warn">공휴일 자료가 없는 해가 있어 그 해 기한은 주말만 넘겨 계산했습니다.</p>}
      <div className="acct-row">
        <div className="acct-views" role="tablist" aria-label="종류">
          <button type="button" role="tab" aria-selected={kind === 'all'} className={`chip${kind === 'all' ? ' active' : ''}`} onClick={() => setKind('all')}>
            전체
          </button>
          {kinds.map(k => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {TAX_KIND_LABEL[k] ?? k}
            </button>
          ))}
        </div>
        <span className="acct-grow" />
        <label className="acct-row">
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> 끝낸 일도 보기
        </label>
      </div>
      {late.length > 0 && (
        <section className="acct-cal" aria-label="기한 지남">
          <div className="acct-month acct-neg">기한 지남 · 끝냄 표시 안 함 {late.length}건</div>
          {late.map(row)}
        </section>
      )}
      <section className="acct-cal" aria-label="다가오는 세무 일정">
        {byMonth.size === 0 && <Empty>{events.length ? '조건에 맞는 일정이 없습니다.' : '세무 일정을 불러오지 못했습니다.'}</Empty>}
        {[...byMonth.entries()].map(([m, list]) => (
          <div key={m} className="acct-cal">
            <div className="acct-month">
              {m.slice(0, 4)}년 {Number(m.slice(5))}월 <span className="acct-sub">· {list.length}건</span>
            </div>
            {list.map(row)}
          </div>
        ))}
      </section>
      <SettingsPanel settings={settings.filter(s => data.company === 'all' || s.company === data.company)} onSaved={onChanged} />
      <p className="acct-sub">
        기한은 법정 날짜에서 주말 · 공휴일(대체공휴일 · 노동절 포함)을 넘긴 실제 날짜입니다 (국세기본법 제5조). 공휴일은 한국천문연구원 월력 자료 기준이며 매달 1일 다시 확인합니다. 대표에게 D-7 · D-3 · D-1 · 당일 알림이 갑니다 (제목에 금액 없음). 국세청 세무일정으로 한 번 더 확인해 주세요.
      </p>
    </div>
  )
}

function SettingsPanel({ settings, onSaved }: { settings: AcctSettings[]; onSaved: () => Promise<void> }) {
  if (!settings.length) return null
  return (
    <details className="acct-card" open={settings.some(s => !s.confirmed_at)}>
      <summary className="acct-ev-more">회사 설정 (세무 일정 기준)</summary>
      {settings.map(s => (
        <SettingsForm key={s.company} s={s} onSaved={onSaved} />
      ))}
    </details>
  )
}

function SettingsForm({ s, onSaved }: { s: AcctSettings; onSaved: () => Promise<void> }) {
  const { api, toast } = useApp()
  const [f, setF] = useState<AcctSettingsPatch>({})
  const [busy, setBusy] = useState(false)
  const v = { ...s, ...f }
  const set = (p: AcctSettingsPatch) => setF(x => ({ ...x, ...p }))
  const save = async () => {
    setBusy(true)
    try {
      await api.saveAcctSettings(s.company, { ...f, withholding_cycle: v.withholding_cycle, vat_filing: v.vat_filing })
      setF({})
      await onSaved()
      toast(`${COMPANIES[s.company].label} 설정을 저장했습니다 — 세무 일정을 다시 계산했습니다.`)
    } catch (x) {
      toast(x instanceof Error ? x.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="acct-card">
      <header>
        <h3>{COMPANIES[s.company].full}</h3>
        {s.confirmed_at ? <span className="acct-tag ok">확인함 {s.confirmed_at.slice(0, 10)}</span> : <span className="acct-tag warn">확인 필요</span>}
      </header>
      {s.source && <p className="acct-sub">{s.source}</p>}
      <div className="acct-settings">
        <label>
          원천세 신고 주기
          <select className="select" value={v.withholding_cycle} onChange={e => set({ withholding_cycle: e.target.value as AcctSettings['withholding_cycle'] })}>
            <option value="매월">매월 (다음 달 10일)</option>
            <option value="반기">반기 (7월 · 1월 10일 · 승인 받은 경우)</option>
          </select>
        </label>
        <label>
          부가세 예정
          <select className="select" value={v.vat_filing} onChange={e => set({ vat_filing: e.target.value as AcctSettings['vat_filing'] })}>
            <option value="예정신고">예정신고 (4 · 10월에 신고)</option>
            <option value="예정고지">예정고지 (고지서 납부 · 소규모 법인)</option>
          </select>
        </label>
        <label>
          결산월
          <select className="select" value={v.fiscal_end_month} onChange={e => set({ fiscal_end_month: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>
                {m}월
              </option>
            ))}
          </select>
        </label>
        <label>
          기장 (회계 처리)
          <input className="input" value={v.bookkeeper} maxLength={60} placeholder="예: 세무대리인 기장" onChange={e => set({ bookkeeper: e.target.value })} />
        </label>
        <label>
          급여일
          <input className="input" type="number" min={1} max={31} value={v.payroll_day ?? ''} onChange={e => set({ payroll_day: e.target.value ? Number(e.target.value) : null })} />
        </label>
        <label className="acct-check">
          <input type="checkbox" checked={v.has_payroll} onChange={e => set({ has_payroll: e.target.checked })} /> 직원 급여 지급 (4대보험 · 근로 간이지급명세서)
        </label>
        <label className="acct-check">
          <input type="checkbox" checked={v.has_freelancers} onChange={e => set({ has_freelancers: e.target.checked })} /> 3.3% 사업소득 지급 (프리랜서)
        </label>
        <label className="acct-check">
          <input type="checkbox" checked={v.has_daily_workers} onChange={e => set({ has_daily_workers: e.target.checked })} /> 일용 근로자 지급
        </label>
        <label className="acct-check">
          <input type="checkbox" checked={v.alerts} onChange={e => set({ alerts: e.target.checked })} /> 대표에게 기한 알림
        </label>
      </div>
      {s.note && <p className="acct-sub">메모: {s.note}</p>}
      <div className="acct-row">
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {s.confirmed_at && !Object.keys(f).length ? '다시 확인 · 저장' : '맞습니다 · 저장'}
        </Button>
        <span className="acct-sub">계좌 · 주민번호 · 매출 금액은 넣지 않습니다.</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 미수 · 미지급
function AgingView({ data, company }: { data: AcctData; company: CompanyKey }) {
  const { toast } = useApp()
  const [dir, setDir] = useState<'매출' | '매입'>('매출')
  const [open, setOpen] = useState<string | null>(null)
  const items = useMemo(() => openInvoices(data.invoices, dir, data.today, company), [data.invoices, dir, data.today, company])
  const t = useMemo(() => agingTable(items), [items])
  const unchecked = items.filter(i => i.unchecked).length
  const label = dir === '매출' ? '미수 (받을 돈)' : '미지급 (낼 돈)'
  const exportCsv = () =>
    downloadText(
      `${dir === '매출' ? '미수' : '미지급'}_연령표_${COMPANIES[company].label}_${data.today}.csv`,
      '﻿' +
        toCsv([
          { 거래처: ACCT_DISCLAIMER },
          ...t.rows.flatMap(r => r.items.map(i => ({ 거래처: r.partner, 사업자번호: r.biz ?? '', 작성일자: i.inv.write_date, 품목: i.inv.item ?? '', 합계: i.inv.total, 남은돈: i.left, 지난날: i.age, 구간: AGING_BUCKETS[i.bucket], 승인번호: i.inv.approval_no }))),
        ]),
    )
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('독촉 문안을 복사했습니다 — 보내기는 직접 해 주세요 (인트라넷은 보내지 않음).')
    } catch {
      toast('복사하지 못했습니다.')
    }
  }
  return (
    <div className="acct">
      <div className="acct-row">
        <div className="acct-views" role="tablist" aria-label="미수 · 미지급">
          {(['매출', '매입'] as const).map(d => (
            <button key={d} type="button" role="tab" aria-selected={dir === d} className={`chip${dir === d ? ' active' : ''}`} onClick={() => setDir(d)}>
              {d === '매출' ? '미수 (매출 계산서)' : '미지급 (매입 계산서)'}
            </button>
          ))}
        </div>
        <span className="acct-grow" />
        <Button kind="ghost" size="sm" onClick={exportCsv} disabled={!items.length}>
          <Download size={14} /> 연령표 엑셀
        </Button>
      </div>
      <div className="acct-kpis">
        <div className="acct-kpi key">
          <span>{label}</span>
          <b>{won(t.total)}</b>
          <em>
            계산서 {t.count}건 · 거래처 {t.rows.length}곳
          </em>
        </div>
        {AGING_BUCKETS.slice(1).map((b, i) => (
          <div key={b} className={`acct-kpi${i === 2 && t.totals[3] ? ' warn' : ''}`}>
            <span>{b}</span>
            <b>{won(t.totals[i + 1])}</b>
            <em>{t.total ? `${Math.round((t.totals[i + 1] / t.total) * 100)}%` : '—'}</em>
          </div>
        ))}
      </div>
      {unchecked > 0 && <p className="acct-note warn">아직 은행 · 카드와 대사하지 않은 계산서 {unchecked}건은 다 남은 것으로 봅니다 — 계산서 기준 탭에서 '다시 대사'를 눌러 주세요.</p>}
      {t.rows.length === 0 ? (
        <Empty>{dir === '매출' ? '받을 돈이 남은 매출 계산서가 없습니다.' : '낼 돈이 남은 매입 계산서가 없습니다.'}</Empty>
      ) : (
        <div className="acct-scroll">
          <table className="acct-table">
            <thead>
              <tr>
                <th>거래처</th>
                <th className="acct-num">건수</th>
                {AGING_BUCKETS.map(b => (
                  <th key={b} className="acct-num">
                    {b}
                  </th>
                ))}
                <th className="acct-num">합계</th>
                <th>가장 오래된</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map(r => (
                <FragmentRows key={r.key} open={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)} r={r} dir={dir} today={data.today} onCopy={() => void copy(reminderText(r, COMPANIES[company].full))} />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>합계</td>
                <td className="acct-num">{t.count}</td>
                {t.totals.map((v, i) => (
                  <td key={i} className={`acct-num${i === 3 && v ? ' acct-neg' : ''}`}>
                    {v.toLocaleString('ko-KR')}
                  </td>
                ))}
                <td className="acct-num">{t.total.toLocaleString('ko-KR')}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="acct-sub">
        세금계산서 작성일부터 센 날입니다. 은행 · 카드 거래와 짝지어진 금액은 뺐습니다 (계산서 기준 탭의 대사 결과). 거래처는 사업자번호로만 묶습니다. 독촉 문안은 복사만 합니다 — 보내기는 직접.
      </p>
    </div>
  )
}

function FragmentRows({ r, open, onToggle, dir, today, onCopy }: { r: ReturnType<typeof agingTable>['rows'][number]; open: boolean; onToggle: () => void; dir: '매출' | '매입'; today: string; onCopy: () => void }) {
  return (
    <>
      <tr className={`acct-click${open ? ' acct-open' : ''}`} onClick={onToggle}>
        <td className="acct-wrap">
          <b>{r.partner}</b> <span className="acct-sub">{r.biz ?? ''}</span>
        </td>
        <td className="acct-num">{r.count}</td>
        {r.buckets.map((v, i) => (
          <td key={i} className={`acct-num${i === 3 && v ? ' acct-neg' : ''}`}>
            {v ? v.toLocaleString('ko-KR') : '-'}
          </td>
        ))}
        <td className="acct-num">
          <b>{r.left.toLocaleString('ko-KR')}</b>
        </td>
        <td>
          {r.oldest} <span className="acct-sub">({daysBetween(r.oldest, today)}일)</span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8}>
            <div className="acct-row">
              {r.items.map(i => (
                <span key={i.inv.id} className="acct-tag">
                  {i.inv.write_date} · {i.inv.item ?? '계산서'} · {i.left.toLocaleString('ko-KR')}원{i.inv.settled ? ` (받은 ${Number(i.inv.settled).toLocaleString('ko-KR')})` : ''}
                </span>
              ))}
              {dir === '매출' && (
                <Button kind="outline" size="sm" onClick={onCopy}>
                  <Copy size={14} /> 독촉 문안 복사
                </Button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
