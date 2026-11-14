import { useEffect, useId, useRef, useState } from 'react'
import { todayKey } from '../lib/date'
import type { SalesDraft } from '../lib/sales'
import { SALES_PLAN_LIMITS, assessSalesPlan, formatSalesPlan, readSalesPlan, validateSalesPlan, writeSalesPlan, type SalesPlanFields } from '../lib/salesPlan'
import { Badge, Button, Field } from './ui'
import './SalesPlanSheet.css'

interface SalesPlanSheetProps {
  draft: SalesDraft
  onChange: (patch: Partial<SalesDraft>) => void
  disabled: boolean
  ownerName?: string
}

type SalesPlanOutputProps = Pick<SalesPlanSheetProps, 'draft' | 'ownerName'>

const scopes = ['공간 섭외', '팝업 기획', '설계·시공', '현장 운영', '콘텐츠·홍보']

/** Use text nodes for all draft values, including URLs and copied source material. */
function printPlan(text: string): boolean {
  const tab = window.open('', '_blank', 'width=820,height=900')
  if (!tab) return false
  tab.opener = null
  const doc = tab.document
  doc.title = '영업 실행 계획'
  doc.documentElement.lang = 'ko'
  const stylesheet = doc.createElement('style')
  stylesheet.textContent = `
    @page { size: A4; margin: 14mm; }
    body { color: #161616; font: 13px/1.55 system-ui, sans-serif; max-width: 180mm; margin: 18px auto; }
    pre { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
    @media print { body { margin: 0; } button { display: none; } }
  `
  doc.head.append(stylesheet)
  const print = doc.createElement('button')
  print.type = 'button'
  print.textContent = '인쇄·PDF 저장'
  print.addEventListener('click', () => tab.print())
  const documentBody = doc.createElement('pre')
  documentBody.textContent = text
  doc.body.replaceChildren(print, documentBody)
  tab.focus()
  tab.print()
  return true
}

export function SalesPlanSheet({ draft, onChange, disabled, ownerName }: SalesPlanSheetProps) {
  const headingId = useId()
  const { notes, plan } = readSalesPlan(draft.description)
  const publicBid = draft.source === '나라장터'
  const scopeValues = plan.scope.split(' / ').filter(Boolean)

  function update(patch: Partial<SalesPlanFields>) {
    if (disabled) return
    onChange({ description: writeSalesPlan(notes, { ...plan, ...patch }) })
  }

  return <section className="sales-plan-sheet" aria-labelledby={headingId}>
    <h3 className="t-sub" id={headingId}>수주 검토와 실행 계획</h3>
    <div className="sales-plan-columns">
      <fieldset className="sales-plan-fields" disabled={disabled} aria-label="수주 검토 입력">
        <Field className="full" label="브랜드·발주기관">
          <input className="input" value={plan.target} maxLength={SALES_PLAN_LIMITS.target} placeholder="성수 팝업을 준비 중인 브랜드" onChange={event => update({ target: event.target.value })} />
        </Field>
        <Field className="full" label={publicBid ? '수행 범위' : '미발주 대행 범위'}>
          <input className="input" value={plan.scope} maxLength={SALES_PLAN_LIMITS.scope} placeholder="공간 설계·제작과 현장 운영" onChange={event => update({ scope: event.target.value })} />
        </Field>
        <div className="full row wrap sales-plan-scopes" role="group" aria-label="대행 범위 빠른 선택">
          {scopes.map(scope => {
            const selected = scopeValues.includes(scope)
            const next = (selected ? scopeValues.filter(value => value !== scope) : [...scopeValues, scope]).join(' / ')
            return <Button key={scope} size="sm" kind="outline" aria-pressed={selected} disabled={next.length > SALES_PLAN_LIMITS.scope} onClick={() => update({ scope: next })}>{scope}</Button>
          })}
        </div>
        <Field label="오픈·행사 예정일">
          <input className="input" type="date" value={plan.targetDate} onChange={event => update({ targetDate: event.target.value })} />
        </Field>
        <Field label={publicBid ? '가장 이른 제출 마감일' : '대행사 선정 예정일'}>
          <input className="input" type="date" value={plan.decisionDate} onChange={event => update({ decisionDate: event.target.value })} />
        </Field>
        <Field label={publicBid ? '참가 자격' : '대행 발주 상태'}>
          {publicBid
            ? <select className="select" value={plan.eligibility} onChange={event => update({ eligibility: event.target.value as SalesPlanFields['eligibility'] })}>
              {(['미확인', '충족', '불충족'] as const).map(value => <option key={value}>{value}</option>)}
            </select>
            : <select className="select" value={plan.commitment} onChange={event => update({ commitment: event.target.value as SalesPlanFields['commitment'] })}>
              {(['미확인', '미발주', '일부 미발주', '발주 완료'] as const).map(value => <option key={value}>{value}</option>)}
            </select>}
        </Field>
        <Field label="예산 근거">
          <input className="input" value={plan.budget} maxLength={SALES_PLAN_LIMITS.budget} placeholder="공개 배정예산 4,000만 원" onChange={event => update({ budget: event.target.value })} />
        </Field>
        <Field className="full" label="문의처·결정권자">
          <input className="input" value={plan.contact} maxLength={SALES_PLAN_LIMITS.contact} placeholder="공식 제휴 문의 창구 또는 담당 부서" onChange={event => update({ contact: event.target.value })} />
        </Field>
        <Field className="full" label="영업 계기·고객 요구">
          <textarea className="textarea" rows={2} value={plan.demand} maxLength={SALES_PLAN_LIMITS.demand} placeholder="신제품 공개 일정과 체험 공간 운영 요청" onChange={event => update({ demand: event.target.value })} />
        </Field>
        <Field className="full" label="확인 근거">
          <textarea className="textarea" rows={2} value={plan.evidence} maxLength={SALES_PLAN_LIMITS.evidence} placeholder="무엇을 언제 어디서 확인했는지 적어 주세요." onChange={event => update({ evidence: event.target.value })} />
        </Field>
      </fieldset>
      <SalesPlanReview draft={draft} ownerName={ownerName} disabled={disabled} onChange={onChange} />
    </div>
  </section>
}

