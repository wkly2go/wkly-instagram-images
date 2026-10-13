import { useMemo, useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { manwon, shortDate } from '../lib/date'
import { parseSheet, type ImportPreview } from '../lib/paymentImport'
import { useRouter } from '../lib/router'
import type { Draft, Payment, Project, ProjectFinance } from '../lib/types'
import { readXlsx, type XlsxBook } from '../lib/xlsx'
import { Badge, Button, Empty, Field } from '../components/ui'

const FORMAT_LABEL: Record<ImportPreview['format'], string> = { register: '결제 대장', installments: '예산 + 분할 지급', labor: '노무비 대장', unknown: '형식 아님' }

/** 결제 대장 › 엑셀 가져오기 (파일은 브라우저 안에서만 읽음) */
export function PaymentImport({ projects, existing, onDone }: { projects: Project[]; existing: Payment[]; onDone: () => void }) {
  const { api, toast, version } = useApp()
  const { navigate } = useRouter()
  const { busy, run } = useAction()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [book, setBook] = useState<XlsxBook | null>(null)
  const [reading, setReading] = useState(false)
  const [sheet, setSheet] = useState<string | null>(null)
  const [target, setTarget] = useState<string>('new')
  const [newName, setNewName] = useState('')
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [saveContract, setSaveContract] = useState(true)
  // 회사 계약금액은 VAT 포함 → 공급가액(÷1.1)으로 저장, 수금은 VAT 10% 분리
  const [contractVat, setContractVat] = useState(true)
  // 세금계산서 발행으로 표시된 지급은 결제금액(VAT 포함)에서 VAT 10% 분리
  const [splitVat, setSplitVat] = useState(true)
  const { data: finances } = useAsync(() => api.listFinances(), [version], [] as ProjectFinance[])

  // 시트별 요약 (프로젝트 없이 한 번 읽어 봄)
  const summaries = useMemo(() => (book ? book.sheets.map(s => parseSheet(s, { projectId: null, existing })) : []), [book, existing])
  const projectId = target === 'new' ? null : target
  const preview = useMemo(() => {
    const s = book?.sheets.find(x => x.name === sheet)
    return s ? parseSheet(s, { projectId, existing }) : null
  }, [book, sheet, projectId, existing])

  const open = async (file: File) => {
    setReading(true)
    setBook(null)
    setSheet(null)
    try {
      const b = await readXlsx(await file.arrayBuffer())
      setBook(b)
      setFileName(file.name)
    } catch (e) {
      toast(`엑셀을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setReading(false)
    }
  }
  const pick = (name: string) => {
    const s = summaries.find(x => x.sheet === name)
    setSheet(name)
    setExcluded(new Set(s?.rows.map((r, i) => (r.suggestExclude ? i : -1)).filter(i => i >= 0)))
    const title = (s?.title ?? name).replace(/\s+/g, ' ').replace(/결제\s*대장|노무비\s*대장/g, '').trim()
    const match = projects.find(p => title && (p.name.includes(title.replace(/\s*현장$/, '')) || title.includes(p.name)))
    setTarget(match?.id ?? 'new')
    setNewName(title || name)
  }

  const chosen = preview ? preview.rows.filter((_, i) => !excluded.has(i)) : []
  const sum = chosen.reduce((n, r) => n + (r.payment.amount ?? 0), 0)
  const fin = projectId ? finances.find(f => f.project_id === projectId) : undefined
  const contract = preview?.contract
  const contractSupply = contract?.contract_amount == null ? null : contractVat ? Math.round(contract.contract_amount / 1.1) : contract.contract_amount
  const vat11 = (n: number) => Math.round(n / 11)
  const taxed = (p: Draft<Payment>) => p.direction === '지급' && p.tax_invoice === '발행' && !p.vat && (p.amount ?? 0) > 0
  const taxedCount = chosen.filter(r => taxed(r.payment)).length

  const doImport = async () => {
    if (!preview || !chosen.length) return
    let pid = projectId
    const ok = await run(async () => {
      if (!pid) pid = (await api.saveProject({ name: newName.trim() || preview.sheet, category: '기타', status: '진행', description: `엑셀 '${fileName}' › ${preview.sheet} 에서 가져옴` })).id
      const lineIds = new Map<number, string>()
      const lines = preview.budgetLines.map(b => {
        const id = crypto.randomUUID()
        if (b.sort_order != null) lineIds.set(b.sort_order, id)
        return { ...b, id, project_id: pid! }
      })
      const rows: Draft<Payment>[] = chosen.map(r => ({
        ...r.payment,
        vat: splitVat && taxed(r.payment) ? vat11(r.payment.amount ?? 0) : r.payment.vat ?? 0,
        project_id: pid,
        budget_line_id: preview.format === 'installments' ? lineIds.get(r.row) ?? null : r.payment.budget_line_id ?? null,
        memo: [r.payment.memo, `엑셀 ${preview.sheet} ${r.row}행`].filter(Boolean).join(' · '),
      }))
      if (contract && saveContract) {
        if (contractSupply != null) await api.saveFinance({ project_id: pid!, contract_amount: contractSupply })
        const recv = contract.received ?? 0
        const rest = contract.contract_amount != null ? contract.contract_amount - recv : 0
        const recvVat = (n: number) => (contractVat ? vat11(n) : 0)
        if (recv > 0) rows.push({ direction: '수금', project_id: pid, title: '수금 (엑셀 합계)', amount: recv, vat: recvVat(recv), status: '완료', tax_invoice: '발행', is_estimate: false, memo: `엑셀 ${preview.sheet} 계약 요약`, requested_date: null, paid_date: null })
        if (rest > 0) rows.push({ direction: '수금', project_id: pid, title: '잔금 (엑셀 기준)', stage: '잔금', amount: rest, vat: recvVat(rest), status: '예정', tax_invoice: '미발행', is_estimate: false, memo: `엑셀 ${preview.sheet} 계약 요약`, requested_date: null })
      }
      const res = await api.importPayments(rows, lines)
      toast(`결제 ${res.payments}건${res.budgetLines ? ` · 예산 ${res.budgetLines}줄` : ''}을 가져왔습니다.`)
    })
    if (ok) {
      onDone()
      navigate(`/projects?view=payments&project=${pid}`, { replace: true })
    }
  }

  return (
    <div className="col gap-10">
      <div className="note">
        지금 쓰는 결제 대장 엑셀(.xlsx)을 그대로 올리세요. 파일은 <b>이 브라우저 안에서만</b> 읽고, 저장되는 건 아래에서 체크한 줄뿐입니다. 열 이름으로 맞추기 때문에 시트마다 열 순서가 달라도 됩니다.
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e => e.target.files?.[0] && open(e.target.files[0]).finally(() => (e.target.value = ''))} />
      <button
        type="button"
        className="drop"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f) open(f)
        }}
        disabled={reading}
      >
        <FileSpreadsheet size={22} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        {reading ? '읽는 중…' : fileName ? `${fileName} · 다른 파일 고르기` : '엑셀 파일을 끌어 놓거나 눌러서 고르세요'}
      </button>

      {book && (
        <section className="section">
          <div className="section-h">
            <span className="t-bodyb">1. 시트 고르기</span>
            <span className="cap">{book.sheets.length}개 시트</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>시트</th>
                  <th>형식</th>
                  <th className="num">줄</th>
                  <th className="num">합계</th>
                  <th className="num">미결제</th>
                  <th>확인할 점</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map(s => (
                  <tr key={s.sheet} className={`click ${s.sheet === sheet ? 'sel' : ''} ${s.format === 'unknown' ? 'muted' : ''}`} onClick={() => s.format !== 'unknown' && pick(s.sheet)}>
                    <td className="strong nowrap">{s.sheet}</td>
                    <td className="nowrap">
                      <Badge tone={s.format === 'unknown' ? 'paper' : 'outline'}>{FORMAT_LABEL[s.format]}</Badge>
                    </td>
                    <td className="num">{s.rows.length || '–'}</td>
                    <td className="num">{s.totals.amount ? manwon(s.totals.amount) : '–'}</td>
                    <td className="num">{s.totals.open ? manwon(s.totals.open) : '–'}</td>
                    <td className="t-cap">{s.issues.filter(i => i.level === 'warn').length ? <span className="t-red">주의 {s.issues.filter(i => i.level === 'warn').length}건</span> : s.format === 'unknown' ? '결제 대장 형식이 아님' : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {preview && (
        <section className="section">
          <div className="section-h">
            <span className="t-bodyb">2. 현장(프로젝트) 정하기</span>
            <span className="cap">{preview.title ?? preview.sheet}</span>
          </div>
          <div className="row wrap">
            <select className="select" style={{ flex: '1 1 220px' }} value={target} onChange={e => setTarget(e.target.value)} aria-label="가져올 프로젝트">
              <option value="new">새 프로젝트 만들기</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {target === 'new' && (
              <Field label="새 프로젝트 이름" className="grow">
                <input className="input" value={newName} onChange={e => setNewName(e.target.value)} />
              </Field>
            )}
          </div>

          <div className="section-h" style={{ marginTop: 6 }}>
            <span className="t-bodyb">3. 미리보기</span>
            <span className="cap">
              {FORMAT_LABEL[preview.format]} · 선택 {chosen.length}/{preview.rows.length}줄 · {manwon(sum) || '0'}
            </span>
          </div>
          {preview.issues.length > 0 && (
            <div className="box col gap-2" style={{ background: 'var(--white)' }}>
              {preview.issues.map((i, k) => (
                <div key={k} className={`issue ${i.level}`}>
                  <span>{i.level === 'warn' ? '⚠️' : 'ℹ️'}</span>
                  <span>
                    {i.row ? `${i.row}행 · ` : ''}
                    {i.message}
                  </span>
                </div>
              ))}
              {preview.skipped.length > 0 && (
                <details className="t-cap">
                  <summary>건너뛴 줄 {preview.skipped.length}개</summary>
                  {preview.skipped.slice(0, 80).map(s => (
                    <div key={s.row}>
                      {s.row}행 · {s.reason}
                    </div>
                  ))}
                </details>
              )}
            </div>
          )}
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <div className="kpi">
              <span className="t-cap">가져올 금액</span>
              <span className="v">{manwon(sum) || '0'}</span>
              <span className="sub">{chosen.length}줄</span>
            </div>
            <div className="kpi">
              <span className="t-cap">지급 완료</span>
              <span className="v">{manwon(chosen.filter(r => r.payment.status === '완료' && !r.payment.is_estimate).reduce((n, r) => n + (r.payment.amount ?? 0), 0)) || '0'}</span>
              <span className="sub">대지급 {chosen.filter(r => r.payment.advance_by).length}줄 포함</span>
            </div>
            <div className="kpi">
              <span className="t-cap">미결제 (예정·대기)</span>
              <span className="v">{manwon(chosen.filter(r => r.payment.status !== '완료' && !r.payment.is_estimate).reduce((n, r) => n + (r.payment.amount ?? 0), 0)) || '0'}</span>
              <span className="sub">지급예정일이 비면 차주 월요일</span>
            </div>
            <div className="kpi">
              <span className="t-cap">예상 비용</span>
              <span className="v">{manwon(chosen.filter(r => r.payment.is_estimate).reduce((n, r) => n + (r.payment.amount ?? 0), 0)) || '0'}</span>
              <span className="sub">합계·마진에서 따로 표시</span>
            </div>
          </div>
          {preview.budgetLines.length > 0 && (
            <div className="note">
              실행 예산 {preview.budgetLines.length}줄 · 예산 합계 {manwon(preview.budgetLines.reduce((n, b) => n + (b.budget_amount ?? 0), 0))} · 업체 계약 합계 {manwon(preview.budgetLines.reduce((n, b) => n + (b.contract_amount ?? 0), 0))} 도 함께 저장합니다.
            </div>
          )}
          {contract && (contract.contract_amount != null || contract.received != null) && (
            <label className="note row" style={{ gap: 6 }}>
              <input type="checkbox" checked={saveContract} onChange={e => setSaveContract(e.target.checked)} />
              <span>
                계약 요약도 저장: 계약금액 {contract.contract_amount != null ? `${contract.contract_amount.toLocaleString('ko-KR')}원` : '–'}
                {contract.received != null && ` · 수금 ${contract.received.toLocaleString('ko-KR')}원 (완료)`}
                {contract.contract_amount != null && contract.received != null && contract.contract_amount > contract.received && ` · 잔금 ${(contract.contract_amount - contract.received).toLocaleString('ko-KR')}원 (예정)`}
                {fin?.contract_amount != null && fin.contract_amount !== contractSupply && <span className="t-red"> · 지금 입력된 계약액 {fin.contract_amount.toLocaleString('ko-KR')}원을 바꿉니다</span>}
              </span>
            </label>
          )}
          {contract && contract.contract_amount != null && saveContract && (
            <label className="note row" style={{ gap: 6 }}>
              <input type="checkbox" checked={contractVat} onChange={e => setContractVat(e.target.checked)} />
              <span>
                계약금액·수금은 VAT 포함 금액
                {contractVat && contractSupply != null && <span className="t-cap"> → 계약 공급가액 {contractSupply.toLocaleString('ko-KR')}원으로 저장 (마진은 공급가액 기준)</span>}
              </span>
            </label>
          )}
          {taxedCount > 0 && (
            <label className="note row" style={{ gap: 6 }}>
              <input type="checkbox" checked={splitVat} onChange={e => setSplitVat(e.target.checked)} />
              <span>
                세금계산서 발행으로 표시된 지급 {taxedCount}건은 결제금액에서 VAT 10%를 나눠 저장
                <span className="t-cap"> · 표시가 없는 건은 전액 비용으로 계산합니다. 나중에 결제 대장에서 'VAT 10%'를 체크하면 마진이 정확해집니다</span>
              </span>
            </label>
          )}
          {preview.rows.length === 0 ? (
            <Empty>가져올 줄이 없습니다.</Empty>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" aria-label="모두 선택" checked={excluded.size === 0} onChange={e => setExcluded(e.target.checked ? new Set() : new Set(preview.rows.map((_, i) => i)))} />
                    </th>
                    <th className="num">행</th>
                    <th>공사 구분</th>
                    <th>항목</th>
                    <th>업체·성명</th>
                    <th className="num">금액</th>
                    <th>상태</th>
                    <th className="num">날짜</th>
                    <th>표시</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => {
                    const p = r.payment
                    const on = !excluded.has(i)
                    return (
                      <tr key={`${r.row}-${i}`} className={on ? '' : 'muted'}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${r.row}행 가져오기`}
                            checked={on}
                            onChange={e => {
                              const next = new Set(excluded)
                              if (e.target.checked) next.delete(i)
                              else next.add(i)
                              setExcluded(next)
                            }}
                          />
                        </td>
                        <td className="num">{r.row}</td>
                        <td className="nowrap">{p.category ?? '–'}</td>
                        <td className="max">
                          <span className="strong truncate" style={{ display: 'block' }} title={p.title}>
                            {p.title}
                          </span>
                          {p.stage && <span className="t-cap">{p.stage}</span>}
                        </td>
                        <td className="nowrap">
                          <span style={{ display: 'block' }}>{p.payee ?? '–'}</span>
                          <span className="t-cap">{p.contract_type ?? ''}</span>
                        </td>
                        <td className={`num ${(p.amount ?? 0) < 0 ? 'red' : ''}`}>{(p.amount ?? 0).toLocaleString('ko-KR')}</td>
                        <td className="nowrap">{p.status}</td>
                        <td className="num">{p.paid_date ? shortDate(p.paid_date) : p.due_date ? `${shortDate(p.due_date)} 예정` : p.requested_date ? `${shortDate(p.requested_date)} 요청` : '–'}</td>
                        <td className="nowrap">
                          {r.duplicateOf && <Badge tone="red">이미 있음</Badge>}
                          {p.is_estimate && <Badge tone="paper">예상</Badge>}
                          {p.advance_by && <Badge tone="yellow">대지급</Badge>}
                          {(p.amount ?? 0) < 0 && <Badge>환불</Badge>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="row wrap">
            <span className="t-cap grow">가져온 줄의 비고에 '엑셀 시트명 행번호'가 남아 원본과 맞춰 볼 수 있습니다.</span>
            <Button onClick={doImport} disabled={busy || !chosen.length || (target === 'new' && !newName.trim())}>
              {chosen.length}줄 가져오기
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
