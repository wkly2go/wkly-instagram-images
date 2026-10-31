// 현장 결제 대장 · 한 줄 입력 (대표 지시 2026-10-31 "프로젝트의 업체 기입하는 것들은 한 줄로 변경해, 첨부한 구글 시트를 참조해")
//   구글 시트 '00.현장 결제 대장' 과 같은 순서: 결제요청일 · 공사구분 · 항목 · 업체명 · 단계 · 계약형태 · 은행 · 계좌 · 예금주
//   · 결제금액 · 부가세 · 공급가 · 상태 · 지급예정일 · 지급일 · 세금계산서 · 비고
//   - 노란 칸 = 입력 칸 (시트와 같음). 칸에서 나가면 바로 저장, 공급가는 자동
//   - 맨 아래 빈 줄에 적고 Enter(또는 [추가]) → 새 결제. 업체명을 적으면 예전 계좌 · 계약형태 · 공사구분을 채움
//   - 계약형태가 세금계산서면 결제금액의 1/11 을 부가세로 자동
import { useMemo, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { useAction, useApp } from '../lib/app'
import { todayKey } from '../lib/date'
import { isOverdue, supply } from '../lib/finance'
import { CONTRACT_TYPES, PAYMENT_STATUSES, TAX_INVOICE_STATES, type Payment } from '../lib/types'
import { Button } from './ui'

const order = (p: Payment) => p.requested_date ?? p.due_date ?? p.paid_date ?? p.created_at.slice(0, 10)
const money = (n: number | null | undefined) => (n ? n.toLocaleString('ko-KR') : '')
const parseMoney = (s: string) => {
  const neg = /^\s*-/.test(s)
  const n = Number(s.replace(/[^\d]/g, '')) || 0
  return neg ? -n : n
}
const autoVat = (amount: number, type: Payment['contract_type']) => (type === '세금계산서' ? Math.round(amount / 11) : 0)

type Patch = Partial<Payment>

/** 같은 업체의 가장 최근 결제에서 계좌 · 계약형태 · 공사구분 */
const remember = (all: Payment[], payee: string): Patch => {
  const name = payee.trim()
  if (!name) return {}
  const prev = [...all].filter(p => p.payee?.trim() === name).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const acc = prev.find(p => p.account_no)
  const out: Patch = {}
  if (acc) Object.assign(out, { bank_name: acc.bank_name, account_no: acc.account_no, account_holder: acc.account_holder })
  if (prev[0]) Object.assign(out, { contract_type: prev[0].contract_type, category: prev[0].category, client_id: prev[0].client_id })
  return out
}

export function PaySheet({ rows, all, projectId, sel, setSel, onOpen }: { rows: Payment[]; all: Payment[]; projectId: string; sel: Set<string>; setSel: (s: Set<string>) => void; onOpen: (p: Payment) => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const list = useMemo(() => [...rows].sort((a, b) => order(a).localeCompare(order(b)) || a.created_at.localeCompare(b.created_at)), [rows])
  const categories = useMemo(() => [...new Set(all.map(p => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'ko')), [all])
  const payees = useMemo(() => [...new Set(all.map(p => p.payee?.trim()).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'ko')), [all])

  const save = (p: Payment, patch: Patch) => {
    const changed = Object.entries(patch).some(([k, v]) => (p as unknown as Record<string, unknown>)[k] !== v)
    if (changed) void run(() => api.savePayment({ id: p.id, ...patch }))
  }

  const blank = (): Patch => ({ direction: '지급', requested_date: today, status: '예정', tax_invoice: '미발행', amount: 0, vat: 0 })
  const [draft, setDraft] = useState<Patch>(blank)
  const setD = (patch: Patch) => setDraft(d => ({ ...d, ...patch }))
  const add = async () => {
    const title = draft.title?.trim() || draft.payee?.trim() || ''
    if (!title || !draft.amount) return
    const ok = await run(
      () =>
        api.savePayment({
          ...draft,
          project_id: projectId,
          title,
          payee: draft.payee?.trim() || null,
          tax_invoice: draft.contract_type && draft.contract_type !== '세금계산서' && draft.contract_type !== '계산서' ? '해당 없음' : draft.tax_invoice ?? '미발행',
        }),
      '한 줄 추가했습니다.',
    )
    if (ok) setDraft(blank())
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(e.target as HTMLElement).blur()
      void add()
    }
  }

  const allIds = list.map(p => p.id)
  const sum = (f: (p: Payment) => number) => list.filter(p => p.status !== '취소' && !p.is_estimate).reduce((n, p) => n + f(p), 0)

  return (
    <div className="table-wrap pay-sheet-wrap">
      <datalist id="ps-cat">
        {categories.map(c => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="ps-payee">
        {payees.map(c => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <table className="pay-sheet">
        <thead>
          <tr>
            <th className="ck">
              <input type="checkbox" aria-label="모두 선택" checked={sel.size > 0 && allIds.every(id => sel.has(id))} onChange={e => setSel(e.target.checked ? new Set(allIds) : new Set())} />
            </th>
            <th>결제요청일</th>
            <th>구분</th>
            <th>공사구분</th>
            <th>항목</th>
            <th>업체명</th>
            <th>단계</th>
            <th>계약형태</th>
            <th>은행</th>
            <th>계좌번호</th>
            <th>예금주</th>
            <th className="num">결제금액</th>
            <th className="num">부가세</th>
            <th className="num">공급가</th>
            <th>상태</th>
            <th>지급예정일</th>
            <th>지급일</th>
            <th>세금계산서</th>
            <th>비고</th>
            <th className="ck" />
          </tr>
        </thead>
        <tbody>
          {list.map(p => (
            <Row key={`${p.id}:${p.updated_at}`} p={p} late={isOverdue(p, today)} checked={sel.has(p.id)} onCheck={on => {
              const n = new Set(sel)
              if (on) n.add(p.id)
              else n.delete(p.id)
              setSel(n)
            }} save={patch => save(p, patch)} remember={name => remember(all, name)} onOpen={() => onOpen(p)} />
          ))}
          {/* 새 줄 */}
          <tr className="ps-new">
            <td className="ck">
              <Plus size={12} aria-hidden />
            </td>
            <td><input className="ps-in" type="date" value={draft.requested_date ?? ''} onChange={e => setD({ requested_date: e.target.value || null })} aria-label="결제요청일" /></td>
            <td>
              <select className="ps-in" value={draft.direction} onChange={e => setD({ direction: e.target.value as Payment['direction'] })} aria-label="구분">
                <option>지급</option>
                <option>수금</option>
              </select>
            </td>
            <td><input className="ps-in" list="ps-cat" value={draft.category ?? ''} onChange={e => setD({ category: e.target.value || null })} onKeyDown={onKey} placeholder="공사구분" aria-label="공사구분" /></td>
            <td><input className="ps-in w-l" value={draft.title ?? ''} onChange={e => setD({ title: e.target.value })} onKeyDown={onKey} placeholder="항목 (세부 내용)" aria-label="항목" /></td>
            <td>
              <input
                className="ps-in"
                list="ps-payee"
                value={draft.payee ?? ''}
                onChange={e => setD({ payee: e.target.value })}
                onBlur={e => {
                  const r = remember(all, e.target.value)
                  setDraft(d => {
                    const n: Patch = { ...r, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null && v !== '')), payee: e.target.value }
                    return { ...n, vat: d.vat || autoVat(n.amount ?? 0, n.contract_type ?? null) }
                  })
                }}
                onKeyDown={onKey}
                placeholder="업체명 · 성명"
                aria-label="업체명"
              />
            </td>
            <td><input className="ps-in w-s" value={draft.stage ?? ''} onChange={e => setD({ stage: e.target.value || null })} onKeyDown={onKey} placeholder="계약금…" aria-label="단계" /></td>
            <td>
              <select className="ps-in" value={draft.contract_type ?? ''} onChange={e => {
                const t = (e.target.value || null) as Payment['contract_type']
                setD({ contract_type: t, vat: autoVat(draft.amount ?? 0, t) })
              }} aria-label="계약형태">
                <option value="">–</option>
                {CONTRACT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </td>
            <td><input className="ps-in w-s" value={draft.bank_name ?? ''} onChange={e => setD({ bank_name: e.target.value || null })} onKeyDown={onKey} aria-label="은행" /></td>
            <td><input className="ps-in" value={draft.account_no ?? ''} onChange={e => setD({ account_no: e.target.value || null })} onKeyDown={onKey} aria-label="계좌번호" /></td>
            <td><input className="ps-in w-s" value={draft.account_holder ?? ''} onChange={e => setD({ account_holder: e.target.value || null })} onKeyDown={onKey} aria-label="예금주" /></td>
            <td><input className="ps-in num" inputMode="numeric" value={money(draft.amount)} onChange={e => {
              const amount = parseMoney(e.target.value)
              setD({ amount, vat: autoVat(amount, draft.contract_type ?? null) })
            }} onKeyDown={onKey} placeholder="0" aria-label="결제금액" /></td>
            <td><input className="ps-in num w-m" inputMode="numeric" value={money(draft.vat)} onChange={e => setD({ vat: parseMoney(e.target.value) })} onKeyDown={onKey} aria-label="부가세" /></td>
            <td className="num ps-calc">{money((draft.amount ?? 0) - (draft.vat ?? 0))}</td>
            <td>
              <select className="ps-in" value={draft.status} onChange={e => setD({ status: e.target.value as Payment['status'] })} aria-label="상태">
                {PAYMENT_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </td>
            <td><input className="ps-in" type="date" value={draft.due_date ?? ''} onChange={e => setD({ due_date: e.target.value || null })} aria-label="지급예정일" title="비워 두면 차주 월요일" /></td>
            <td><input className="ps-in" type="date" value={draft.paid_date ?? ''} onChange={e => setD({ paid_date: e.target.value || null })} aria-label="지급일" /></td>
            <td>
              <select className="ps-in" value={draft.tax_invoice} onChange={e => setD({ tax_invoice: e.target.value as Payment['tax_invoice'] })} aria-label="세금계산서">
                {TAX_INVOICE_STATES.map(s => <option key={s}>{s}</option>)}
              </select>
            </td>
            <td><input className="ps-in w-l" value={draft.memo ?? ''} onChange={e => setD({ memo: e.target.value || null })} onKeyDown={onKey} aria-label="비고" /></td>
            <td className="ck">
              <Button size="sm" disabled={busy || !(draft.title?.trim() || draft.payee?.trim()) || !draft.amount} onClick={() => void add()}>
                추가
              </Button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={11} className="t-cap">
              {list.length}건 · 노란 칸에 바로 적으면 저장됩니다 · 맨 아래 줄에 적고 Enter = 새 결제 (취소 · 예상 비용은 합계 제외)
            </td>
            <td className="num">{money(sum(p => p.amount))}</td>
            <td className="num">{money(sum(p => p.vat))}</td>
            <td className="num">{money(sum(supply))}</td>
            <td colSpan={6} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Row({ p, late, checked, onCheck, save, remember, onOpen }: { p: Payment; late: boolean; checked: boolean; onCheck: (on: boolean) => void; save: (patch: Patch) => void; remember: (payee: string) => Patch; onOpen: () => void }) {
  const text = (k: keyof Payment, cls = '', label = '', extra?: Record<string, unknown>) => (
    <input
      className={`ps-in ${cls}`}
      defaultValue={(p[k] as string | null) ?? ''}
      onBlur={e => {
        const v = e.target.value.trim()
        if (k === 'title' && !v) return void (e.target.value = p.title)
        save({ [k]: v || null } as Patch)
      }}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label={label}
      {...extra}
    />
  )
  const date = (k: 'requested_date' | 'due_date' | 'paid_date', label: string) => (
    <input className="ps-in" type="date" defaultValue={p[k] ?? ''} onBlur={e => save({ [k]: e.target.value || null } as Patch)} aria-label={label} />
  )
  return (
    <tr className={`${checked ? 'sel' : ''} ${p.status === '취소' || p.is_estimate ? 'muted' : ''} ${p.status === '완료' ? 'done' : ''}`}>
      <td className="ck">
        <input type="checkbox" aria-label={`${p.title} 선택`} checked={checked} onChange={e => onCheck(e.target.checked)} />
      </td>
      <td>{date('requested_date', '결제요청일')}</td>
      <td>
        <select className="ps-in" defaultValue={p.direction} onChange={e => save({ direction: e.target.value as Payment['direction'] })} aria-label="구분">
          <option>지급</option>
          <option>수금</option>
        </select>
      </td>
      <td>{text('category', '', '공사구분', { list: 'ps-cat' })}</td>
      <td>{text('title', 'w-l', '항목')}</td>
      <td>
        <input
          className="ps-in"
          list="ps-payee"
          defaultValue={p.payee ?? ''}
          onBlur={e => {
            const v = e.target.value.trim()
            if (v === (p.payee ?? '')) return
            // 업체를 바꾸면 그 업체의 계좌가 비어 있을 때만 예전 계좌로 채움
            const r = remember(v)
            save({ payee: v || null, ...(p.account_no ? {} : { bank_name: r.bank_name ?? null, account_no: r.account_no ?? null, account_holder: r.account_holder ?? null }) })
          }}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="업체명"
        />
      </td>
      <td>{text('stage', 'w-s', '단계')}</td>
      <td>
        <select className="ps-in" defaultValue={p.contract_type ?? ''} onChange={e => {
          const t = (e.target.value || null) as Payment['contract_type']
          save({ contract_type: t, vat: autoVat(p.amount, t) })
        }} aria-label="계약형태">
          <option value="">–</option>
          {CONTRACT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </td>
      <td>{text('bank_name', 'w-s', '은행')}</td>
      <td>{text('account_no', '', '계좌번호')}</td>
      <td>{text('account_holder', 'w-s', '예금주')}</td>
      <td>
        <input className={`ps-in num ${p.amount < 0 ? 'red' : ''}`} inputMode="numeric" defaultValue={p.amount.toLocaleString('ko-KR')} onBlur={e => {
          const amount = parseMoney(e.target.value)
          if (amount === p.amount) return
          // 부가세가 1/11 로 맞춰져 있던 줄은 같이 바꿈
          const wasAuto = p.vat === Math.round(p.amount / 11) || p.contract_type === '세금계산서'
          save({ amount, ...(wasAuto && p.vat ? { vat: Math.round(amount / 11) } : {}) })
        }} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="결제금액" />
      </td>
      <td>
        <input className="ps-in num w-m" inputMode="numeric" defaultValue={money(p.vat)} onBlur={e => save({ vat: parseMoney(e.target.value) })} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="부가세" />
      </td>
      <td className="num ps-calc">{money(supply(p))}</td>
      <td>
        <select className={`ps-in ${late ? 'late' : ''}`} defaultValue={p.status} onChange={e => {
          const status = e.target.value as Payment['status']
          save({ status, ...(status === '완료' && !p.paid_date ? { paid_date: todayKey() } : {}) })
        }} aria-label="상태" title={late ? '지급예정일이 지났습니다' : undefined}>
          {PAYMENT_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </td>
      <td>{date('due_date', '지급예정일')}</td>
      <td>{date('paid_date', '지급일')}</td>
      <td>
        <select className="ps-in" defaultValue={p.tax_invoice} onChange={e => save({ tax_invoice: e.target.value as Payment['tax_invoice'] })} aria-label="세금계산서">
          {TAX_INVOICE_STATES.map(s => <option key={s}>{s}</option>)}
        </select>
      </td>
      <td>{text('memo', 'w-l', '비고')}</td>
      <td className="ck">
        <button type="button" className="icon-btn xs" onClick={onOpen} aria-label="자세히 · 대지급 · 예상 비용" title="자세히 (대지급 · 예상 비용 · 삭제)">
          <MoreHorizontal size={13} />
        </button>
      </td>
    </tr>
  )
}