export function SalesPlanOutput({ draft, ownerName }: SalesPlanOutputProps) {
  const headingId = useId()
  return <section className="sales-plan-sheet" aria-labelledby={headingId}>
    <h3 className="t-sub" id={headingId}>실행 계획</h3>
    <SalesPlanReview draft={draft} ownerName={ownerName} previewOpen />
  </section>
}

function SalesPlanReview({ draft, ownerName, onChange, disabled, previewOpen }: SalesPlanOutputProps & { onChange?: SalesPlanSheetProps['onChange']; disabled?: boolean; previewOpen?: boolean }) {
  const [message, setMessage] = useState('')
  const [copyFallback, setCopyFallback] = useState(false)
  const [showPreview, setShowPreview] = useState(Boolean(previewOpen))
  const previewInput = useRef<HTMLTextAreaElement | null>(null)
  const { plan } = readSalesPlan(draft.description)
  const today = todayKey()
  const error = validateSalesPlan(plan)
  const assessment = assessSalesPlan(draft, plan, today)
  const report = formatSalesPlan(draft, plan, today, ownerName)
  const applies = draft.next_action !== assessment.nextAction || (assessment.nextDate !== null && draft.next_date !== assessment.nextDate)
  const badge = assessment.status === '검토 우선' ? 'green' : assessment.status === '보류' ? 'gray' : 'yellow'
  const reasons = assessment.reasons.filter(reason => reason !== error)

  useEffect(() => {
    if (copyFallback && showPreview) {
      previewInput.current?.focus()
      previewInput.current?.select()
    }
  }, [copyFallback, showPreview])

  async function copy() {
    try {
      await navigator.clipboard.writeText(report)
      setCopyFallback(false)
      setMessage('실행 계획을 복사했습니다.')
    } catch {
      setShowPreview(true)
      setCopyFallback(true)
      setMessage('선택한 계획을 복사하세요.')
    }
  }

  function printReport() {
    try {
      if (printPlan(report)) return
    } catch { /* The preview remains available when printing is unavailable. */ }
    setShowPreview(true)
    setCopyFallback(true)
    setMessage('인쇄를 시작하지 못했습니다. 선택한 계획을 복사하거나 브라우저의 팝업 설정을 확인해 주세요.')
  }

  return <div className="sales-plan-review">
    <div className="row wrap">
      <strong>자동 검토</strong>
      <Badge tone={badge}><span role="status">{assessment.status}</span></Badge>
    </div>
    {error && <p className="sales-error" role="alert">{error}</p>}
    {reasons.length > 0 && <ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    {assessment.nextAction && <div className="sales-plan-next">
      <h4>권장 다음 행동</h4>
      <p>{assessment.nextAction}</p>
      {assessment.nextDate && <p className="t-small">권장일 <time dateTime={assessment.nextDate}>{assessment.nextDate}</time></p>}
      {onChange && <Button kind="outline" size="sm" disabled={disabled || Boolean(error) || !applies} onClick={() => {
        onChange({ next_action: assessment.nextAction, ...(assessment.nextDate && { next_date: assessment.nextDate }) })
        setMessage(assessment.nextDate ? '다음 행동과 연락일에 반영했습니다.' : '다음 행동에 반영했습니다.')
      }}>{assessment.nextDate ? '권장 행동·연락일 적용' : '권장 행동 적용'}</Button>}
    </div>}
    <details className="sales-plan-preview" open={showPreview} onToggle={event => {
      setShowPreview(event.currentTarget.open)
      if (!event.currentTarget.open) setCopyFallback(false)
    }}>
      <summary>실행 계획 미리보기</summary>
      <textarea ref={previewInput} className="textarea" rows={8} aria-label="영업 실행 계획" readOnly value={report} />
    </details>
    <div className="row wrap">
      <Button kind="outline" size="sm" onClick={() => void copy()}>계획 복사</Button>
      <Button kind="outline" size="sm" onClick={printReport}>인쇄·PDF 저장</Button>
    </div>
    {message && <p className="t-small" role="status">{message}</p>}
  </div>
}
