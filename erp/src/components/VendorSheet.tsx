// 협력업체 관리 (대표 지시 2026-10-31 "결제 대장은 협력업체 관리로 변경")
//   업체 1곳 = 1줄: 매입/매출 · 공사구분 · 업체명 · 항목 · 계약형태 · 은행명 · 계좌번호 · 예금주 · 계약금
//   · 결제 금액(선금 · 중도금 n차 · 잔금 — 칸마다 금액 · 결제일자, 중도금은 [+]로 칸 추가 · 결제 요청일은 2026-10-31 지시로 뺌)
//   · 계산서 발행 여부 · 비고
//   저장 위치: 단계마다 결제(payments) 한 건 (stage = 선금 / 중도금 n차 / 잔금), 계약금 · 비고는 업체 계약 줄(budget_lines)
//   매출(수금)의 계약금은 프로젝트 계약(project_finances)
//   노란 칸에 바로 적으면 저장 · 결제일자를 넣으면 그 단계는 완료 · 금액을 지우면 그 단계는 취소(지우지 않음)
import { useMemo, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { useAction, useApp } from '../lib/app'
import { manwon, todayKey } from '../lib/date'
import { isDone } from '../lib/finance'
import { CONTRACT_TYPES, type BudgetLine, type Payment, type ProjectFinance } from '../lib/types'
import { Button } from './ui'
import { openVendor } from './RightSchedule'
import { showPanel } from './WebSearch'

type Patch = Partial<Payment>
const money = (n: number | null | undefined) => (n ? n.toLocaleString('ko-KR') : '')
const parseMoney = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0
const norm = (s: string) => s.replace(/\s|㈜|\(주\)|주식회사/g, '').toLowerCase()
const order = (p: Payment) => p.requested_date ?? p.due_date ?? p.paid_date ?? p.created_at.slice(0, 10)
const vatOf = (amount: number, type: Payment['contract_type'], prev?: Payment) => (prev ? (prev.vat ? Math.round(amount / 11) : 0) : type === '세금계산서' ? Math.round(amount / 11) : 0)
/** 결제일 칸: '10.30' · '2026-10-30' · 't'(오늘) · 빈칸(지움) → yyyy-mm-dd | null, 못 읽으면 undefined */
const parseDay = (v: string): string | null | undefined => {
  const t = v.trim()
  if (!t) return null
  if (/^(t|오늘)$/i.test(t)) return todayKey()
  const full = /^(\d{4})[.\-/ ](\d{1,2})[.\-/ ](\d{1,2})/.exec(t)
  const short = /^(\d{1,2})[.\-/ ](\d{1,2})$/.exec(t) ?? /^(\d{2})(\d{2})$/.exec(t)
  const [y, m, d] = full ? [full[1], full[2], full[3]] : short ? [todayKey().slice(0, 4), short[1], short[2]] : []
  if (!y || !m || !d) return undefined
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}
const live = (p: Payment) => p.status !== '취소' && !p.is_estimate

interface Vendor {
  key: string
  dir: Payment['direction']
  payee: string
  category: string | null
  title: string
  contractType: Payment['contract_type']
  bank: string | null
  account: string | null
  holder: string | null
  invoice: Payment['tax_invoice'] | '일부' | null
  items: Payment[]
  line: BudgetLine | undefined
  pre?: Payment
  mids: Payment[]
  bal?: Payment
  contract: number | null
  paid: number
}

/** 단계 글로 칸 정하기: 선금(계약금) · 중도금 n차 · 잔금(일시불), 글이 없으면 순서대로 채움 */
function slot(items: Payment[]) {
  // 환불 · 차감(마이너스)은 단계 칸에 넣지 않음 (결제 건별 보기에서)
  const list = items.filter(p => live(p) && p.amount > 0).sort((a, b) => order(a).localeCompare(order(b)) || a.created_at.localeCompare(b.created_at))
  let pre: Payment | undefined, bal: Payment | undefined
  const mids: { n: number; p: Payment }[] = []
  const rest: Payment[] = []
  for (const p of list) {
    const t = p.stage ?? ''
    const mid = /중도금\s*(\d+)?/.exec(t)
    if (/선금|계약금/.test(t) && !pre) pre = p
    else if (/잔금|일시불/.test(t) && !bal) bal = p
    else if (mid) mids.push({ n: Number(mid[1] ?? 1), p })
    else rest.push(p)
  }
  for (const p of rest) {
    if (!pre) pre = p
    else mids.push({ n: 99, p })
  }
  return { pre, mids: mids.sort((a, b) => a.n - b.n).map(m => m.p), bal }
}

export function VendorSheet({ projectId, payments, all, lines, finance, onOpen }: { projectId: string; payments: Payment[]; all: Payment[]; lines: BudgetLine[]; finance: ProjectFinance | undefined; onOpen: (p: Payment) => void }) {
  const { api, toast } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const [extraMid, setExtraMid] = useState(0)

  const vendors = useMemo<Vendor[]>(() => {
    const map = new Map<string, Payment[]>()
    for (const p of payments) {
      if (p.is_estimate) continue
      const name = p.payee?.trim() || (p.direction === '수금' ? '발주처' : p.title)
      const k = `${p.direction}|${norm(name)}`
      map.set(k, [...(map.get(k) ?? []), p])
    }
    const out: Vendor[] = []
    const usedLines = new Set<string>()
    for (const [key, items] of map) {
      const first = items.find(live) ?? items[0]
      const dir = first.direction
      const name = first.payee?.trim() || (dir === '수금' ? '발주처' : first.title)
      const line = dir === '지급' ? lines.find(l => l.payee && norm(l.payee) === norm(name)) : undefined
      if (line) usedLines.add(line.id)
      const liveItems = items.filter(live)
      const withAcc = [...liveItems].reverse().find(p => p.account_no)
      const inv = [...new Set(liveItems.map(p => p.tax_invoice))]
      const s = slot(items)
      out.push({
        key,
        dir,
        payee: name,
        category: line?.category ?? first.category,
        title: first.title,
        contractType: first.contract_type,
        bank: withAcc?.bank_name ?? null,
        account: withAcc?.account_no ?? null,
        holder: withAcc?.account_holder ?? null,
        invoice: inv.length === 1 ? inv[0] : inv.length ? '일부' : null,
        items,
        line,
        ...s,
        // 계약금은 부가세 포함으로 보여 주고 받음 (저장은 공급가)
        contract: dir === '수금' ? (finance?.contract_amount != null ? Math.round(finance.contract_amount * 1.1) : null) : line?.contract_amount != null ? Math.round(line.contract_amount * 1.1) : null,
        paid: liveItems.filter(isDone).reduce((n, p) => n + p.amount, 0),
      })
    }
    // 계약만 있고 아직 결제가 없는 업체
    for (const l of lines) {
      if (!l.payee || usedLines.has(l.id)) continue
      out.push({ key: `line|${l.id}`, dir: '지급', payee: l.payee, category: l.category, title: l.item ?? l.category, contractType: null, bank: null, account: null, holder: null, invoice: null, items: [], line: l, mids: [], contract: l.contract_amount != null ? Math.round(l.contract_amount * 1.1) : null, paid: 0 })
    }
    return out.sort((a, b) => (a.dir === b.dir ? (a.category ?? '').localeCompare(b.category ?? '', 'ko') || a.payee.localeCompare(b.payee, 'ko') : a.dir === '수금' ? -1 : 1))
  }, [payments, lines, finance])

  const midCols = Math.max(1, ...vendors.map(v => v.mids.length)) + extraMid
  const stages = [{ key: 'pre', label: '선금' }, ...Array.from({ length: midCols }, (_, i) => ({ key: `mid${i}`, label: `중도금 ${i + 1}차` })), { key: 'bal', label: '잔금' }]
  const pick = (v: Vendor, k: string) => (k === 'pre' ? v.pre : k === 'bal' ? v.bal : v.mids[Number(k.slice(3))])

  const categories = useMemo(() => [...new Set([...all.map(p => p.category), ...lines.map(l => l.category)].filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'ko')), [all, lines])
  const payees = useMemo(() => [...new Set(all.map(p => p.payee?.trim()).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'ko')), [all])

  /** 업체 공통 칸 (구분 · 공사구분 · 업체명 · 항목 · 계약형태 · 계좌 · 계산서) → 그 업체의 모든 결제에 */
  const saveVendor = (v: Vendor, patch: Patch) => {
    const ids = v.items.filter(live).map(p => p.id)
    void run(async () => {
      if (ids.length) await api.updatePayments(ids, patch)
      if (v.line && (patch.payee !== undefined || patch.category !== undefined)) await api.saveBudgetLine({ id: v.line.id, ...(patch.payee !== undefined ? { payee: patch.payee } : {}), ...(patch.category !== undefined ? { category: patch.category || '미분류' } : {}) })
    })
  }
  /** 계약금 · 비고: 매입은 업체 계약 줄, 매출은 프로젝트 계약 */
  const saveContract = (v: Vendor, patchIncl: { contract_amount?: number | null; memo?: string | null }) =>
    void run(async () => {
      // 화면은 부가세 포함, 저장은 공급가(÷1.1)
      const patch = { ...patchIncl, ...(patchIncl.contract_amount !== undefined ? { contract_amount: patchIncl.contract_amount == null ? null : Math.round(patchIncl.contract_amount / 1.1) } : {}) }
      if (v.dir === '수금' && patch.contract_amount !== undefined) {
        await api.saveFinance({ project_id: projectId, contract_amount: patch.contract_amount, budget_cost: finance?.budget_cost ?? null, target_margin: finance?.target_margin ?? null, memo: finance?.memo ?? null })
        return
      }
      if (v.line) await api.saveBudgetLine({ id: v.line.id, ...patch })
      else await api.saveBudgetLine({ project_id: projectId, category: v.category || '미분류', payee: v.payee, item: v.title, budget_amount: 0, sort_order: lines.length + 1, contract_amount: patch.contract_amount ?? null, memo: patch.memo ?? null })
    })
  /** 단계 칸: 있으면 고치고, 없으면 금액을 넣을 때 새 결제 */
  const saveStage = (v: Vendor, label: string, cur: Payment | undefined, patch: { amount?: number; requested_date?: string | null; paid_date?: string | null }) => {
    if (cur) {
      const p: Patch = {}
      if (patch.amount !== undefined) {
        if (patch.amount === cur.amount) return
        if (!patch.amount) Object.assign(p, { status: '취소', memo: [cur.memo, '협력업체 관리에서 금액 지움'].filter(Boolean).join(' · ') })
        else Object.assign(p, { amount: patch.amount, vat: vatOf(patch.amount, cur.contract_type, cur) })
      }
      if (patch.requested_date !== undefined) {
        if (patch.requested_date === cur.requested_date) return
        p.requested_date = patch.requested_date
      }
      if (patch.paid_date !== undefined) {
        if (patch.paid_date === cur.paid_date) return
        Object.assign(p, { paid_date: patch.paid_date, status: patch.paid_date ? '완료' : cur.status === '완료' ? '예정' : cur.status })
      }
      void run(() => api.savePayment({ id: cur.id, ...p }))
      return
    }
    if (!patch.amount) return
    const base = v.items.find(live) ?? v.items[0]
    void run(
      () =>
        api.savePayment({
          project_id: projectId,
          direction: v.dir,
          payee: v.payee,
          client_id: base?.client_id ?? null,
          category: v.category,
          title: v.title || v.payee,
          contract_type: v.contractType,
          bank_name: v.bank,
          account_no: v.account,
          account_holder: v.holder,
          amount: patch.amount,
          vat: vatOf(patch.amount!, v.contractType, base),
          stage: label,
          requested_date: today,
          status: '예정',
          tax_invoice: v.contractType && v.contractType !== '세금계산서' && v.contractType !== '계산서' ? '해당 없음' : '미발행',
          budget_line_id: v.line?.id ?? null,
        }),
      `${v.payee} ${label}을(를) 넣었습니다.`,
    )
  }

  // 새 업체 줄
  const blank = { dir: '지급' as Payment['direction'], category: '', payee: '', title: '', contractType: '' as string, bank: '', account: '', holder: '', contract: '', pre: '', preReq: today, invoice: '미발행' as Payment['tax_invoice'], memo: '' }
  const [d, setD] = useState(blank)
  const remember = (name: string) => {
    const prev = [...all].filter(p => p.payee?.trim() === name.trim()).sort((a, b) => b.created_at.localeCompare(a.created_at))
    const acc = prev.find(p => p.account_no)
    setD(x => ({ ...x, bank: x.bank || acc?.bank_name || '', account: x.account || acc?.account_no || '', holder: x.holder || acc?.account_holder || '', contractType: x.contractType || prev[0]?.contract_type || '', category: x.category || prev[0]?.category || '' }))
  }
  const add = async () => {
    const payee = d.payee.trim()
    const amount = parseMoney(d.pre)
    const contract = parseMoney(d.contract)
    if (!payee || (!amount && !contract && !d.memo.trim())) return
    if (d.dir === '수금' && !amount) return
    const ok = await run(async () => {
      let lineId: string | null = null
      if (d.dir === '지급' && (contract || d.memo.trim())) {
        const l = await api.saveBudgetLine({ project_id: projectId, category: d.category.trim() || '미분류', payee, item: d.title.trim() || null, budget_amount: 0, sort_order: lines.length + 1, contract_amount: contract ? Math.round(contract / 1.1) : null, memo: d.memo.trim() || null })
        lineId = l.id
      }
      if (amount) {
        const type = (d.contractType || null) as Payment['contract_type']
        await api.savePayment({
          project_id: projectId,
          direction: d.dir,
          payee,
          category: d.category.trim() || null,
          title: d.title.trim() || payee,
          contract_type: type,
          bank_name: d.bank.trim() || null,
          account_no: d.account.trim() || null,
          account_holder: d.holder.trim() || null,
          amount,
          vat: vatOf(amount, type),
          stage: '선금',
          requested_date: d.preReq || today,
          status: '예정',
          tax_invoice: d.contractType && d.contractType !== '세금계산서' && d.contractType !== '계산서' ? '해당 없음' : '미발행',
          budget_line_id: lineId,
          memo: d.dir === '수금' ? d.memo.trim() || null : null,
        })
      }
    }, `${payee}을(를) 협력업체에 넣었습니다.`)
    if (ok) setD(blank)
  }
  const enter = (e: React.KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLElement).blur(), void add())
  const blurOnEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()

  const sumContract = vendors.filter(v => v.dir === '지급').reduce((n, v) => n + (v.contract ?? 0), 0)
  const sumPaid = vendors.filter(v => v.dir === '지급').reduce((n, v) => n + v.paid, 0)

  // 한 화면에 (대표 지시 2026-10-31 "한 화면에서 관리, 결제 요청일 삭제, 자재 입출고처럼 한눈에")
  //   업체 1곳 = 한 줄 · 흰 바탕 (대표 지시 2026-10-31 "세부 내용은 한 줄로, 백색으로") — 칸 안에 두 값을 나란히
  const txt = (val: string | null | undefined, onSave: (v: string | null) => void, label: string, cls = '', list?: string) => (
    <input className={`ps-in ${cls}`} list={list} defaultValue={val ?? ''} placeholder={label} title={label} onBlur={e => e.target.value.trim() !== (val ?? '') && onSave(e.target.value.trim() || null)} onKeyDown={blurOnEnter} aria-label={label} />
  )
  return (
    <div className="table-wrap pay-sheet-wrap">
      <datalist id="vs-cat">
        {categories.map(c => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="vs-payee">
        {payees.map(c => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <table className="pay-sheet vendor-sheet one-line">
        <thead>
          <tr>
            <th>
              구분 · 공사구분
            </th>
            <th>
              업체명 · 항목
            </th>
            <th>
              계약형태
            </th>
            <th>
              계좌번호
            </th>
            <th className="num" title="부가세 포함 · 매입: 업체 계약금 · 매출: 프로젝트 계약">
              계약금 · 진행
            </th>
            {stages.map((s, i) => (
              <th key={s.key} className="vs-stage-h">
                {s.label}
                {i === stages.length - 2 && (
                  <button type="button" className="link-btn vs-addmid" onClick={() => setExtraMid(n => n + 1)} title="중도금 칸 하나 더" aria-label="중도금 추가">
                    <Plus size={11} />
                  </button>
                )} <span className="t-cap">금액 · 결제일</span>
              </th>
            ))}
            <th>비고</th>
            <th className="ck" />
          </tr>
        </thead>
        <tbody>
          {vendors.map(v => {
            const rate = v.contract ? Math.round((v.paid / v.contract) * 100) : null
            return (
              <tr key={`${v.key}:${v.items.map(p => p.updated_at).join()}:${v.line?.updated_at ?? ''}`}>
                <td className="vs-2">
                  <select className="ps-in" defaultValue={v.dir} onChange={e => saveVendor(v, { direction: e.target.value as Payment['direction'] })} aria-label="매입/매출" disabled={!v.items.length}>
                    <option value="지급">매입</option>
                    <option value="수금">매출</option>
                  </select>
                  {txt(v.category, x => saveVendor(v, { category: x }), '공사구분', '', 'vs-cat')}
                </td>
                <td className="vs-2">
                  <button type="button" className="ps-in vs-name" onClick={() => (showPanel(), openVendor({ name: v.payee, clientId: v.items.find(live)?.client_id ?? null }))} title={`${v.payee} 상세 (오른쪽 칸)`}>
                    {v.payee}
                  </button>
                  {txt(v.title, x => x && saveVendor(v, { title: x }), '항목')}
                </td>
                <td className="vs-2">
                  <select className="ps-in" defaultValue={v.contractType ?? ''} onChange={e => saveVendor(v, { contract_type: (e.target.value || null) as Payment['contract_type'] })} aria-label="계약형태" disabled={!v.items.length}>
                    <option value="">형태 선택</option>
                    {CONTRACT_TYPES.map(t => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </td>
                <td className="vs-2" title={[v.bank, v.holder].filter(Boolean).join(' · ') || '은행 · 예금주는 … 에서'}>
                  {txt(v.account, x => saveVendor(v, { account_no: x }), '계좌번호')}
                </td>
                <td className="vs-2">
                  <input className="ps-in num" inputMode="numeric" defaultValue={money(v.contract)} placeholder="계약금" onBlur={e => { const n = parseMoney(e.target.value) || null; if (n !== v.contract) saveContract(v, { contract_amount: n }) }} onKeyDown={blurOnEnter} aria-label="계약금" />
                  <span className="t-cap vs-rate" title="결제 완료 ÷ 계약금 (부가세 포함)">{rate != null ? `${rate}% ${v.dir === '수금' ? '수금' : '지급'}` : v.paid ? `완료 ${manwon(v.paid)}` : '–'}</span>
                </td>
                {stages.map(s => {
                  const cur = pick(v, s.key)
                  return (
                    <td key={s.key} className={`vs-2 vs-stage ${cur && isDone(cur) ? 'done' : ''}`}>
                      <input className="ps-in num" inputMode="numeric" defaultValue={money(cur?.amount)} placeholder="금액" onBlur={e => saveStage(v, s.label, cur, { amount: parseMoney(e.target.value) })} onKeyDown={blurOnEnter} aria-label={`${s.label} 결제 금액`} />
                      <input className="ps-in vs-day" defaultValue={cur?.paid_date ? cur.paid_date.slice(5).replace('-', '.') : ''} placeholder="결제일" onBlur={e => {
                        const d2 = parseDay(e.target.value)
                        if (d2 === undefined) return void toast('결제일은 10.30 · 10/30 · 1030 · 2026-10-30 · t(오늘)처럼 적어 주세요.')
                        if (!cur) return void (d2 && toast(`${s.label} 금액을 먼저 넣어 주세요.`))
                        saveStage(v, s.label, cur, { paid_date: d2 })
                      }} onKeyDown={blurOnEnter} aria-label={`${s.label} 결제일자`} title={cur?.paid_date ? `결제일 ${cur.paid_date}` : '결제일 (예: 10.30 · 오늘이면 t) — 넣으면 결제 완료'} />
                      <label className={`vs-inv${cur ? '' : ' off'}`} title={cur ? (v.dir === '수금' ? '이 단계 세금계산서 발행' : '이 단계 세금계산서 받음') : '금액을 먼저 넣어 주세요'}>
                        <input type="checkbox" defaultChecked={cur?.tax_invoice === '발행'} disabled={!cur} onChange={e => cur && void run(() => api.savePayment({ id: cur.id, tax_invoice: e.target.checked ? '발행' : '미발행', tax_invoice_date: e.target.checked ? cur.tax_invoice_date ?? todayKey() : null }), e.target.checked ? `${v.payee} ${s.label} 계산서 ${v.dir === '수금' ? '발행' : '받음'}으로 표시했습니다.` : '계산서 표시를 지웠습니다.')} aria-label={`${s.label} 계산서 발행 여부`} />
                        계산서
                      </label>
                    </td>
                  )
                })}
                <td className="vs-2">
                  <input
                    className="ps-in"
                    placeholder="비고"
                    defaultValue={(v.dir === '수금' ? v.items.find(live)?.memo : v.line?.memo) ?? ''}
                    onBlur={e => {
                      const t = e.target.value.trim() || null
                      if (v.dir === '수금') {
                        const first = v.items.find(live)
                        if (first && t !== first.memo) void run(() => api.savePayment({ id: first.id, memo: t }))
                      } else if (t !== (v.line?.memo ?? null)) saveContract(v, { memo: t })
                    }}
                    onKeyDown={blurOnEnter}
                    aria-label="비고"
                  />
                </td>
                <td className="ck">
                  {v.items.length > 0 && (
                    <button type="button" className="icon-btn xs" onClick={() => onOpen(v.items.find(live) ?? v.items[0])} aria-label="자세히" title="자세히 (대지급 · 예상 비용 · 삭제)">
                      <MoreHorizontal size={13} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
          {/* 새 업체 */}
          <tr className="ps-new">
            <td className="vs-2">
              <select className="ps-in" value={d.dir} onChange={e => setD({ ...d, dir: e.target.value as Payment['direction'] })} aria-label="새 업체 매입/매출">
                <option value="지급">매입</option>
                <option value="수금">매출</option>
              </select>
              <input className="ps-in" list="vs-cat" value={d.category} onChange={e => setD({ ...d, category: e.target.value })} onKeyDown={enter} placeholder="공사구분" aria-label="새 업체 공사구분" />
            </td>
            <td className="vs-2">
              <input className="ps-in strong" list="vs-payee" value={d.payee} onChange={e => setD({ ...d, payee: e.target.value })} onBlur={e => remember(e.target.value)} onKeyDown={enter} placeholder="+ 새 업체명" aria-label="새 업체명" />
              <input className="ps-in" value={d.title} onChange={e => setD({ ...d, title: e.target.value })} onKeyDown={enter} placeholder="항목" aria-label="새 업체 항목" />
            </td>
            <td className="vs-2">
              <select className="ps-in" value={d.contractType} onChange={e => setD({ ...d, contractType: e.target.value })} aria-label="새 업체 계약형태">
                <option value="">형태 선택</option>
                {CONTRACT_TYPES.map(t => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </td>
            <td className="vs-2">
              <input className="ps-in" value={d.account} onChange={e => setD({ ...d, account: e.target.value })} onKeyDown={enter} placeholder="계좌번호" aria-label="새 업체 계좌번호" />
            </td>
            <td className="vs-2">
              <input className="ps-in num" inputMode="numeric" value={d.contract ? parseMoney(d.contract).toLocaleString('ko-KR') : ''} onChange={e => setD({ ...d, contract: e.target.value })} onKeyDown={enter} placeholder="계약금" aria-label="새 업체 계약금" disabled={d.dir === '수금'} />
            </td>
            {stages.map((s, i) => (
              <td key={s.key} className="vs-2 vs-stage">
                {i === 0 ? (
                  <input className="ps-in num" inputMode="numeric" value={d.pre ? parseMoney(d.pre).toLocaleString('ko-KR') : ''} onChange={e => setD({ ...d, pre: e.target.value })} onKeyDown={enter} placeholder="선금" aria-label="새 업체 선금" />
                ) : null}
              </td>
            ))}
            <td className="vs-2">
              <input className="ps-in" value={d.memo} onChange={e => setD({ ...d, memo: e.target.value })} onKeyDown={enter} placeholder="비고" aria-label="새 업체 비고" />
            </td>
            <td className="ck">
              <Button size="sm" disabled={busy || !d.payee.trim() || (!parseMoney(d.pre) && !parseMoney(d.contract) && !d.memo.trim())} onClick={() => void add()} aria-label="업체 추가">
                <Plus size={12} />
              </Button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="t-cap">
              {vendors.length}곳 · 노란 칸에 바로 적으면 저장 · 결제일을 넣으면 그 단계 완료 · 금액을 지우면 그 단계 취소
            </td>
            <td className="num">{money(sumContract)}</td>
            <td colSpan={stages.length + 2} className="t-cap">
              매입 결제 완료 {manwon(sumPaid) || '0'}
              {sumContract ? ` · 계약 대비 ${Math.round((sumPaid / sumContract) * 100)}%` : ''} (부가세 포함)
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
