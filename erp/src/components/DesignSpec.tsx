// Spec book step (Programa pattern): one list, table/card views, group by book or location, per-item status, print + CSV.
// Five books per the learned standard. No prices here.
import { useMemo, useRef, useState } from 'react'
import { Badge, Button, Empty } from './ui'
import { useAction, useApp, useAsync } from '../lib/app'
import { SPEC_BOOKS, SPEC_STATUS, type DesignMaterial, type DesignProject, type SpecBook, type SpecItem } from '../lib/design'

export function DesignSpec({ project }: { project: DesignProject }) {
  const { api, version, toast } = useApp()
  const { run, busy } = useAction()
  const { data: items } = useAsync(() => api.listSpecItems(project.id), [project.id, version], [] as SpecItem[])
  const [view, setView] = useState<'table' | 'card'>('table')
  const [by, setBy] = useState<'book' | 'location'>('book')
  const [book, setBook] = useState<SpecBook>('materials')
  const [q, setQ] = useState('')
  const { data: found } = useAsync(() => (q.trim().length >= 2 ? api.listDesignMaterials(q) : Promise.resolve([] as DesignMaterial[])), [q], [] as DesignMaterial[])
  const [d, setD] = useState({ code: '', name: '', spec: '', location: '', maker: '' })
  const sheet = useRef<HTMLDivElement>(null)
  const live = items.filter(i => i.status !== 'dropped')
  const groups = useMemo(() => {
    const m = new Map<string, SpecItem[]>()
    for (const i of items) { const k = by === 'book' ? SPEC_BOOKS[i.book] : i.location || '위치 미정'; m.set(k, [...(m.get(k) ?? []), i]) }
    return [...m.entries()]
  }, [items, by])
  const add = (row: Partial<SpecItem> & { name: string }) => run(() => api.addSpecItem({ project_id: project.id, book, code: null, spec: null, location: null, maker: null, material_id: null, qty: null, unit: null, product_url: null, note: null, status: 'review', ...row }), '스펙북에 넣었습니다')
  const fromMaterial = (m: DesignMaterial) => add({ name: m.name, code: m.color_code, spec: m.spec, unit: m.unit, material_id: m.id, product_url: m.product_url, note: m.notes })
  const csv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const text = '﻿' + [['구분', '코드', '품명', '규격', '위치', '제조사', '수량', '단위', '상태', '비고'], ...live.map(i => [SPEC_BOOKS[i.book], i.code, i.name, i.spec, i.location, i.maker, i.qty, i.unit, SPEC_STATUS[i.status], i.note])].map(r => r.map(esc).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `스펙북_${project.code ?? ''}.csv`; document.body.appendChild(a); a.click(); a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  const print = () => {
    const win = window.open('', '_blank')
    if (!win || !sheet.current) { toast('인쇄 창을 열지 못했습니다. 팝업 차단을 풀어 주세요'); return }
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${project.code ?? ''} 스펙북</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:'Pretendard','Noto Sans KR',sans-serif;font-size:9pt;color:#111}h1{font-size:16pt;margin:0 0 2mm}h2{font-size:11pt;margin:6mm 0 2mm;border-left:3pt solid #111;padding-left:2mm}table{width:100%;border-collapse:collapse}th,td{border:0.4pt solid #999;padding:1.5mm 2mm;text-align:left;vertical-align:top}th{background:#eee}p{color:#555;margin:0 0 3mm}</style></head><body>${sheet.current.innerHTML}</body></html>`)
    win.document.close(); window.setTimeout(() => win.print(), 400)
  }
  const tone = (s: SpecItem['status']) => (s === 'confirmed' ? 'blue' : s === 'selected' ? 'yellow' : s === 'dropped' ? 'gray' : 'outline')
  const next: Record<SpecItem['status'], SpecItem['status']> = { review: 'selected', selected: 'confirmed', confirmed: 'review', dropped: 'review' }
  return (
    <div className="design-block">
      <div className="design-plan-bar">
        <b className="t-bodyb">스펙북 · {live.length}개</b>
        <button type="button" className={`chip${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>표</button>
        <button type="button" className={`chip${view === 'card' ? ' active' : ''}`} onClick={() => setView('card')}>카드</button>
        <button type="button" className={`chip${by === 'book' ? ' active' : ''}`} onClick={() => setBy('book')}>종류별</button>
        <button type="button" className={`chip${by === 'location' ? ' active' : ''}`} onClick={() => setBy('location')}>위치별</button>
        <span className="design-gap" />
        <Button size="sm" kind="outline" disabled={!live.length} onClick={csv}>엑셀용 파일(CSV)</Button>
        <Button size="sm" disabled={!live.length} onClick={print}>PDF로 인쇄</Button>
      </div>
      <div className="design-add" aria-label="스펙 넣기">
        <select className="select" value={book} onChange={e => setBook(e.target.value as SpecBook)} aria-label="스펙북 종류">{(Object.keys(SPEC_BOOKS) as SpecBook[]).map(k => <option key={k} value={k}>{SPEC_BOOKS[k]}</option>)}</select>
        <input className="input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="자재 목록에서 찾아 넣기 (2글자 이상)" aria-label="자재 찾기" />
        {found.slice(0, 8).map(m => <button type="button" key={m.id} className="chip" disabled={busy} onClick={() => fromMaterial(m)} title={m.spec ?? ''}>+ {m.color_code ? `${m.color_code} ` : ''}{m.name}</button>)}
      </div>
      <form className="design-add" aria-label="직접 넣기" onSubmit={e => { e.preventDefault(); if (d.name.trim()) add({ name: d.name.trim(), code: d.code.trim() || null, spec: d.spec.trim() || null, location: d.location.trim() || null, maker: d.maker.trim() || null }).then(ok => ok && setD({ ...d, code: '', name: '', spec: '' })) }}>
        <input className="input design-qty" value={d.code} onChange={e => setD({ ...d, code: e.target.value })} placeholder="코드" aria-label="코드" />
        <input className="input" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="품명 (직접 넣기)" aria-label="품명" required />
        <input className="input" value={d.spec} onChange={e => setD({ ...d, spec: e.target.value })} placeholder="규격" aria-label="규격" />
        <input className="input" value={d.location} onChange={e => setD({ ...d, location: e.target.value })} placeholder="위치" aria-label="위치" />
        <input className="input" value={d.maker} onChange={e => setD({ ...d, maker: e.target.value })} placeholder="제조사" aria-label="제조사" />
        <Button type="submit" kind="outline" disabled={busy}>넣기</Button>
      </form>
      {items.length === 0 ? <Empty>아직 스펙이 없습니다. 위에서 자재 목록을 찾아 넣거나 직접 넣으세요.</Empty> : groups.map(([name, rows]) => (
        <section key={name} className="design-spec-group">
          <h3 className="t-bodyb">{name} <span className="t-cap">{rows.length}</span></h3>
          {view === 'table' ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>코드</th><th>품명</th><th>규격</th><th>{by === 'book' ? '위치' : '종류'}</th><th>제조사</th><th>상태</th><th /></tr></thead>
              <tbody>{rows.map(i => <tr key={i.id} className={i.status === 'dropped' ? 'design-off' : ''}>
                <td className="nowrap strong">{i.code}</td><td>{i.product_url ? <a href={i.product_url} target="_blank" rel="noreferrer">{i.name}</a> : i.name}</td><td className="max">{i.spec}</td>
                <td>{by === 'book' ? <input className="input xs design-sec" defaultValue={i.location ?? ''} aria-label={`${i.name} 위치`} onBlur={e => { const v = e.target.value.trim() || null; if (v !== i.location) run(() => api.updateSpecItem(i.id, { location: v })) }} /> : SPEC_BOOKS[i.book]}</td>
                <td>{i.maker}</td>
                <td><button type="button" className="design-status" disabled={busy} title="눌러서 다음 상태로" onClick={() => run(() => api.updateSpecItem(i.id, { status: next[i.status] }))}><Badge tone={tone(i.status)}>{SPEC_STATUS[i.status]}</Badge></button></td>
                <td className="nowrap">{i.status !== 'dropped' && <Button size="sm" kind="ghost" disabled={busy} onClick={() => run(() => api.updateSpecItem(i.id, { status: 'dropped' }))}>제외</Button>}<Button size="sm" kind="ghost" disabled={busy} onClick={() => run(() => api.deleteSpecItem(i.id))} aria-label={`${i.name} 지우기`}>지우기</Button></td>
              </tr>)}</tbody>
            </table></div>
          ) : (
            <ul className="design-spec-cards">{rows.map(i => <li key={i.id} className={i.status === 'dropped' ? 'design-off' : ''}>
              <div className="row"><b className="design-spec-code">{i.code ?? '—'}</b><Badge tone={tone(i.status)}>{SPEC_STATUS[i.status]}</Badge></div>
              <b>{i.name}</b><span className="t-cap">{[i.spec, i.maker, i.location].filter(Boolean).join(' · ')}</span>
            </li>)}</ul>
          )}
        </section>
      ))}
      <p className="t-cap">상태는 검토 → 선정 → 확정 순서입니다(눌러서 바꿈). '제외'한 항목은 인쇄 · 내보내기에서 빠집니다. 금액은 스펙북에 넣지 않습니다.</p>
      <div ref={sheet} hidden>
        <h1>{project.name} — SPEC BOOK</h1><p>{[project.code, project.client_name, new Date().toISOString().slice(0, 10)].filter(Boolean).join(' · ')} · 주식회사 아트리어디자인스튜디오</p>
        {(Object.keys(SPEC_BOOKS) as SpecBook[]).filter(k => live.some(i => i.book === k)).map(k => <div key={k}><h2>{SPEC_BOOKS[k]}</h2><table><thead><tr><th>코드</th><th>품명</th><th>규격</th><th>위치</th><th>제조사</th><th>상태</th><th>비고</th></tr></thead>
          <tbody>{live.filter(i => i.book === k).map(i => <tr key={i.id}><td>{i.code}</td><td>{i.name}</td><td>{i.spec}</td><td>{i.location}</td><td>{i.maker}</td><td>{SPEC_STATUS[i.status]}</td><td>{i.note}</td></tr>)}</tbody></table></div>)}
      </div>
    </div>
  )
}
