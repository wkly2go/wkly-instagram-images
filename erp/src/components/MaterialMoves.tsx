import { useEffect, useMemo, useState } from 'react'
import { PackageMinus, PackagePlus, Undo2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { manwon, shortDate, todayKey } from '../lib/date'
import { EVIDENCE_KINDS, MATERIAL_MOVE_KINDS, evidenceHasVat, type Client, type EvidenceKind, type MaterialItem, type MaterialMove, type MaterialMoveKind, type MaterialStockRow, type Project } from '../lib/types'
import { parseMoney } from './PaymentForm'
import { Badge, Button, SectionHead } from './ui'
import { ask } from './Ask'

/**
 * 자재 입출고 (대표 지시 2026-10-29 "자재 입고와 연동" · "자재 입출고에 대한 사항도 포함")
 *  - 한 줄 입력: 입고(구매) · 출고(현장 투입 · 반출) · 반품
 *  - 입고 · 반품은 저장하면 이 프로젝트의 '지급' 결제가 자동으로 생기고 함께 바뀜 (서버 0068)
 *  - 재고 = 입고 − 출고 − 반품, 마감재 DB 자재를 고르면 규격 · 단위 · 최근 단가가 채워짐
 */
const KIND_ICON = { 입고: PackagePlus, 출고: PackageMinus, 반품: Undo2 }
const empty = (kind: MaterialMoveKind = '입고') => ({ kind, name: '', spec: '', unit: '', qty: '', price: '', supplier: '', evidence: '세금계산서' as EvidenceKind, paid: false, invoice: false, date: todayKey(), materialId: '' })

/** day · embedded: 현장 작업일지 안에 넣을 때 (대표 지시 2026-10-31 "작업일지에 자재 입출고 포함, 별도로 만들지 마") — 그날 기록만 보이고 날짜는 일지 날짜 */
export function MaterialMoves({ project, clients, day, embedded }: { project: Project; clients: Client[]; day?: string; embedded?: boolean }) {
  const { api, version, me, profileName } = useApp()
  const { busy, run } = useAction()
  const { data } = useAsync(
    async () => {
      const [moves, stock, items] = await Promise.all([api.listMaterialMoves(project.id), api.listMaterialStock(project.id), api.listMaterialItems()])
      return { moves, stock, items }
    },
    [project.id, version],
    { moves: [] as MaterialMove[], stock: [] as MaterialStockRow[], items: [] as MaterialItem[] },
  )
  const [f, setF] = useState(empty)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => setF({ ...empty(), date: day ?? todayKey() }), [project.id, day])

  // 고르기 후보: 이 프로젝트에서 쓴 자재 먼저, 그다음 마감재 DB
  const options = useMemo(() => {
    const seen = new Set<string>()
    const out: { label: string; name: string; spec: string; unit: string; price: number | null; materialId: string }[] = []
    for (const m of data.moves) {
      const k = `${m.name}|${m.spec ?? ''}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ label: [m.name, m.spec].filter(Boolean).join(' · '), name: m.name, spec: m.spec ?? '', unit: m.unit ?? '', price: m.unit_price || null, materialId: m.material_id ?? '' })
    }
    for (const it of data.items) {
      const k = `${it.name}|${it.spec ?? ''}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ label: [it.name, it.spec, it.brand].filter(Boolean).join(' · '), name: it.name, spec: it.spec ?? '', unit: it.unit ?? '', price: it.unit_price, materialId: it.id })
    }
    return out
  }, [data.moves, data.items])
  const pickName = (v: string) => {
    const o = options.find(x => x.label === v) ?? options.find(x => x.name === v)
    if (o) setF(s => ({ ...s, name: o.name, spec: o.spec || s.spec, unit: o.unit || s.unit, price: s.price || (o.price ? String(o.price) : ''), materialId: o.materialId }))
    else setF(s => ({ ...s, name: v, materialId: '' }))
  }

  const money = f.kind !== '출고'
  const qty = Number(f.qty.replace(/,/g, '')) || 0
  const price = parseMoney(f.price)
  const supply = Math.round(qty * price)
  const vat = money && evidenceHasVat(f.evidence) ? Math.round(supply * 0.1) : 0
  const stockOf = (name: string, spec: string) => data.stock.find(s => s.name === name && (s.spec ?? '') === spec)
  const cur = f.name ? stockOf(f.name, f.spec) : undefined
  const over = f.kind !== '입고' && cur && qty > cur.on_hand

  const save = async () => {
    if (!f.name.trim() || qty <= 0) return
    const client = clients.find(c => c.name === f.supplier.trim())
    const ok = await run(
      () =>
        api.saveMaterialMove({
          project_id: project.id,
          kind: f.kind,
          material_id: f.materialId || null,
          name: f.name.trim(),
          spec: f.spec.trim() || null,
          unit: f.unit.trim() || null,
          qty,
          unit_price: money ? price : 0,
          supplier: f.supplier.trim() || null,
          client_id: client?.id ?? null,
          evidence: money ? f.evidence : '현금',
          invoice_received: money && f.evidence === '세금계산서' && f.invoice,
          paid: money && f.paid,
          received_on: f.date || todayKey(),
        }),
      f.kind === '출고' ? '출고를 기록했습니다.' : `${f.kind}을 기록했습니다. 지급 결제에 ${f.kind === '반품' ? '차감으로 ' : ''}자동으로 넣었습니다.`,
    )
    if (ok) setF(s => ({ ...empty(s.kind), supplier: s.supplier, evidence: s.evidence, date: s.date }))
  }
  const cancel = async (m: MaterialMove) => {
    if (!(await ask(`'${m.name}' ${m.kind} 기록을 취소할까요?${m.payment_id ? ' 연결된 지급도 취소됩니다.' : ''}`))) return
    await run(() => api.saveMaterialMove({ id: m.id, status: '취소' }), '취소했습니다.')
  }

  const live = data.moves.filter(m => m.status === '입고')
  const dayMoves = day ? data.moves.filter(m => m.received_on === day) : data.moves
  const shown = showAll || day ? dayMoves : dayMoves.slice(0, 8)
  const totalIn = live.filter(m => m.kind === '입고').reduce((n, m) => n + m.qty * m.unit_price, 0) - live.filter(m => m.kind === '반품').reduce((n, m) => n + m.qty * m.unit_price, 0)
  const stockRows = data.stock.filter(s => s.qty_in || s.qty_out).sort((a, b) => a.name.localeCompare(b.name, 'ko'))

  return (
    <section className={`${embedded ? '' : 'section '}mat-moves`} aria-label="자재 입출고">
      {embedded ? (
        <div className="site-sec">
          다. 자재 입출고 (입고 · 출고 · 반품) <span className="t-cap">입고 · 반품은 협력업체 관리(지급)에 자동 등록{totalIn ? ` · 현장 자재비 ${manwon(totalIn)} (공급가)` : ''}</span>
        </div>
      ) : (
        <SectionHead title="자재 입출고" count={live.length ? String(live.length) : undefined} right={<span className="t-cap">{totalIn ? `자재비 ${manwon(totalIn)} (공급가)` : '입고하면 지급에 자동 등록'}</span>} />
      )}

      {/* 한 줄 입력 */}
      <div className="mat-form">
        <div className="seg" role="radiogroup" aria-label="구분">
          {MATERIAL_MOVE_KINDS.map(k => {
            const I = KIND_ICON[k]
            return (
              <button key={k} type="button" role="radio" aria-checked={f.kind === k} className={f.kind === k ? 'on' : ''} onClick={() => setF(s => ({ ...s, kind: k }))}>
                <I size={13} aria-hidden="true" /> {k}
              </button>
            )
          })}
        </div>
        <input className="input mat-name" list={`mat-opts-${project.id}`} placeholder="자재 (마감재 DB에서 고르거나 직접)" value={f.name} onChange={e => pickName(e.target.value)} aria-label="자재" />
        <datalist id={`mat-opts-${project.id}`}>
          {options.slice(0, 300).map(o => (
            <option key={`${o.label}|${o.materialId}`} value={o.label} />
          ))}
        </datalist>
        <input className="input mat-spec" placeholder="규격" value={f.spec} onChange={e => setF({ ...f, spec: e.target.value })} aria-label="규격" />
        <input className="input mat-qty" inputMode="decimal" placeholder="수량" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} onKeyDown={e => e.key === 'Enter' && save()} aria-label="수량" />
        <input className="input mat-unit" placeholder="단위" value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} aria-label="단위" />
        {money && <input className="input mat-price" inputMode="numeric" placeholder="단가 (부가세 별도)" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} onKeyDown={e => e.key === 'Enter' && save()} aria-label="단가" />}
        <input className="input mat-sup" list={`mat-sups-${project.id}`} placeholder={f.kind === '출고' ? '받는 곳 · 현장 (선택)' : '업체'} value={f.supplier} onChange={e => setF({ ...f, supplier: e.target.value })} aria-label="업체" />
        <datalist id={`mat-sups-${project.id}`}>
          {clients.map(c => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        <input className="input mat-date" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} aria-label="날짜" />
        {money && (
          <div className="mat-ev">
            <div className="seg" role="radiogroup" aria-label="증빙">
              {EVIDENCE_KINDS.map(k => (
                <button key={k} type="button" role="radio" aria-checked={f.evidence === k} className={f.evidence === k ? 'on' : ''} onClick={() => setF(s => ({ ...s, evidence: k, paid: k === '현금' || k === '카드' ? true : s.paid }))}>
                  {k}
                </button>
              ))}
            </div>
            {f.evidence === '세금계산서' && (
              <label className="mat-check">
                <input type="checkbox" checked={f.invoice} onChange={e => setF({ ...f, invoice: e.target.checked })} /> 계산서 받음
              </label>
            )}
            <label className="mat-check">
              <input type="checkbox" checked={f.paid} onChange={e => setF({ ...f, paid: e.target.checked })} /> {f.kind === '반품' ? '환불 받음' : '바로 지급함'}
            </label>
          </div>
        )}
        <div className="mat-sum">
          {money && supply > 0 && (
            <span className="t-cap">
              공급가 {supply.toLocaleString('ko-KR')}원{vat ? ` + 부가세 ${vat.toLocaleString('ko-KR')}원` : ' (부가세 없음)'} = <b>{(supply + vat).toLocaleString('ko-KR')}원</b>
            </span>
          )}
          {cur && <span className={`t-cap${over ? ' t-red' : ''}`}>현재 재고 {cur.on_hand}{cur.unit ?? ''}{over ? ' · 재고보다 많이 나갑니다' : ''}</span>}
          <span className="grow" />
          <Button onClick={save} disabled={busy || !f.name.trim() || qty <= 0}>
            {f.kind} 기록
          </Button>
        </div>
      </div>

      {/* 재고 */}
      {stockRows.length > 0 && (
        <div className="table-wrap">
          <table className="table mat-stock">
            <thead>
              <tr>
                <th>자재 · 규격</th>
                <th className="num">입고</th>
                <th className="num">출고</th>
                <th className="num">반품</th>
                <th className="num">재고</th>
                <th className="num">최근</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map(s => (
                <tr key={`${s.material_id}|${s.name}|${s.spec}`} className="click" onClick={() => setF(v => ({ ...v, name: s.name, spec: s.spec ?? '', unit: s.unit ?? '', materialId: s.material_id ?? '' }))} title="눌러서 이 자재로 입력">
                  <td className="max">
                    <b>{s.name}</b>
                    {s.spec && <span className="t-cap"> · {s.spec}</span>}
                  </td>
                  <td className="num">{s.qty_in}</td>
                  <td className="num">{s.qty_out}</td>
                  <td className="num">{s.qty_return || '–'}</td>
                  <td className={`num${s.on_hand <= 0 ? ' red' : ''}`}>
                    <b>{s.on_hand}</b>
                    {s.unit ?? ''}
                  </td>
                  <td className="num">{shortDate(s.last_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 기록 */}
      {data.moves.length > 0 && (
        <div className="col gap-2">
          {shown.map(m => {
            const I = KIND_ICON[m.kind]
            const amt = m.kind === '출고' ? null : Math.round(m.qty * m.unit_price) + (evidenceHasVat(m.evidence) ? Math.round(m.qty * m.unit_price * 0.1) : 0)
            return (
              <div key={m.id} className={`mat-row${m.status === '취소' ? ' muted' : ''}`}>
                <Badge tone={m.kind === '입고' ? 'blue' : m.kind === '반품' ? 'red' : 'paper'}>
                  <I size={11} aria-hidden="true" /> {m.kind}
                </Badge>
                <span className="grow truncate">
                  <b>{m.name}</b>
                  {m.spec ? ` · ${m.spec}` : ''} · {m.qty}
                  {m.unit ?? ''}
                  {m.supplier ? <span className="t-cap"> · {m.supplier}</span> : null}
                </span>
                {amt != null && <span className="t-cap nowrap">{manwon(m.kind === '반품' ? -amt : amt)}</span>}
                {m.kind !== '출고' && <span className="t-cap nowrap">{m.evidence}{m.paid ? ' · 지급됨' : m.payment_id ? ' · 지급 예정' : ''}</span>}
                <span className="t-meta nowrap">
                  {shortDate(m.received_on)} · {profileName(m.created_by)}
                </span>
                {m.status === '취소' ? (
                  <span className="t-cap">취소됨</span>
                ) : (
                  (me.role === 'admin' || m.created_by === me.id) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancel(m)} disabled={busy}>
                      취소
                    </button>
                  )
                )}
              </div>
            )
          })}
          {!day && data.moves.length > 8 && (
            <button type="button" className="link-btn t-cap" onClick={() => setShowAll(v => !v)}>
              {showAll ? '접기' : `${data.moves.length - 8}건 더 보기`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
