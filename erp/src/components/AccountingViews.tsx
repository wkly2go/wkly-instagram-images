// 장부 › 세무 · 결산 — 부가세 신고 준비 · 자금 계획 · 월마감 점검 · 분개 · 시산표 (회사별로만 봄)
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet } from 'lucide-react'
import { Button, Empty } from './ui'
import { ask } from './Ask'
import { useApp } from '../lib/app'
import { addMonths, dateLabel, won } from '../lib/date'
import { COMPANIES, companyOfInvoice, type CompanyKey } from '../lib/company'
import { dLabel, monthRange } from '../lib/acct'
import { PURCHASE_CLASSES, recentVatPeriods, summaryChecks, vatPeriod, vatPrep, type PurchaseClass } from '../lib/acctVat'
import { cashPlan } from '../lib/acctCash'
import { closeReport } from '../lib/acctClose'
import { buildJournal, trialBalance } from '../lib/acctJournal'
import { downloadWorkbook, journalSheets, vatSheets } from '../lib/acctExport'
import type { LedgerEntry } from '../lib/types'
import type { AcctData, AcctView } from './Accounting'

export default function AccountingViews({ view, data, company, onClosed }: { view: AcctView; data: AcctData; company: CompanyKey; onClosed: () => Promise<void> }) {
  if (view === 'vat') return <VatView data={data} company={company} />
  if (view === 'cash') return <CashView data={data} company={company} />
  if (view === 'close') return <CloseView data={data} company={company} onClosed={onClosed} />
  if (view === 'journal') return <JournalView data={data} company={company} />
  return null
}

const n = (v: number) => v.toLocaleString('ko-KR')
const signed = (v: number) => (v < 0 ? `−${n(-v)}` : n(v))

// ---------------------------------------------------------------- 부가세 신고 준비
const CLASS_TONE: Record<PurchaseClass, string> = { '공제 후보': 'ok', '불공제 후보': 'warn', '부가세 없음': '', '확인 필요': 'mid' }

