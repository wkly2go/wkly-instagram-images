import { useMemo, useState } from 'react'
import { TextLinks } from './ui'
import { useAction, useApp } from '../lib/app'
import { manwon, nextMonday, shortDate, todayKey, weekday } from '../lib/date'
import { maskAccount, sameName } from '../lib/finance'
import { CONTRACT_TYPES, LABOR_TYPES, PAYMENT_STAGES, PAYMENT_STATUSES, type BudgetLine, type Client, type ContractType, type Payment, type Project } from '../lib/types'
import { Button, Field, Modal } from './ui'
import { ask } from './Ask'

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
  lockProject = false,
  onClose,
}: {
  payment: Payment | null
  preset?: Partial<Payment>
  projects: Project[]
  clients: Client[]
  /** 업체·공사 구분 자동완성과 지난 계좌 찾기용 */
  payments: Payment[]
  lines?: BudgetLine[]
  /** 현장 화면에서 열었을 때: 현장 고정 · 업체 · 공사 구분도 그 현장 것만 (대표 지시 2026-10-31) */
  lockProject?: boolean
  onClose: () => void
}) {
  const { api, me } = useApp()
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

  // 현장을 고르면 그 현장의 공사 구분 · 업체만 (없으면 전체)
  const pid = f.project_id ?? null
  const scoped = useMemo(() => (pid ? payments.filter(p => p.project_id === pid) : payments), [payments, pid])
  const scopedLines = useMemo(() => (pid ? lines.filter(l => l.project_id === pid) : lines), [lines, pid])
  const categories = useMemo(() => [...new Set([...scopedLines.map(l => l.category), ...scoped.map(p => p.category).filter((c): c is string => !!c)])].sort((a, b) => a.localeCompare(b, 'ko')), [scopedLines, scoped])
  const projectClient = pid ? projects.find(p => p.id === pid)?.client_id ?? null : null
  const payees = useMemo(
    () =>
      [...new Set([...(pid ? clients.filter(c => c.id === projectClient || scoped.some(p => p.client_id === c.id)) : clients).map(c => c.name), ...scoped.map(p => p.payee).filter((c): c is string => !!c)])].sort((a, b) =>
        a.localeCompare(b, 'ko'),
      ),
    [clients, scoped, pid, projectClient],
  )
  const projectOf = projects.find(p => p.id === pid)
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
    const c = clients.find(x => x.name === name.trim()) ?? clients.find(x => sameName(x.name, name))
    set({ payee: name || null, client_id: c ? c.id : f.client_id && clients.find(x => x.id === f.client_id)?.name !== name ? null : f.client_id })
  }
  const autoDue = isPay && !f.due_date && f.requested_date ? nextMonday(f.requested_date) : null

  const submit = async () => {
    const title = (f.title ?? '').trim() || [f.payee?.trim() || f.category, f.stage].filter(Boolean).join(' ') || ''
    if (!title) return
    const ok = await run(() => api.savePayment({ ...f, title, amount: f.amount ?? 0, vat: f.vat ?? 0 }), payment ? '저장했습니다.' : '결제 대장에 추가했습니다.')
    if (ok) onClose()
  }
  const remove = async () => {
    if (payment && (await ask('이 결제 내역을 삭제할까요?')) && (await run(() => api.deletePayment(payment.id), '삭제했습니다.'))) onClose()
  }

  return (
    <Modal
      wide
      title={payment ? '결제 수정' : '결제 추가'}
      onClose={onClose}
      actions={
        <>
          {payment && me.role === 'admin' && (
            <Button kind="ghost" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>
              삭제
            </Button>
          )}
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy || !((f.title ?? '').trim() || f.category || f.payee?.trim())}>
            저장
          </Button>
        </>
      }
    >
      {/* 사용성 개선 (대표 지시 2026-10-31 "사용성이 너무 떨어져"):
          누구 · 얼마 → 단계 · 상태 · 날짜 → 증빙 → 계좌 순서, 자주 안 쓰는 칸은 '더 보기'로 접음 · 고르는 칸은 버튼으로 */}
      <div className="pf">
        <div className="pf-top">
          <div className="seg" role="group" aria-label="구분">
            {(['지급', '수금'] as const).map(d => (
              <button key={d} type="button" className={f.direction === d ? 'on' : ''} onClick={() => set({ direction: d, ...(d === '수금' ? { advance_by: null } : {}) })}>
                {d === '지급' ? '지급 · 줄 돈' : '수금 · 받을 돈'}
              </button>
            ))}
          </div>
          <label className="row t-cap" style={{ gap: 4 }}>
            <input type="checkbox" checked={!!f.is_estimate} onChange={e => set({ is_estimate: e.target.checked })} /> 예상 비용
          </label>
        </div>

        <section className="pf-sec">
          <div className="pf-grid">
            <Field label={isPay ? '누구에게 (업체 · 성명)' : '누구에게서 (입금하는 곳)'}>
              <input className="input" autoFocus={!payment} list="pay-payees" value={f.payee ?? ''} onChange={e => setPayee(e.target.value)} placeholder="거래처 이름" />
              <datalist id="pay-payees">
                {payees.map(c => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <span className="money-hint">{f.client_id ? `거래처 연결됨 · ${clients.find(c => c.id === f.client_id)?.name ?? ''}` : f.payee ? '거래처 목록에 없는 이름' : ' '}</span>
            </Field>
            {lockProject && projectOf ? (
              <div className="col gap-4">
                <span className="pf-label">프로젝트 (현장)</span>
                <b className="pf-fixed">{[projectOf.code, projectOf.name].filter(Boolean).join(' ')}</b>
              </div>
            ) : (
            <Field label="프로젝트 (현장)">
              <select className="select" value={f.project_id ?? ''} onChange={e => set({ project_id: e.target.value || null, budget_line_id: null })}>
                <option value="">없음</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {[p.code, p.name].filter(Boolean).join(' ')}
                  </option>
                ))}
              </select>
            </Field>
            )}
            <Field label="금액 (VAT 포함 실제 금액 · 환불은 −)" className="full">
              <input className="input pf-amount" inputMode="numeric" value={amountText} onChange={e => setAmount(e.target.value)} onBlur={() => setAmountText(fmt(f.amount) || (f.amount === 0 ? '' : amountText))} placeholder="0" />
            </Field>
            <div className="full pf-row">
              <div className="seg sm" role="group" aria-label="부가세">
                {[true, false].map(v => (
                  <button
                    key={String(v)}
                    type="button"
                    className={vatIncluded === v ? 'on' : ''}
                    onClick={() => {
                      setVatIncluded(v)
                      set({ vat: v ? Math.round((f.amount ?? 0) / 11) : 0 })
                    }}
                  >
                    {v ? '부가세 10% 포함' : '부가세 없음'}
                  </button>
                ))}
              </div>
              <span className="money-hint">{f.amount ? `${manwon(f.amount)} = 공급가 ${manwon((f.amount ?? 0) - (f.vat ?? 0))} + 부가세 ${manwon(f.vat ?? 0) || '0'}` : ' '}</span>
            </div>
          </div>
        </section>

        <section className="pf-sec">
          <div className="pf-grid">
            <div className="full col gap-4">
              <span className="pf-label">단계</span>
              <div className="pf-row">
                <div className="seg sm" role="group" aria-label="단계">
                  {['계약금', '중도금', '잔금', '일시불'].map(st => (
                    <button key={st} type="button" className={(f.stage ?? '').startsWith(st) ? 'on' : ''} onClick={() => set({ stage: (f.stage ?? '').startsWith(st) ? null : st })}>
                      {st}
                    </button>
                  ))}
                </div>
                <input className="input pf-stage" list="pay-stages" value={f.stage ?? ''} onChange={e => set({ stage: e.target.value || null })} placeholder="직접 (예: 중도금 2차)" aria-label="단계 직접 입력" />
                <datalist id="pay-stages">
                  {PAYMENT_STAGES.map(c => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="full col gap-4">
              <span className="pf-label">상태</span>
              <div className="seg sm" role="group" aria-label="상태">
                {PAYMENT_STATUSES.filter(st => (isPay ? st !== '청구' : st !== '대기') || st === f.status).map(st => (
                  <button key={st} type="button" className={f.status === st ? 'on' : ''} onClick={() => set({ status: st, ...(st === '완료' && !f.paid_date ? { paid_date: todayKey() } : {}) })}>
                    {st === '대기' ? '지급 대기' : st === '청구' ? '청구함' : st}
                  </button>
                ))}
              </div>
            </div>
            {f.status === '완료' ? (
              <Field label={isPay ? '지급한 날' : '입금된 날'}>
                <input className="input" type="date" value={f.paid_date ?? ''} onChange={e => set({ paid_date: e.target.value || null })} />
              </Field>
            ) : (
              <Field label={isPay ? '지급 예정일' : '입금 예정일'}>
                <input className="input" type="date" value={f.due_date ?? ''} onChange={e => set({ due_date: e.target.value || null })} />
                <span className="money-hint">{autoDue ? `비우면 차주 월요일 ${shortDate(autoDue)} (${weekday(autoDue)})` : ' '}</span>
              </Field>
            )}
            <Field label="증빙">
              <select className="select" value={f.contract_type ?? ''} onChange={e => setType((e.target.value || null) as ContractType | null)}>
                <option value="">모름</option>
                {CONTRACT_TYPES.map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            {f.tax_invoice !== '해당 없음' && (
              <div className="full pf-row">
                <span className="pf-label">세금계산서</span>
                <div className="seg sm" role="group" aria-label="세금계산서">
                  {(['미발행', '발행'] as const).map(st => (
                    <button key={st} type="button" className={f.tax_invoice === st ? 'on' : ''} onClick={() => set({ tax_invoice: st, ...(st === '발행' && !f.tax_invoice_date ? { tax_invoice_date: todayKey() } : {}) })}>
                      {st}
                    </button>
                  ))}
                </div>
                {f.tax_invoice === '발행' && <input className="input pf-date" type="date" value={f.tax_invoice_date ?? ''} onChange={e => set({ tax_invoice_date: e.target.value || null })} aria-label="발행일" />}
              </div>
            )}
          </div>
        </section>

        {isPay && (
          <section className="pf-sec">
            <div className="row">
              <span className="pf-label grow">입금 계좌</span>
              {lastAccount && (
                <Button kind="outline" size="sm" onClick={() => set({ bank_name: lastAccount.bank_name, account_no: lastAccount.account_no, account_holder: lastAccount.account_holder })}>
                  지난 계좌 사용 ({lastAccount.bank_name} {maskAccount(lastAccount.account_no)})
                </Button>
              )}
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <input className="input" style={{ width: 110 }} placeholder="은행" value={f.bank_name ?? ''} onChange={e => set({ bank_name: e.target.value || null })} aria-label="은행" />
              <input className="input grow" placeholder="계좌번호" value={f.account_no ?? ''} onChange={e => set({ account_no: e.target.value || null })} aria-label="계좌번호" autoComplete="off" />
              <input className="input" style={{ width: 130 }} placeholder="예금주" value={f.account_holder ?? ''} onChange={e => set({ account_holder: e.target.value || null })} aria-label="예금주" />
            </div>
            {f.account_holder && f.payee && !sameName(f.account_holder, f.payee) && !f.account_holder.includes(f.payee) && !f.payee.includes(f.account_holder) && (
              <span className="t-cap t-red">업체명·성명과 예금주가 다릅니다. 노무비라면 세무 신고 대상자를 확인하세요.</span>
            )}
          </section>
        )}

        <details className="pf-more" open={!!(f.memo || f.advance_by)}>
          <summary>더 보기 · 항목 · 공사 구분 · 요청일 · 거래처 · 부가세 직접 · 비고</summary>
          <div className="pf-grid">
            <Field label="항목 (세부내용 · 비우면 거래처 + 단계)" className="full">
              <input className="input" value={f.title ?? ''} onChange={e => set({ title: e.target.value })} placeholder="예) 제작가구 발주" />
            </Field>
            {isPay && (
              <Field label="공사 구분">
                <input className="input" list="pay-categories" value={f.category ?? ''} onChange={e => set({ category: e.target.value || null, budget_line_id: null })} placeholder="목공 · 전기 · 운영비 · 노무비 …" />
                <datalist id="pay-categories">
                  {categories.map(c => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
            )}
            <Field label="결제요청일">
              <input className="input" type="date" value={f.requested_date ?? ''} onChange={e => set({ requested_date: e.target.value || null })} />
            </Field>
            {f.status === '완료' && (
              <Field label={isPay ? '지급 예정일 (있었다면)' : '입금 예정일 (있었다면)'}>
                <input className="input" type="date" value={f.due_date ?? ''} onChange={e => set({ due_date: e.target.value || null })} />
              </Field>
            )}
            <Field label="거래처 연결 (자동 · 직접 고르기)">
              <select className="select" value={f.client_id ?? ''} onChange={e => set({ client_id: e.target.value || null })}>
                <option value="">연결 안 함</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="부가세 직접 입력">
              <input
                className="input"
                inputMode="numeric"
                value={fmt(f.vat)}
                onChange={e => {
                  setVatIncluded(false)
                  set({ vat: parseMoney(e.target.value) })
                }}
                placeholder="0"
              />
            </Field>
            {isPay && (
              <Field label="대지급자 (현장소장 등이 먼저 결제)">
                <input className="input" value={f.advance_by ?? ''} onChange={e => set({ advance_by: e.target.value.trim() ? e.target.value : null })} placeholder="비우면 회사가 직접 지급" />
              </Field>
            )}
            <Field label="비고" className="full">
              <textarea className="textarea" rows={2} value={f.memo ?? ''} onChange={e => set({ memo: e.target.value || null })} />
              <TextLinks text={f.memo} />
            </Field>
          </div>
        </details>
      </div>
    </Modal>
  )
}
