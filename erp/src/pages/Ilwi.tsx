// 일위대가 (2026-11-18 대표 지시 '일위대가와 일반 인테리어를 분리해서 개발해')
// 일반 인테리어 견적 화면(pages/Design.tsx)과 따로 둔 화면. 견적 금액 계산에는 끼어들지 않는다 — 단위당 원가를 따져 보는 곳.
//  · 일위대가: 항목마다 재료(물가 기준 기호 × 소요량) + 노무(직종 × 품) + 경비 → 지금 물가 · 노임으로 합계
//  · 조달청 시공 단가: 재료 · 노무 · 경비가 나뉜 시장시공가격 — 관리자가 일위대가로 가져올 수 있음
//  · 노임단가: 대한건설협회 시중노임단가
import { useEffect, useMemo, useState } from 'react'
import { Shell } from '../components/Shell'
import { Badge, Button, Empty } from '../components/ui'
import { DesignPriceRefPick } from '../components/DesignPriceRefPick'
import { confirmDelete } from '../components/DesignWorkspace'
import { useAction, useApp, useAsync } from '../lib/app'
import type { PriceRef } from '../lib/design'
import { ILWI_KINDS, fromMarketRef, ilwiTotals, laborLine, materialLine, nextIlwiCode, type IlwiItem, type IlwiKind, type IlwiLine, type LaborRate } from '../lib/ilwi'
import './Design.css'
import './Ilwi.css'

const won = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString('ko-KR'))
type Tab = 'items' | 'market' | 'labor'
const NO_BASE = { trades: [], units: [] }