function VatView({ data, company }: { data: AcctData; company: CompanyKey }) {
  const { toast } = useApp()
  const filing = data.settings.find(s => s.company === company)?.vat_filing ?? '예정신고'
  const periods = useMemo(() => recentVatPeriods(data.today, filing, 6), [data.today, filing])
  const [key, setKey] = useState(periods[0].key)
  const [cls, setCls] = useState<PurchaseClass | null>(null)
  const period = periods.find(p => p.key === key) ?? periods[0]
  const prep = useMemo(() => vatPrep({ company, period, invoices: data.invoices, ledger: data.ledger, today: data.today, filing }), [company, period, data.invoices, data.ledger, data.today, filing])
  const checks = useMemo(() => summaryChecks(data.invoices, data.sums, company, period), [data.invoices, data.sums, company, period])
  const due = data.events.find(e => e.kind === 'vat' && e.company === company && e.task_key === period.key)
  const lines = cls ? prep.purchases.filter(p => p.cls === cls) : []
  const download = async () => {
    try {
      await downloadWorkbook(`부가세준비_${COMPANIES[company].label}_${period.key.replace('vat:', '')}.xlsx`, vatSheets(prep, COMPANIES[company].full, data.today))
      toast('세무대리인 자료를 내려받았습니다 — 첫 줄에 검토용 고지문이 있습니다.')
    } catch {
      toast('엑셀을 만들지 못했습니다.')
    }
  }
  const pay = (v: number) => (v < 0 ? `환급 ${won(-v)}` : won(v))
  return (
    <div className="acct">
      <div className="acct-row">
        <div className="acct-views" role="tablist" aria-label="과세기간">
          {periods.map(p => (
            <button key={p.key} type="button" role="tab" aria-selected={p.key === period.key} className={`chip${p.key === period.key ? ' active' : ''}`} onClick={() => setKey(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="acct-grow" />
        <Button size="sm" onClick={() => void download()}>
          <FileSpreadsheet size={14} /> 세무대리인 자료 (엑셀)
        </Button>
      </div>
      <p className="acct-note">
        {period.filing} · {due ? `기한 ${dateLabel(due.due_date)} (${dLabel(due.due_date, data.today)})` : `${period.to.slice(0, 4)}년 기한은 세무 일정 참고`}
        {prep.open ? ' · 기간이 끝나지 않았거나 장부에 확인 필요 줄이 남아 있어 숫자가 바뀔 수 있습니다' : ' · 기간 자료가 모두 들어와 있습니다'}
        {period.filing === '예정고지 납부' ? ' · 예정고지 법인은 이 기간을 신고하지 않고 고지서 금액을 냅니다 (아래 숫자는 확정 신고 준비용 참고)' : ''}
      </p>
      <div className="acct-kpis">
        <div className="acct-kpi">
          <span>매출세액 (세금계산서)</span>
          <b>{won(prep.outputTax)}</b>
          <em>
            {prep.sales.count}건 · 공급가액 {won(prep.sales.supply)}
          </em>
        </div>
        <div className="acct-kpi">
          <span>매입세액 (세금계산서)</span>
          <b>{won(prep.inputTax)}</b>
          <em>
            {prep.buys.count}건{prep.inputTaxNondeduct ? ` · 불공제 후보 ${won(prep.inputTaxNondeduct)} 뺌` : ''}
          </em>
        </div>
        <div className="acct-kpi">
          <span>카드 · 현금영수증 공제 후보</span>
          <b>{won(prep.byClass['공제 후보'].vat)}</b>
          <em>
            {prep.byClass['공제 후보'].count}건 · 추정 (10/110)
          </em>
        </div>
        <div className={`acct-kpi${prep.expected < 0 ? ' key' : ''}`}>
          <span>예상 납부세액 (기대)</span>
          <b>{pay(prep.expected)}</b>
          <em>
            범위 {pay(prep.low)} ~ {pay(prep.high)}
          </em>
        </div>
      </div>

      <section className="acct-card" aria-label="세금계산서">
        <h3>세금계산서 (홈택스 목록 · 작성일자 기준)</h3>
        <div className="acct-scroll">
          <table className="acct-table">
            <thead>
              <tr>
                <th>구분</th>
                <th className="acct-num">매수</th>
                <th className="acct-num">공급가액</th>
                <th className="acct-num">세액</th>
                <th className="acct-num">수정 발행</th>
                <th className="acct-num">세액 0원</th>
              </tr>
            </thead>
            <tbody>
              {(['매출', '매입'] as const).map(d => {
                const x = d === '매출' ? prep.sales : prep.buys
                return (
                  <tr key={d}>
                    <td>{d}</td>
                    <td className="acct-num">{x.count}</td>
                    <td className="acct-num">{signed(x.supply)}</td>
                    <td className="acct-num">{signed(x.vat)}</td>
                    <td className="acct-num">{x.amended || '-'}</td>
                    <td className="acct-num">{x.zeroVat.length || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {prep.buys.nondeduct.length > 0 && (
          <p className="acct-sub">
            불공제 후보 매입 계산서: {prep.buys.nondeduct.map(x => `${x.inv.partner_name} ${x.inv.item ?? ''} ${won(x.inv.vat)}`).join(' · ')}
          </p>
        )}
      </section>

      <section className="acct-card" aria-label="카드 · 현금영수증 매입">
        <header>
          <h3>카드 · 현금영수증 매입 (장부)</h3>
          <span className="acct-sub">세금계산서와 짝지어진 줄은 뺐습니다 · 줄을 누르면 내역</span>
        </header>
        <div className="acct-scroll">
          <table className="acct-table">
            <thead>
              <tr>
                <th>구분</th>
                <th className="acct-num">건수</th>
                <th className="acct-num">금액 (부가세 포함)</th>
                <th className="acct-num">추정 세액</th>
                <th>뜻</th>
              </tr>
            </thead>
            <tbody>
              {PURCHASE_CLASSES.map(c => (
                <tr key={c} className={`acct-click${cls === c ? ' acct-open' : ''}`} onClick={() => setCls(cls === c ? null : c)}>
                  <td>
                    <span className={`acct-tag ${CLASS_TONE[c]}`}>{c}</span>
                  </td>
                  <td className="acct-num">{prep.byClass[c].count}</td>
                  <td className="acct-num">{signed(prep.byClass[c].gross)}</td>
                  <td className="acct-num">{signed(prep.byClass[c].vat)}</td>
                  <td className="acct-wrap acct-sub">
                    {c === '공제 후보' ? '일반 과세 사업자 매입으로 보고 공제 계산에 넣음' : c === '불공제 후보' ? '접대 · 비영업용 승용차 · 여객운송 — 공제하지 않음' : c === '부가세 없음' ? '해외 서비스 · 면세 · 세금 — 공제할 부가세 없음' : '분류가 애매함 — 기대 값에는 안 넣고 낮은 값에만'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cls && (
          <div className="acct-scroll">
            <table className="acct-table">
              <thead>
                <tr>
                  <th>이용일</th>
                  <th>가맹점</th>
                  <th>장부 분류</th>
                  <th className="acct-num">금액</th>
                  <th className="acct-num">추정 세액</th>
                  <th>사유</th>
                </tr>
              </thead>
              <tbody>
                {lines.slice(0, 150).map(p => (
                  <tr key={p.id}>
                    <td>{p.date.slice(5).replace('-', '.')}</td>
                    <td className="acct-wrap">{p.who}</td>
                    <td>{p.category}</td>
                    <td className="acct-num">{signed(p.gross)}</td>
                    <td className="acct-num">{signed(p.vat)}</td>
                    <td className="acct-wrap acct-sub">{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lines.length > 150 && <p className="acct-sub">나머지 {lines.length - 150}건은 엑셀에 모두 있습니다.</p>}
          </div>
        )}
      </section>

      {prep.uninvoiced.length > 0 && (
        <section className="acct-card" aria-label="계산서 없는 매출 입금">
          <header>
            <h3>세금계산서와 짝이 없는 매출 입금 {prep.uninvoiced.length}건</h3>
            <span className="acct-sub">발행했는데 짝을 못 찾은 것인지, 발행 안 한 매출인지 확인 (안 했으면 매출 누락 위험)</span>
          </header>
          <div className="acct-scroll">
            <table className="acct-table">
              <thead>
                <tr>
                  <th>입금일</th>
                  <th>보낸 곳</th>
                  <th className="acct-num">금액</th>
                  <th className="acct-num">부가세 포함이면 세액</th>
                </tr>
              </thead>
              <tbody>
                {prep.uninvoiced.slice(0, 40).map(u => (
                  <tr key={u.id}>
                    <td>{u.date}</td>
                    <td className="acct-wrap">{u.who}</td>
                    <td className="acct-num">{n(u.amount)}</td>
                    <td className="acct-num">{n(u.vat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="acct-card" aria-label="홈택스 합계표 대조">
        <h3>홈택스 합계표 대조</h3>
        {checks.length === 0 ? (
          <p className="acct-sub">이 기간과 겹치는 홈택스 세금계산서 합계표가 없습니다. 회계 자료 탭에 매출처별 · 매입처별 합계표 엑셀을 올리면 빠진 계산서를 찾아 줍니다.</p>
        ) : (
          checks.map(c => (
            <div key={`${c.direction}${c.from}`} className="acct-row">
              <span className={`acct-tag ${c.hometaxTotal === c.mineTotal ? 'ok' : 'warn'}`}>{c.direction}</span>
              <span>
                {c.from.slice(2).replaceAll('-', '.')}~{c.to.slice(2).replaceAll('-', '.')} · 홈택스 {c.hometaxCount}매 {won(c.hometaxTotal)} · 인트라넷 {c.mineCount}매 {won(c.mineTotal)}
              </span>
              {c.diffs.length > 0 && (
                <span className="acct-sub">
                  차이 거래처 {c.diffs.length}곳 (큰 순: {c.diffs.slice(0, 3).map(d => `${d.name} ${won(d.ht - d.it)}`).join(' · ')})
                </span>
              )}
            </div>
          ))
        )}
      </section>

      <section className="acct-card" aria-label="세무대리인 확인 질문">
        <h3>세무대리인 확인 질문</h3>
        <ol className="acct-q">
          {prep.questions.map(q => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </section>
      <section className="acct-card" aria-label="가정">
        <h3>계산에 쓴 가정</h3>
        <div className="acct-scroll">
          <table className="acct-table">
            <thead>
              <tr>
                <th>항목</th>
                <th>가정</th>
                <th>틀리면</th>
              </tr>
            </thead>
            <tbody>
              {prep.assumptions.map(a => (
                <tr key={a.item}>
                  <td>{a.item}</td>
                  <td className="acct-wrap">{a.assumption}</td>
                  <td className="acct-wrap acct-sub">{a.effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- 자금 계획
const readSkip = (key: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function CashView({ data, company }: { data: AcctData; company: CompanyKey }) {
  const skipKey = `wkly-acct-skip-${company}`
  const [skip, setSkip] = useState<Set<string>>(() => readSkip(skipKey))
  const filing = data.settings.find(s => s.company === company)?.vat_filing ?? '예정신고'
  // 다음 부가세: 세무 일정의 가장 가까운 부가세 기한 → 그 과세기간 예상 세액
  const vat = useMemo(() => {
    const e = data.events.find(x => x.kind === 'vat' && x.company === company && !x.done && x.due_date >= data.today)
    const m = e?.task_key.match(/^vat:(\d{4})-Q([1-4])$/)
    if (!e || !m) return null
    const p = vatPeriod(Number(m[1]), Number(m[2]) as 1 | 2 | 3 | 4, filing)
    if (p.filing === '예정고지 납부') return null
    const prep = vatPrep({ company, period: p, invoices: data.invoices, ledger: data.ledger, today: data.today, filing })
    return { date: e.due_date, expected: Math.max(0, prep.expected), high: Math.max(0, prep.high), label: `${e.title} (${p.label})` }
  }, [data, company, filing])
  const plan = useMemo(() => cashPlan({ today: data.today, ledger: data.ledger, payments: data.payments, recurring: data.recurring, vat, skipAccounts: skip }), [data, vat, skip])
  const toggle = (acc: string) => {
    const next = new Set(skip)
    if (next.has(acc)) next.delete(acc)
    else next.add(acc)
    setSkip(next)
    try {
      localStorage.setItem(skipKey, JSON.stringify([...next]))
    } catch {
      /* 기억 못 해도 계산은 바뀜 */
    }
  }
  const oldest = plan.accounts.filter(a => !a.excluded).map(a => a.date).sort()[0]
  return (
    <div className="acct">
      <div className="acct-kpis">
        <div className="acct-kpi">
          <span>시작 잔액 (통장)</span>
          <b>{won(plan.opening)}</b>
          <em>{plan.accounts.filter(a => !a.excluded).length}개 통장 · 가장 오래된 기준일 {oldest ?? '—'}</em>
        </div>
        {plan.buckets.map(b => (
          <div key={b.label} className={`acct-kpi${b.endLow < 0 ? ' warn' : ''}`}>
            <span>{b.label} 뒤 (기대)</span>
            <b className={b.endExp < 0 ? 'acct-neg' : ''}>{won(b.endExp)}</b>
            <em>
              늦으면 {won(b.endLow)} · 제때면 {won(b.endHigh)}
            </em>
          </div>
        ))}
      </div>
      {company === 'TW' && <p className="acct-note warn">정기 출금 표에는 회사 구분이 없어 아트리어 것으로 봅니다 — 더위클리 자금 계획에는 넣지 않았습니다.</p>}
      {plan.risks.length > 0 && (
        <section className="acct-card" aria-label="위험">
          <h3>위험 (금액 큰 순)</h3>
          <ol className="acct-q">
            {plan.risks.map(r => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </section>
      )}
      <section className="acct-card" aria-label="구간별">
        <h3>30 · 60 · 90일</h3>
        <div className="acct-scroll">
          <table className="acct-table">
            <thead>
              <tr>
                <th>구간</th>
                <th className="acct-num">받을 돈 (늦으면)</th>
                <th className="acct-num">받을 돈 (기대)</th>
                <th className="acct-num">받을 돈 (제때)</th>
                <th className="acct-num">낼 돈</th>
                <th className="acct-num">남는 돈 (늦으면)</th>
                <th className="acct-num">남는 돈 (기대)</th>
              </tr>
            </thead>
            <tbody>
              {plan.buckets.map(b => (
                <tr key={b.label}>
                  <td>~{b.to.slice(5).replace('-', '.')} ({b.label})</td>
                  <td className="acct-num">{n(b.inLow)}</td>
                  <td className="acct-num">{n(b.inExp)}</td>
                  <td className="acct-num">{n(b.inHigh)}</td>
                  <td className="acct-num">{n(b.outLow > b.out ? b.outLow : b.out)}</td>
                  <td className={`acct-num${b.endLow < 0 ? ' acct-neg' : ''}`}>{signed(b.endLow)}</td>
                  <td className={`acct-num${b.endExp < 0 ? ' acct-neg' : ''}`}>{signed(b.endExp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="acct-card" aria-label="통장">
        <header>
          <h3>시작 잔액 통장</h3>
          <span className="acct-sub">은행 거래내역의 잔액 칸 · 체크를 빼면 계산에서 뺍니다</span>
        </header>
        {plan.accounts.length === 0 ? (
          <p className="acct-sub">잔액 칸이 있는 은행 거래내역이 없습니다 — 회계 자료 탭에 은행 거래내역 엑셀을 올려 주세요. 기초 잔액 없이 순증감만 봅니다.</p>
        ) : (
          <table className="acct-table">
            <thead>
              <tr>
                <th>넣기</th>
                <th>통장</th>
                <th className="acct-num">잔액</th>
                <th>기준일</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {plan.accounts.map(a => (
                <tr key={a.account}>
                  <td>
                    <input type="checkbox" checked={!a.excluded} disabled={a.excluded && !skip.has(a.account)} onChange={() => toggle(a.account)} aria-label={`${a.account} 계산에 넣기`} />
                  </td>
                  <td className="acct-wrap">{a.account}</td>
                  <td className="acct-num">{n(a.balance)}</td>
                  <td>{a.date}</td>
                  <td className="acct-wrap">{a.reason ? <span className={`acct-tag ${a.stale || a.excluded ? 'warn' : ''}`}>{a.reason}</span> : <span className="acct-tag ok">최신</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="acct-card" aria-label="들고 나는 돈">
        <header>
          <h3>들어오고 나갈 돈 (90일)</h3>
          <span className="acct-sub">결제 대장 · 정기 출금 · 부가세 예상 · 기대 날짜 순</span>
        </header>
        {plan.flows.length === 0 ? (
          <p className="acct-sub">결제 대장에 예정 · 청구 · 대기 결제가 없고 정기 출금도 없습니다.</p>
        ) : (
          <div className="acct-scroll">
            <table className="acct-table">
              <thead>
                <tr>
                  <th>날짜 (기대)</th>
                  <th>구분</th>
                  <th>내용</th>
                  <th>거래처</th>
                  <th className="acct-num">금액</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {plan.flows.slice(0, 80).map((f, i) => (
                  <tr key={`${f.label}${i}`}>
                    <td>{f.exp ? f.exp.slice(5).replace('-', '.') : '90일 밖'}</td>
                    <td>
                      <span className={`acct-tag ${f.kind === '받을 돈' ? 'ok' : ''}`}>{f.kind}</span>
                    </td>
                    <td className="acct-wrap">
                      {f.label} <span className="acct-sub">· {f.source}</span>
                    </td>
                    <td className="acct-wrap">{f.who}</td>
                    <td className={`acct-num${f.kind === '낼 돈' ? ' acct-neg' : ''}`}>{f.kind === '낼 돈' ? `−${n(f.amount)}` : n(f.amount)}</td>
                    <td className="acct-wrap acct-sub">{f.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {plan.undated.length > 0 && (
          <p className="acct-sub">
            날짜 없는 받을 돈 {plan.undated.length}건 ({plan.undated.map(f => `${f.who || f.label} ${won(f.amount)}`).join(' · ')}) — 결제 대장에 예정일을 넣으면 계획에 들어갑니다.
          </p>
        )}
      </section>
      <p className="acct-sub">
        받을 돈은 결제 대장의 예정일에 그 거래처의 지난 평균 입금 지연을 더했습니다 (늦으면 = 최소 30일 늦게 · 예정일이 지난 것은 빼고, 제때면 = 예정일 그대로). 낼 돈은 결제 대장 대기 · 예정 · 정기 출금(카드로 나가는 구독은 카드대금에 들어 있어 뺌) · 다음 부가세 예상입니다. 날짜 없는 돈은 지어내지 않고 따로 보여 줍니다.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- 월마감 점검
function MonthNav({ month, setMonth, min, max }: { month: string; setMonth: (m: string) => void; min: string; max: string }) {
  return (
    <div className="acct-row">
      <button type="button" className="icon-btn" disabled={month <= min} onClick={() => setMonth(addMonths(month, -1))} aria-label="지난달">
        <ChevronLeft size={16} />
      </button>
      <b className="t-title">
        {month.slice(0, 4)}년 {Number(month.slice(5))}월
      </b>
      <button type="button" className="icon-btn" disabled={month >= max} onClick={() => setMonth(addMonths(month, 1))} aria-label="다음 달">
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

const RowsTable = ({ rows }: { rows: LedgerEntry[] }) => (
  <div className="acct-scroll">
    <table className="acct-table">
      <thead>
        <tr>
          <th>날짜</th>
          <th>분류</th>
          <th>거래처</th>
          <th>수단 · 통장</th>
          <th className="acct-num">금액</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 60).map(r => (
          <tr key={r.id}>
            <td>{r.entry_date.slice(5).replace('-', '.')}</td>
            <td>{r.category}</td>
            <td className="acct-wrap">{r.counterparty ?? ''}</td>
            <td>
              {r.method}
              {r.account ? ` · ${r.account}` : ''}
            </td>
            <td className={`acct-num${r.direction === '출금' ? ' acct-neg' : ''}`}>{r.direction === '출금' ? `−${n(r.amount)}` : n(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {rows.length > 60 && <p className="acct-sub">나머지 {rows.length - 60}건은 월 장부 탭에서 보세요.</p>}
  </div>
)

function CloseView({ data, company, onClosed }: { data: AcctData; company: CompanyKey; onClosed: () => Promise<void> }) {
  const { api, toast } = useApp()
  const thisMonth = data.today.slice(0, 7)
  const min = `${Number(thisMonth.slice(0, 4)) - 1}-08`
  const [month, setMonth] = useState(addMonths(thisMonth, -1))
  const [busy, setBusy] = useState(false)
  const invoices = useMemo(() => data.invoices.filter(i => companyOfInvoice(i) === company), [data.invoices, company])
  const close = data.closes.find(c => c.company === company && c.month === month) ?? null
  const r = useMemo(() => closeReport({ month, ledger: data.ledger, invoices, openingCount: data.openingCount, close }), [month, data.ledger, invoices, data.openingCount, close])
  const passed = r.checks.filter(c => c.ok).length
  const save = async (closed: boolean) => {
    if (closed && !r.ready && !(await ask(`확인할 것이 ${r.checks.filter(c => !c.ok && c.key !== 'opening').length}가지 남아 있습니다. 그래도 ${Number(month.slice(5))}월을 마감할까요? (지금 숫자를 남겨 두고, 마감 뒤 바뀐 줄을 찾아 줍니다)`))) return
    setBusy(true)
    try {
      await api.saveMonthClose({ company, month, closed, snapshot: r.snapshot })
      await onClosed()
      toast(closed ? `${Number(month.slice(5))}월을 마감했습니다.` : '마감을 풀었습니다.')
    } catch (x) {
      toast(x instanceof Error ? x.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="acct">
      <div className="acct-row">
        <MonthNav month={month} setMonth={setMonth} min={min} max={thisMonth} />
        {close?.closed ? <span className="acct-tag ok">마감함 {close.closed_at?.slice(0, 10)}</span> : close?.reopened_at ? <span className="acct-tag mid">마감 풀림 {close.reopened_at.slice(0, 10)}</span> : <span className="acct-tag">마감 전</span>}
        <span className="acct-grow" />
        {close?.closed ? (
          <Button kind="outline" size="sm" disabled={busy} onClick={() => void save(false)}>
            마감 풀기
          </Button>
        ) : (
          <Button size="sm" disabled={busy || month === thisMonth} onClick={() => void save(true)} title={month === thisMonth ? '달이 끝난 뒤 마감합니다' : ''}>
            이 달 마감
          </Button>
        )}
      </div>
      <div className="acct-kpis">
        <div className="acct-kpi">
          <span>장부 줄</span>
          <b>{n(r.rows)}건</b>
          <em>이체 · 카드대금은 합계에서 뺌</em>
        </div>
        <div className="acct-kpi">
          <span>입금</span>
          <b>{won(r.inflow)}</b>
          <em>{close?.snapshot?.inflow != null && close.snapshot.inflow !== r.inflow ? `마감 때 ${won(close.snapshot.inflow)}` : ' '}</em>
        </div>
        <div className="acct-kpi">
          <span>출금</span>
          <b>{won(r.outflow)}</b>
          <em>{close?.snapshot?.outflow != null && close.snapshot.outflow !== r.outflow ? `마감 때 ${won(close.snapshot.outflow)}` : ' '}</em>
        </div>
        <div className={`acct-kpi ${r.ready ? 'key' : 'warn'}`}>
          <span>점검</span>
          <b>
            {passed} / {r.checks.length}
          </b>
          <em>{r.ready ? '마감해도 됩니다' : '확인할 것이 남음'}</em>
        </div>
      </div>
      {close?.closed && r.changedAfterClose.length > 0 && (
        <section className="acct-check-card bad" aria-label="마감 뒤 바뀐 줄">
          <header>
            <b>마감 뒤 바뀌거나 들어온 줄 {r.changedAfterClose.length}건</b>
          </header>
          <p>마감한 달의 숫자가 바뀌었습니다. 맞으면 마감을 풀고 다시 마감하세요.</p>
          <RowsTable rows={r.changedAfterClose} />
        </section>
      )}
      <div className="acct-checks">
        {r.checks.map(c => (
          <section key={c.key} className={`acct-check-card${c.ok ? '' : ' bad'}`} aria-label={c.title}>
            <header>
              <span className={`acct-tag ${c.ok ? 'ok' : 'warn'}`}>{c.ok ? '통과' : '확인'}</span>
              <b>{c.title}</b>
              <span className="acct-sub">{c.summary}</span>
            </header>
            <p>{c.detail}</p>
            {c.key === 'chain' && r.chains.length > 0 && (
              <div className="acct-row">
                {r.chains.map(ch => (
                  <span key={ch.account} className={`acct-tag ${ch.breaks.length ? 'warn' : 'ok'}`}>
                    {ch.account} {ch.rows}줄 {ch.breaks.length ? `· 끊김 ${ch.breaks.map(b => `${b.date.slice(5).replace('-', '.')} ${signed(b.diff)}원`).join(' · ')}` : '· 이어짐'}
                  </span>
                ))}
              </div>
            )}
            {!c.ok && c.rows.length > 0 && (
              <details>
                <summary>해당 줄 {c.rows.length}건 보기</summary>
                <RowsTable rows={c.rows} />
              </details>
            )}
          </section>
        ))}
        <section className={`acct-check-card${r.advance.net ? ' bad' : ''}`} aria-label="대표 가지급 · 가수">
          <header>
            <span className={`acct-tag ${r.advance.net ? 'warn' : 'ok'}`}>{r.advance.net ? '확인' : '통과'}</span>
            <b>대표 가지급 · 가수 ({month.slice(0, 4)}년 누계)</b>
            <span className="acct-sub">
              나간 돈 {won(r.advance.out)} · 들어온 돈 {won(r.advance.in)} · {r.advance.net >= 0 ? `가지급금 ${won(r.advance.net)}` : `가수금 ${won(-r.advance.net)}`}
            </span>
          </header>
          <p>가지급금이 남으면 인정이자 · 상여 처분 위험이 있습니다 (처리 방법은 세무대리인과). 연초 잔액이 있으면 그것까지 더해 봐야 합니다.</p>
        </section>
      </div>
      <p className="acct-sub">
        마감 순서: 통장 · 카드 · 계산서 자료 올리기 → 확인 필요 · 분류 정리 → 통장 잔액 이어짐 → 증빙 · 미수 · 미지급 확인 → 분개 · 시산표 검토 → 대표 확인 → 마감. 마감하면 그때 숫자를 남기고, 그 뒤 바뀐 줄을 여기서 알려 줍니다 (장부를 막지는 않음). 차이를 잡이익 · 잡손실로 맞추지 않습니다.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- 분개 · 시산표
function JournalView({ data, company }: { data: AcctData; company: CompanyKey }) {
  const { toast } = useApp()
  const thisMonth = data.today.slice(0, 7)
  const [month, setMonth] = useState(addMonths(thisMonth, -1))
  const [onlyReview, setOnlyReview] = useState(false)
  const [limit, setLimit] = useState(60)
  const { from, to } = monthRange(month)
  const entries = useMemo(() => buildJournal({ from, to, ledger: data.ledger, invoices: data.invoices, company }), [from, to, data.ledger, data.invoices, company])
  const tb = useMemo(() => trialBalance(entries), [entries])
  const review = entries.filter(e => e.review)
  const shown = onlyReview ? review : entries
  const download = async () => {
    try {
      await downloadWorkbook(`분개초안_${COMPANIES[company].label}_${month}.xlsx`, journalSheets(entries, tb, COMPANIES[company].full, `${month}`, data.today))
      toast('분개장 · 시산표를 내려받았습니다.')
    } catch {
      toast('엑셀을 만들지 못했습니다.')
    }
  }
  if (!data.ledger.length && !data.invoices.length) return <Empty>장부 자료가 없습니다.</Empty>
  return (
    <div className="acct">
      <div className="acct-row">
        <MonthNav month={month} setMonth={setMonth} min={`${Number(thisMonth.slice(0, 4)) - 1}-07`} max={thisMonth} />
        <span className="acct-grow" />
        <Button size="sm" onClick={() => void download()} disabled={!entries.length}>
          <Download size={14} /> 분개장 · 시산표 (엑셀)
        </Button>
      </div>
      <div className="acct-kpis">
        <div className="acct-kpi">
          <span>분개 (전표)</span>
          <b>{n(entries.length)}건</b>
          <em>계산서 {entries.filter(e => e.source.startsWith('계산서')).length} · 장부 {entries.filter(e => e.source.startsWith('장부')).length}</em>
        </div>
        <div className={`acct-kpi ${tb.debit === tb.credit ? 'key' : 'warn'}`}>
          <span>차변 = 대변</span>
          <b>{tb.debit === tb.credit ? '일치' : `차이 ${n(tb.debit - tb.credit)}`}</b>
          <em>합계 {won(tb.debit)}</em>
        </div>
        <div className={`acct-kpi${review.length ? ' warn' : ''}`}>
          <span>계정 확인 필요</span>
          <b>{review.length}건</b>
          <em>분류 미정 · 4대보험 나눔 · 계산서 없는 매출 등</em>
        </div>
        <div className="acct-kpi">
          <span>관리용 손익 (발생 기준 근사)</span>
          <b className={tb.revenue - tb.expense < 0 ? 'acct-neg' : ''}>{signed(tb.revenue - tb.expense)}원</b>
          <em>
            수익 {won(tb.revenue)} − 비용 {won(tb.expense)}
          </em>
        </div>
      </div>
      {tb.transferLeft !== 0 && <p className="acct-note warn">내 통장끼리 이체가 한쪽만 있습니다 ({signed(tb.transferLeft)}원) — 받는 통장 거래내역이 빠졌거나 분류가 다릅니다.</p>}
      <section className="acct-card" aria-label="시산표">
        <header>
          <h3>시산표</h3>
          <span className="acct-sub">{month} 발생액 · 기초 잔액 미반영 · 계정 코드는 세무대리인이 맞춤</span>
        </header>
        <div className="acct-scroll">
          <table className="acct-table">
            <thead>
              <tr>
                <th>구분</th>
                <th>계정과목</th>
                <th className="acct-num">차변</th>
                <th className="acct-num">대변</th>
                <th className="acct-num">잔액 (차변 − 대변)</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map(row => (
                <tr key={row.account}>
                  <td className="acct-sub">{row.group}</td>
                  <td className="acct-wrap">{row.account}</td>
                  <td className="acct-num">{row.debit ? n(row.debit) : '-'}</td>
                  <td className="acct-num">{row.credit ? n(row.credit) : '-'}</td>
                  <td className="acct-num">{signed(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>합계</td>
                <td className="acct-num">{n(tb.debit)}</td>
                <td className="acct-num">{n(tb.credit)}</td>
                <td className="acct-num">{signed(tb.debit - tb.credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <section className="acct-card" aria-label="분개장">
        <header>
          <h3>분개장 (초안)</h3>
          <label className="acct-row">
            <input type="checkbox" checked={onlyReview} onChange={e => setOnlyReview(e.target.checked)} /> 확인 필요만
          </label>
        </header>
        <div className="acct-scroll">
          <table className="acct-table">
            <thead>
              <tr>
                <th>전표</th>
                <th>계정과목</th>
                <th className="acct-num">차변</th>
                <th className="acct-num">대변</th>
                <th>거래처 · 적요</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).flatMap(e =>
                e.lines.map((l, i) => (
                  <tr key={`${e.no}-${i}`}>
                    <td className="acct-sub">{i === 0 ? `${e.no}` : ''}</td>
                    <td className="acct-wrap">{l.account}</td>
                    <td className="acct-num">{l.debit ? n(l.debit) : ''}</td>
                    <td className="acct-num">{l.credit ? n(l.credit) : ''}</td>
                    <td className="acct-wrap">
                      {i === 0 && (
                        <>
                          {e.who} <span className="acct-sub">· {e.memo} · {e.source}</span>
                          {e.review && (
                            <>
                              {' '}
                              <span className="acct-tag mid">{e.review}</span>
                            </>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        {shown.length > limit && (
          <Button kind="ghost" size="sm" onClick={() => setLimit(l => l + 120)}>
            {shown.length - limit}건 더 보기
          </Button>
        )}
      </section>
      <p className="acct-sub">
        세금계산서는 작성일에 외상매출금 · 외상매입금으로, 통장 · 카드 줄은 장부 분류를 계정과목으로 옮긴 초안입니다. 카드 사용은 미지급금(카드), 카드대금은 그 미지급금을 갚는 것으로 봅니다. 회계 프로그램에 옮기기 전 세무대리인 검토 · 대표 승인(장부 반영)이 필요합니다.
      </p>
    </div>
  )
}
