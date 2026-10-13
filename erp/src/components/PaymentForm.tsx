import { useMemo, useState } from 'react'
import { useAction, useApp } from '../lib/app'
import { manwon, nextMonday, shortDate, todayKey, weekday } from '../lib/date'
import { maskAccount, sameName } from '../lib/finance'
import { CONTRACT_TYPES, LABOR_TYPES, PAYMENT_STAGES, PAYMENT_STATUSES, TAX_INVOICE_STATES, type BudgetLine, type Client, type ContractType, type Payment, type Project } from '../lib/types'
import { Button, Chip, Field, Modal } from './ui'

/** '1,200,000' · '-500000' → 숫자 */
export function parseMoney(s: string): number {
  const n = Number(s.replace(/[^\d-]/g, '').replace(/(?!^)-/g, ''))
  return isFinite(n) ? n : 0
}
const fmt = (n: number | null | undefined) => (n ? n.toLocaleString('ko-KR') : '')

/** 결제 대장 한 줄 입력·수정 (엑셀 결제 대장과 같은 항목) */
export function PaymentForm({
  payment,
  preset,
  projects,
  clients,
  payments,
  lines = [],
  onClose,
}: {
  payment: Payment | null
  preset?: Partial<Payment>
  projects: Project[]
  clients: Client[]
  /** 업체·공사 구분 자동완성과 지난 계좌 찾기용 */
  payments: Payment[]
  lines?: BudgetLine[]
  onClose: () => void
}) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<Partial<Payment>>(
    () =>
      payment ?? {
        direction: '지급',
        status: '예정',
        tax_invoice: '미발행',
        contract_type: '세금계산서',
        requested_date: todayKey(),
        amount: 0,
        vat: 0,
        is_estimate: false,
        ...preset,
      },
  )
  const [amountText, setAmountText] = useState(fmt(f.amount))
  const [vatIncluded, setVatIncluded] = useState(!!payment?.vat || (!payment && f.contract_type === '세금계산서'))
  const set = (p: Partial<Payment>) => setF(prev => ({ ...prev, ...p }))
  const isPay = f.direction === '지급'

  const categories = useMemo(() => [...new Set([...lines.map(l => l.category), ...payments.map(p => p.category).filter((c): c is string => !!c)])].sort((a, b) => a.localeCompare(b, 'ko')), [lines, payments])
  const payees = useMemo(() => [...new Set([...clients.map(c => c.name), ...payments.map(p => p.payee).filter((c): c is string => !!c)])].sort((a, b) => a.localeCompare(b, 'ko')), [clients, payments])
  /** 같은 업체에 예전에 보낸 계좌 */
  const lastAccount = useMemo(() => {
    if (!f.payee || f.account_no) return null
    return [...payments].reverse().find(p => p.id !== f.id && p.account_no && sameName(p.payee, f.payee)) ?? null
  }, [payments, f.payee, f.account_no, f.id])

  const setAmount = (text: string) => {
    setAmountText(text)
    const amount = parseMoney(text)
    set({ amount, vat: vatIncluded ? Math.round(amount / 11) : 0 })
  }
  const setType = (t: ContractType | null) => {
    const noInvoice = t === '카드' || t === '현금영수증' || (t != null && LABOR_TYPES.includes(t))
    const taxed = t === '세금계산서'
    setVatIncluded(taxed)
    set({ contract_type: t, tax_invoice: noInvoice ? '해당 없음' : f.tax_invoice === '해당 없음' ? '미발행' : f.tax_invoice, vat: taxed ? Math.round((f.amount ?? 0) / 11) : 0 })
  }
  const setPayee = (name: string) => {
    const c = clients.find(x => x.name === name.trim())
    set({ payee: name || null, client_id: c ? c.id : f.client_id && clients.find(x => x.id === f.client_id)?.name !== name ? null : f.client_id })
  }
  const autoDue = isPay && !f.due_date && f.requested_date ? nextMonday(f.requested_date) : null

  const submit = async () => {
    const title = (f.title ?? '').trim() || [f.category, f.stage].filter(Boolean).join(' ') || ''
    if (!title) return
    const ok = await run(() => api.savePayment({ ...f, title, amount: f.amount ?? 0, vat: f.vat ?? 0 }), payment ? '저장했습니다.' : '결제 대장에 추가했습니다.')
    if (ok) onClose()
  }
  const remove = async () => {
    if (payment && window.confirm('이 결제 내역을 삭제할까요?') && (await run(() => api.deletePayment(payment.id), '삭제했습니다.'))) onClose()
  }

  return (
    <Modal
      wide
      title={payment ? '결제 수정' : '결제 추가'}
      onClose={onClose}
      actions={
        <>
          {payment && (
            <Button kind="ghost" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>
              삭제
            </Button>
          )}
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy || !((f.title ?? '').trim() || f.category)}>
            저장
          </Button>
        </>
      }
    >
      <div className="chips" role="group" aria-label="구분">
        {(['지급', '수금'] as const).map(d => (
          <Chip key={d} active={f.direction === d} onClick={() => set({ direction: d, ...(d === '수금' ? { advance_by: null } : {}) })}>
            {d === '지급' ? '지급 (줄 돈)' : '수금 (받을 돈)'}
          </Chip>
        ))}
        <label className="row t-cap" style={{ gap: 4, marginLeft: 'auto' }}>
          <input type="checkbox" checked={!!f.is_estimate} onChange={e => set({ is_estimate: e.target.checked })} /> 예상 비용 (아직 결제 아님)
        </label>
      </div>
      <div className="form-grid">
        <Field label="프로젝트 (현장)">
          <select className="select" value={f.project_id ?? ''} onChange={e => set({ project_id: e.target.value || null, budget_line_id: null })}>
            <option value="">없음</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="공사 구분">
          <input className="input" list="pay-categories" value={f.category ?? ''} onChange={e => set({ category: e.target.value || null, budget_line_id: null })} placeholder="목공 · 전기 · 운영비 · 노무비 …" title="바꾸면 연결된 예산 줄 대신 새 공사 구분으로 예산을 셉니다" />
          <datalist id="pay-categories">
            {categories.map(c => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="항목 (세부내용)" className="full">
          <input className="input" autoFocus={!payment} value={f.title ?? ''} onChange={e => set({ title: e.target.value })} placeholder="예) 제작가구 발주 / 선수금 80%" />
        </Field>
        <Field label={isPay ? '업체명 · 성명' : '입금하는 곳'}>
          <input className="input" list="pay-payees" value={f.payee ?? ''} onChange={e => setPayee(e.target.value)} />
          <datalist id="pay-payees">
            {payees.map(c => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="거래처 연결">
          <select className="select" value={f.client_id ?? ''} onChange={e => set({ client_id: e.target.value || null })}>
            <option value="">연결 안 함</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="계약형태 (증빙)">
          <select className="select" value={f.contract_type ?? ''} onChange={e => setType((e.target.value || null) as ContractType | null)}>
            <option value="">모름</option>
            {CONTRACT_TYPES.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="단계">
          <input className="input" list="pay-stages" value={f.stage ?? ''} onChange={e => set({ stage: e.target.value || null })} placeholder="선금 · 중도금 · 잔금 …" />
          <datalist id="pay-stages">
            {PAYMENT_STAGES.map(c => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="금액 (원, 환불은 −)">
          <input className="input" inputMode="numeric" value={amountText} onChange={e => setAmount(e.target.value)} onBlur={() => setAmountText(fmt(f.amount) || (f.amount === 0 ? '' : amountText))} placeholder="0" />
          <span className="money-hint">{f.amount ? `${manwon(f.amount)} · 공급가 ${manwon((f.amount ?? 0) - (f.vat ?? 0))}` : ' '}</span>
        </Field>
        <Field label="부가세">
          <span className="row">
            <input className="input" style={{ width: 'auto', flex: 1 }} inputMode="numeric" value={fmt(f.vat)} disabled={vatIncluded} onChange={e => set({ vat: parseMoney(e.target.value) })} placeholder="0" />
            <label className="row t-cap" style={{ gap: 4, whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={vatIncluded}
                onChange={e => {
                  setVatIncluded(e.target.checked)
                  set({ vat: e.target.checked ? Math.round((f.amount ?? 0) / 11) : 0 })
                }}
              />
              10% 포함
            </label>
          </span>
        </Field>
        <Field label="상태">
          <select className="select" value={f.status} onChange={e => set({ status: e.target.value as Payment['status'] })}>
            {PAYMENT_STATUSES.filter(s => (isPay ? s !== '청구' : s !== '대기') || s === f.status).map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label={isPay ? '지급일' : '입금일'}>
          <input className="input" type="date" value={f.paid_date ?? ''} disabled={f.status !== '완료'} onChange={e => set({ paid_date: e.target.value || null })} title="상태가 완료일 때만 입력 (비우면 오늘)" />
        </Field>
        <Field label="결제요청일">
          <input className="input" type="date" value={f.requested_date ?? ''} onChange={e => set({ requested_date: e.target.value || null })} />
        </Field>
        <Field label={isPay ? '지급예정일' : '입금 예정일'}>
          <input className="input" type="date" value={f.due_date ?? ''} onChange={e => set({ due_date: e.target.value || null })} />
          <span className="money-hint">{autoDue ? `비우면 차주 월요일 ${shortDate(autoDue)} (${weekday(autoDue)})` : ' '}</span>
        </Field>
        <Field label="세금계산서">
          <select className="select" value={f.tax_invoice} onChange={e => set({ tax_invoice: e.target.value as Payment['tax_invoice'] })}>
            {TAX_INVOICE_STATES.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="발행일">
          <input className="input" type="date" value={f.tax_invoice_date ?? ''} disabled={f.tax_invoice !== '발행'} onChange={e => set({ tax_invoice_date: e.target.value || null })} />
        </Field>
        {isPay && (
          <Field label="대지급자 (현장소장 등이 먼저 결제한 경우)" className="full">
            <input className="input" value={f.advance_by ?? ''} onChange={e => set({ advance_by: e.target.value.trim() ? e.target.value : null })} placeholder="비워 두면 회사가 직접 지급" />
          </Field>
        )}
        {isPay && (
          <div className="full col gap-6">
            <div className="row">
              <span className="t-smallb">입금 계좌 (관리자만 보임)</span>
              {lastAccount && (
                <Button kind="outline" size="sm" onClick={() => set({ bank_name: lastAccount.bank_name, account_no: lastAccount.account_no, account_holder: lastAccount.account_holder })}>
                  지난 계좌 사용 ({lastAccount.bank_name} {maskAccount(lastAccount.account_no)})
                </Button>
              )}
            </div>
            <div className="row">
              <input className="input" style={{ width: 110 }} placeholder="은행" value={f.bank_name ?? ''} onChange={e => set({ bank_name: e.target.value || null })} aria-label="은행" />
              <input className="input grow" placeholder="계좌번호" value={f.account_no ?? ''} onChange={e => set({ account_no: e.target.value || null })} aria-label="계좌번호" autoComplete="off" />
              <input className="input" style={{ width: 130 }} placeholder="예금주" value={f.account_holder ?? ''} onChange={e => set({ account_holder: e.target.value || null })} aria-label="예금주" />
            </div>
            {f.account_holder && f.payee && !sameName(f.account_holder, f.payee) && !f.account_holder.includes(f.payee) && !f.payee.includes(f.account_holder) && (
              <span className="t-cap t-red">업체명·성명과 예금주가 다릅니다. 노무비라면 세무 신고 대상자를 확인하세요.</span>
            )}
          </div>
        )}
        <Field label="비고" className="full">
          <textarea className="textarea" rows={2} value={f.memo ?? ''} onChange={e => set({ memo: e.target.value || null })} />
        </Field>
      </div>
    </Modal>
  )
}