export default function Ilwi() {
  const { me } = useApp()
  const [tab, setTab] = useState<Tab>('items')
  const admin = me.role === 'admin'
  return (
    <Shell active="ilwi">
      <div className="design-page">
        <header className="design-head">
          <h1 className="t-title">일위대가</h1>
          <p className="t-cap">단위당 재료비 + 노무비 + 경비를 물가 기준과 시중노임단가로 따져 보는 곳입니다. 일반 인테리어 견적(판매 단가 · 수량표)과 따로 두며, 견적 금액을 바꾸지 않습니다.</p>
        </header>
        <div className="design-block">
          <div className="row wrap" role="tablist" aria-label="일위대가 보기">
            {([['items', '일위대가'], ['market', '조달청 시공 단가'], ['labor', '노임단가']] as const).map(([k, name]) => <button type="button" role="tab" aria-selected={tab === k} key={k} className={`chip${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{name}</button>)}
          </div>
          {tab === 'items' && <Items admin={admin} />}
          {tab === 'market' && <Market admin={admin} onMade={() => setTab('items')} />}
          {tab === 'labor' && <Labor />}
        </div>
      </div>
    </Shell>
  )
}

function Items({ admin }: { admin: boolean }) {
  const { api, version, bump } = useApp()
  const { run, busy } = useAction()
  const { data: items, loading } = useAsync(() => api.listIlwiItems(), [version], [] as IlwiItem[])
  const [open, setOpen] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const [d, setD] = useState({ name: '', spec: '', unit: '', basis: '' })
  const word = find.trim().toLowerCase()
  const shown = useMemo(() => (word ? items.filter(i => `${i.code} ${i.name} ${i.spec} ${i.basis}`.toLowerCase().includes(word)) : items), [items, word])
  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!d.name.trim() || !d.unit.trim()) return
    void run(async () => { const id = await api.saveIlwiItem(null, { code: nextIlwiCode(items.map(i => i.code)), trade_code: null, name: d.name, spec: d.spec.trim(), unit: d.unit.trim(), basis: d.basis.trim(), note: null }); setOpen(id); bump() }, '항목을 만들었습니다. 재료 · 노무 · 경비 줄을 넣어 주세요').then(ok => ok && setD({ name: '', spec: '', unit: '', basis: '' }))
  }
  return (
    <>
      <div className="row wrap"><input className="input design-filter" type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="번호 · 항목 · 규격 찾기" aria-label="일위대가 찾기" /><span className="t-cap">{shown.length}건 · 금액은 지금의 물가 기준 · 노임단가로 계산한 값입니다(부가세 별도).</span></div>
      {loading ? <p className="t-cap" role="status">불러오고 있습니다.</p> : shown.length === 0 ? <Empty>{items.length ? '찾는 낱말에 맞는 항목이 없습니다.' : admin ? "아직 일위대가가 없습니다. 아래에서 항목을 만들거나, '조달청 시공 단가'에서 가져오세요." : '아직 일위대가가 없습니다.'}</Empty> : (
        <div className="table-wrap"><table className="table ilwi-table">
          <thead><tr><th>번호</th><th>항목</th><th>규격</th><th>단위</th><th className="num">재료비</th><th className="num">노무비</th><th className="num">경비</th><th className="num">합계</th><th /></tr></thead>
          <tbody>{shown.flatMap(i => [
            <tr key={i.id} className={open === i.id ? 'ilwi-open' : ''}>
              <td className="nowrap strong">{i.code}</td><td>{i.name}{i.missing > 0 && <Badge tone="yellow">단가 없는 줄 {i.missing}</Badge>}</td><td className="max">{i.spec}</td><td>{i.unit}</td>
              <td className="num">{won(i.material)}</td><td className="num">{won(i.labor)}</td><td className="num">{won(i.expense)}</td><td className="num strong">{won(i.total)}</td>
              <td className="nowrap"><Button size="sm" kind="ghost" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? '접기' : `내역 ${i.lines}줄`}</Button></td>
            </tr>,
            ...(open === i.id ? [<tr key={`${i.id}-d`} className="ilwi-detail"><td colSpan={9}><Detail item={i} admin={admin} onClosed={() => setOpen(null)} /></td></tr>] : []),
          ])}</tbody>
        </table></div>)}
      {admin && <form className="design-add" onSubmit={add} aria-label="일위대가 항목 만들기">
        <input className="input" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="항목 (예: 석고보드 붙임 1겹)" aria-label="항목" required />
        <input className="input" value={d.spec} onChange={e => setD({ ...d, spec: e.target.value })} placeholder="규격 (예: 12.5T · 벽)" aria-label="규격" />
        <input className="input design-qty" value={d.unit} onChange={e => setD({ ...d, unit: e.target.value })} placeholder="단위" aria-label="단위" required />
        <input className="input" value={d.basis} onChange={e => setD({ ...d, basis: e.target.value })} placeholder="근거 (예: 표준품셈 · 우리 실적)" aria-label="근거" />
        <Button type="submit" kind="outline" disabled={busy}>항목 만들기</Button>
      </form>}
    </>
  )
}

function Detail({ item, admin, onClosed }: { item: IlwiItem; admin: boolean; onClosed(): void }) {
  const { api, version, bump, toast } = useApp()
  const { run, busy } = useAction()
  const { data: lines } = useAsync(() => api.listIlwiLines(item.id), [item.id, version], [] as IlwiLine[])
  const { data: rates } = useAsync(() => (admin ? api.listLaborRates() : Promise.resolve([] as LaborRate[])), [admin], [] as LaborRate[])
  const [qty, setQty] = useState('1')
  const [job, setJob] = useState('')
  const [man, setMan] = useState('')
  const [ex, setEx] = useState({ name: '공구손료', pct: '', amount: '' })
  const t = ilwiTotals(lines)
  const done = (p: Promise<boolean>) => p.then(ok => { if (ok) bump(); return ok })
  const pickMaterial = (r: PriceRef) => { const q = Number(qty); if (!(q > 0)) { toast('소요량을 먼저 적어 주세요'); return } void done(run(() => api.addIlwiLines([materialLine(item.id, r, q)]), `${r.code ?? r.item} 재료 줄을 넣었습니다`)) }
  const addLabor = () => { const w = rates.find(x => x.code === job), q = Number(man); if (!w || !(q > 0)) { toast('직종과 품(인)을 적어 주세요'); return } void done(run(() => api.addIlwiLines([laborLine(item.id, w, q)]), `${w.name} 노무 줄을 넣었습니다`)).then(ok => ok && setMan('')) }
  const addExpense = () => {
    const pct = Number(ex.pct), amount = Number(ex.amount)
    if (!ex.name.trim() || (!(pct > 0) && !(amount > 0))) { toast('경비 이름과, 노무비의 % 또는 금액 가운데 하나를 적어 주세요'); return }
    void done(run(() => api.addIlwiLines([{ item_id: item.id, kind: 'expense', ref_code: null, name: ex.name.trim(), spec: pct > 0 ? `노무비의 ${pct}%` : '', unit: pct > 0 ? '%' : '식', qty: pct > 0 ? 0 : 1, unit_price: pct > 0 ? null : amount, pct: pct > 0 ? pct : null }]), '경비 줄을 넣었습니다')).then(ok => ok && setEx({ name: '공구손료', pct: '', amount: '' }))
  }
  return (
    <div className="ilwi-box">
      {item.basis && <p className="t-cap">근거: {item.basis}</p>}
      {lines.length === 0 ? <p className="t-cap">아직 줄이 없습니다.</p> : (
        <table className="table ilwi-lines">
          <thead><tr><th>구분</th><th>기호 · 직종</th><th>이름</th><th>규격</th><th className="num">수량</th><th>단위</th><th className="num">단가</th><th className="num">금액</th><th>단가 출처</th>{admin && <th />}</tr></thead>
          <tbody>{(['material', 'labor', 'expense'] as IlwiKind[]).flatMap(k => lines.filter(l => l.kind === k).map(l => (
            <tr key={l.id}>
              <td className="nowrap">{ILWI_KINDS[l.kind]}</td><td className="nowrap strong">{l.ref_code ?? ''}</td><td>{l.name}</td><td className="max t-cap">{l.spec}</td>
              <td className="num">{l.pct != null ? `${l.pct}%` : admin
                ? <input className="input xs design-qty" defaultValue={l.qty} inputMode="decimal" aria-label={`${l.name} 수량`} disabled={busy} onBlur={e => { const v = Number(e.target.value); if (v >= 0 && v !== l.qty) void done(run(() => api.updateIlwiLine(l.id, { qty: v }))) }} />
                : l.qty}</td>
              <td>{l.pct != null ? '' : l.unit}</td>
              <td className={`num${l.pct == null && l.price == null ? ' red' : ''}`}>{l.pct != null ? '' : l.price == null ? '단가 없음' : won(l.price)}</td>
              <td className="num">{l.pct != null ? won(Math.round((l.pct / 100) * t.labor)) : won(l.amount)}</td>
              <td className="t-cap">{l.pct != null ? '노무비 기준' : [l.price_source, l.price_date].filter(Boolean).join(' · ')}</td>
              {admin && <td><Button size="sm" kind="ghost" disabled={busy} aria-label={`${l.name} 줄 지우기`} onClick={async () => { if (await confirmDelete(`일위대가의 '${l.name}' 줄을`)) void done(run(() => api.deleteIlwiLine(l.id), '지웠습니다')) }}>지우기</Button></td>}
            </tr>)))}
            <tr className="ilwi-sum"><td colSpan={7} className="num">재료비 {won(t.material)} · 노무비 {won(t.labor)} · 경비 {won(t.expense)}</td><td className="num strong">{won(t.total)}</td><td className="t-cap">원/{item.unit}</td>{admin && <td />}</tr>
          </tbody>
        </table>)}
      {admin && <div className="ilwi-add">
        <div className="ilwi-add-row"><b>재료</b><input className="input design-qty" value={qty} onChange={e => setQty(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="소요량" aria-label="재료 소요량" /><span className="t-cap">소요량을 적고 아래에서 물가 기준을 고르면 들어갑니다 (할증 포함 수량으로)</span></div>
        <DesignPriceRefPick base={NO_BASE} onPick={pickMaterial} />
        <div className="ilwi-add-row"><b>노무</b>
          <select className="select" value={job} onChange={e => setJob(e.target.value)} aria-label="직종"><option value="">직종</option>{rates.map(w => <option key={w.code} value={w.code}>{w.name} · {won(w.wage)}원/일</option>)}</select>
          <input className="input design-qty" value={man} onChange={e => setMan(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="품 (인)" aria-label="품" />
          <Button size="sm" kind="outline" disabled={busy} onClick={addLabor}>노무 넣기</Button></div>
        <div className="ilwi-add-row"><b>경비</b>
          <input className="input" value={ex.name} onChange={e => setEx({ ...ex, name: e.target.value })} placeholder="이름" aria-label="경비 이름" />
          <input className="input design-qty" value={ex.pct} onChange={e => setEx({ ...ex, pct: e.target.value.replace(/[^\d.]/g, ''), amount: '' })} inputMode="decimal" placeholder="노무비의 %" aria-label="노무비의 퍼센트" />
          <input className="input design-qty" value={ex.amount} onChange={e => setEx({ ...ex, amount: e.target.value.replace(/\D/g, ''), pct: '' })} inputMode="numeric" placeholder="또는 금액" aria-label="경비 금액" />
          <Button size="sm" kind="outline" disabled={busy} onClick={addExpense}>경비 넣기</Button></div>
        <div className="ilwi-add-row"><span className="design-gap" /><Button size="sm" kind="ghost" disabled={busy} onClick={async () => { if (await confirmDelete(`일위대가 ${item.code} '${item.name}' 항목과 그 줄 전체를`)) void run(() => api.deleteIlwiItem(item.id), '항목을 지웠습니다').then(ok => { if (ok) { onClosed(); bump() } }) }}>이 항목 지우기</Button></div>
      </div>}
    </div>
  )
}

function Market({ admin, onMade }: { admin: boolean; onMade(): void }) {
  const { api, bump } = useApp()
  const { run, busy } = useAction()
  const [group, setGroup] = useState('BC')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const t = window.setTimeout(() => setQ(search), 350); return () => window.clearTimeout(t) }, [search])
  const { data, loading } = useAsync(() => api.listPriceRefs(q, group), [q, group], { rows: [] as PriceRef[], total: 0 })
  const take = (r: PriceRef) => run(async () => {
    const m = fromMarketRef(r, nextIlwiCode((await api.listIlwiItems()).map(i => i.code)))
    const id = await api.saveIlwiItem(null, m.item)
    await api.addIlwiLines(m.lines.map(l => ({ ...l, item_id: id })))
    bump(); onMade()
  }, `${r.item} 을(를) 일위대가로 가져왔습니다`)
  return (
    <>
      <div className="row wrap" role="group" aria-label="시공 단가 묶음">
        {[['BC', '건축'], ['MC', '기계설비'], ['CC', '토목']].map(([k, name]) => <button type="button" key={k} className={`chip${group === k ? ' active' : ''}`} onClick={() => setGroup(k)}>{name} 시공</button>)}
        <span className="design-gap" />
        <input className="input design-filter" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="기호 · 항목 · 규격 찾기" aria-label="시공 단가 찾기" />
      </div>
      <p className="t-cap">조달청 시장시공가격 {data.total.toLocaleString('ko-KR')}건{data.total > data.rows.length ? ` 중 ${data.rows.length}건` : ''} · 재료 · 노무 · 경비가 나뉜 시공 단가라 그대로 일위대가로 쓸 수 있습니다(이윤 · 현장 조건 제외 · 부가세 별도).{admin ? " '가져오기'를 누르면 그 금액으로 일위대가 항목이 만들어집니다." : ''}</p>
      {loading ? <p className="t-cap" role="status">불러오고 있습니다.</p> : data.rows.length === 0 ? <Empty>맞는 시공 단가가 없습니다.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>기호</th><th>항목</th><th>규격</th><th>단위</th><th className="num">재료비</th><th className="num">노무비</th><th className="num">경비</th><th className="num">합계</th><th>기준일</th>{admin && <th />}</tr></thead>
          <tbody>{data.rows.map(r => <tr key={r.id}><td className="nowrap strong">{r.code}</td><td>{r.item}</td><td className="max">{r.spec}</td><td>{r.unit}</td><td className="num">{won(r.material)}</td><td className="num">{won(r.labor)}</td><td className="num">{won(r.expense)}</td><td className="num strong">{won(r.price)}</td><td className="nowrap">{r.notice_date ?? ''}</td>
            {admin && <td><Button size="sm" kind="ghost" disabled={busy} onClick={() => void take(r)}>가져오기</Button></td>}</tr>)}</tbody>
        </table></div>)}
    </>
  )
}

function Labor() {
  const { api } = useApp()
  const { data: rates, loading } = useAsync(() => api.listLaborRates(), [], [] as LaborRate[])
  const [find, setFind] = useState('')
  const shown = rates.filter(w => !find.trim() || `${w.code} ${w.name}`.includes(find.trim()))
  return (
    <>
      <div className="row wrap"><input className="input design-filter" type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="직종 찾기" aria-label="직종 찾기" /><span className="t-cap">{shown.length}개 직종 · 1일 8시간 기준 · {rates[0] ? `${rates[0].source} (${rates[0].as_of} 적용)` : ''}</span></div>
      {loading ? <p className="t-cap" role="status">불러오고 있습니다.</p> : shown.length === 0 ? <Empty>노임단가가 없습니다.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>번호</th><th>직종</th><th className="num">노임단가 (원/일)</th><th>적용일</th><th>비고</th></tr></thead>
          <tbody>{shown.map(w => <tr key={w.code}><td className="nowrap strong">{w.code}</td><td>{w.name}</td><td className="num">{won(w.wage)}</td><td className="nowrap">{w.as_of}</td><td className="t-cap">{w.low_sample ? '조사 현장 5곳 미만' : ''}</td></tr>)}</tbody>
        </table></div>)}
    </>
  )
}
