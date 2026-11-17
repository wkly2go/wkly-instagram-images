// Spec book step (Programa pattern): one list, table/card views, group by book or location, per-item status, print + CSV.
// Five books per the learned standard. No prices here.
// Photo-first (Houzz Pro selections): every row and card shows the product photo; click, drop or paste an image to set it.
// Renaming a code · name · spec here also rewrites the plan's finish references (lib/designSpecSync) so drawings, 3D and quantities follow.
import { useEffect, useMemo, useRef, useState, type DragEvent, type FocusEvent } from 'react'
import { ImagePlus } from 'lucide-react'
import { Badge, Button, Empty } from './ui'
import { useAction, useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { SPEC_BOOKS, SPEC_STATUS, type DesignMaterial, type DesignProject, type SpecBook, type SpecItem } from '../lib/design'
import { planQuantities, type PlanGeometry } from '../lib/designPlan'
import { confirmDelete } from './DesignWorkspace'
import { readBoard } from '../lib/designBoard'
import { normCode, renameBoardFinishRefs, renameFinishRefs } from '../lib/designSpecSync'
import { makeImagePreview } from '../lib/imagePreview'
import './DesignSpec.css'

/** 제품 사진 파일 → 작게 줄인 data URL (스펙북 · 제안 보드가 같이 쓴다 · 저장은 api.setSpecImage) */
export async function specPhotoData(file: Blob): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('사진 파일(JPG · PNG)만 넣을 수 있습니다')
  const blob = await makeImagePreview(file)
  if (!blob) throw new Error('사진을 읽지 못했습니다. JPG · PNG 파일로 다시 올려 주세요')
  return await new Promise<string>((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => no(fr.error); fr.readAsDataURL(blob) })
}
/** 끌어 놓기 · 붙여 넣기 자료에서 사진 파일 하나 */
export function imageFileOf(dt: DataTransfer | null | undefined): File | null {
  if (!dt) return null
  for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith('image/')) return f
  for (const it of Array.from(dt.items ?? [])) if (it.kind === 'file' && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) return f }
  return null
}
export const hasFiles = (dt: DataTransfer | null | undefined) => !!dt && Array.from(dt.types ?? []).includes('Files')

const PHOTO_TIP = '누르면 사진을 고릅니다. 사진 파일을 끌어 놓거나, 이 줄에 마우스를 올린 채 Ctrl+V 로 붙여 넣어도 됩니다.'

function SpecPhoto({ item, src, busy, over, size, onFile, onClear }: { item: SpecItem; src?: string; busy: boolean; over: boolean; size: 'sm' | 'lg'; onFile(f: File): void; onClear(): void }) {
  const input = useRef<HTMLInputElement>(null)
  const choose = () => input.current?.click()
  return (
    <div className={`dsp-photo ${size}${src ? ' has' : ''}${over ? ' over' : ''}${busy ? ' busy' : ''}`} title={PHOTO_TIP}>
      {src ? <button type="button" className="dsp-photo-img" onClick={choose} aria-label={`${item.name} 사진 바꾸기`} disabled={busy}><img src={src} alt={`${item.name} 사진`} draggable={false} /></button>
        : <button type="button" className="dsp-photo-add" disabled={busy} onClick={choose} aria-label={`${item.name} 사진 넣기`}><ImagePlus size={size === 'lg' ? 14 : 13} /><span>사진 넣기</span></button>}
      {src && !busy && <span className="dsp-photo-acts"><button type="button" onClick={choose}>바꾸기</button><button type="button" onClick={onClear}>지우기</button></span>}
      {busy && <span className="dsp-photo-busy" role="status">넣는 중…</span>}
      {over && !busy && <span className="dsp-photo-drop">{size === 'lg' ? '여기에 놓기' : '놓기'}</span>}
      <input ref={input} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
    </div>
  )
}

export function DesignSpec({ project }: { project: DesignProject }) {
  const { api, version, toast, bump } = useApp()
  const { run, busy } = useAction()
  const { data: items } = useAsync(() => api.listSpecItems(project.id).then(l => l.map(s => ({ ...s }))), [project.id, version], [] as SpecItem[])
  const [view, setView] = useState<'table' | 'card'>('table')
  const [by, setBy] = useState<'book' | 'location'>('book')
  const [book, setBook] = useState<SpecBook>('materials')
  const [q, setQ] = useState('')
  const { data: found } = useAsync(() => (q.trim().length >= 2 ? api.listDesignMaterials(q) : Promise.resolve([] as DesignMaterial[])), [q], [] as DesignMaterial[])
  const [d, setD] = useState({ code: '', name: '', spec: '', location: '', maker: '' })
  const sheet = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<string | null>(null)
  const { data: images } = useAsync(() => api.listSpecImages(project.id), [project.id, version], {} as Record<string, string>)
  // 방금 넣거나 지운 사진은 다시 불러오기 전에도 바로 보여 준다
  const [mine, setMine] = useState<Record<string, string | null>>({})
  useEffect(() => setMine({}), [images])
  const img = (id: string) => (id in mine ? mine[id] ?? undefined : images[id])
  const [photoBusy, setPhotoBusy] = useState<Record<string, boolean>>({})
  const [dragOn, setDragOn] = useState<string | null>(null)
  const { data: plan } = useAsync(() => api.getDesignPlan(project.id), [project.id, version], null as PlanGeometry | null)
  const rooms = plan?.rooms ?? [], lightCodes = [...new Set(items.filter(i => i.book === 'lighting' && i.status !== 'dropped' && i.code).map(i => i.code!))]
  // Save onto the latest plan, not the copy loaded with this screen, so plan edits made meanwhile are kept.
  const setLight = (roomId: string, code: string, n: number) => run(async () => { const p = await api.getDesignPlan(project.id); if (!p?.rooms) throw new Error('평면이 없습니다. 평면 · 3D 에서 실을 먼저 추가해 주세요'); await api.saveDesignPlan(project.id, { ...p, rooms: p.rooms.map(r => (r.id === roomId ? { ...r, lights: { ...r.lights, [code]: n } } : r)) }) })
  const total = (code: string) => rooms.reduce((a, r) => a + (r.lights?.[code] ?? 0), 0)

  // ── 제품 사진 ────────────────────────────────────────────
  const setPhoto = async (i: SpecItem, file: File | null) => {
    setPhotoBusy(b => ({ ...b, [i.id]: true }))
    try {
      const data = file ? await specPhotoData(file) : null
      await api.setSpecImage(project.id, i.id, data)
      setMine(m => ({ ...m, [i.id]: data }))
      bump()
      toast(file ? `${i.code ?? i.name} 사진을 넣었습니다` : `${i.code ?? i.name} 사진을 지웠습니다`)
    } catch (e) { toast(friendlyError(e)) } finally { setPhotoBusy(b => { const n = { ...b }; delete n[i.id]; return n }) }
  }
  const pick = (i: SpecItem, file: File | undefined) => { if (file) void setPhoto(i, file) }
  const clearPhoto = (i: SpecItem) => { if (window.confirm(`${i.code ?? i.name} 사진을 지울까요?`)) void setPhoto(i, null) }
  // 붙여 넣기: 마우스를 올린 줄 · 카드, 없으면 키보드로 고른 줄 · 카드에 넣는다
  const hoverId = useRef<string | null>(null), focusId = useRef<string | null>(null)
  const itemsRef = useRef(items), setPhotoRef = useRef(setPhoto)
  itemsRef.current = items; setPhotoRef.current = setPhoto
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const f = imageFileOf(e.clipboardData)
      if (!f) return
      const id = hoverId.current ?? focusId.current, item = id ? itemsRef.current.find(x => x.id === id) : null
      if (!item) return
      e.preventDefault()
      void setPhotoRef.current(item, f)
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  }, [])
  /** 줄 · 카드 하나에 붙는 사진 끌어 놓기 · 붙여 넣기 대상 표시 */
  const target = (i: SpecItem) => ({
    tabIndex: 0,
    onMouseEnter: () => { hoverId.current = i.id },
    onMouseLeave: () => { if (hoverId.current === i.id) hoverId.current = null },
    onFocus: () => { focusId.current = i.id },
    onBlur: (e: FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && focusId.current === i.id) focusId.current = null },
    onDragOver: (e: DragEvent<HTMLElement>) => { if (!hasFiles(e.dataTransfer)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; if (dragOn !== i.id) setDragOn(i.id) },
    onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOn(o => (o === i.id ? null : o)) },
    onDrop: (e: DragEvent<HTMLElement>) => { if (!hasFiles(e.dataTransfer)) return; e.preventDefault(); e.stopPropagation(); setDragOn(null); const f = imageFileOf(e.dataTransfer); if (f) void setPhoto(i, f); else toast('사진 파일(JPG · PNG)만 넣을 수 있습니다') },
  })
  const photo = (i: SpecItem, size: 'sm' | 'lg') => <SpecPhoto item={i} src={img(i.id)} busy={!!photoBusy[i.id]} over={dragOn === i.id} size={size} onFile={f => void setPhoto(i, f)} onClear={() => clearPhoto(i)} />

  // ── 번호 · 품명 · 규격 고치기 → 평면 · 보드의 마감 글도 함께 ──
  const IDENT = [['code', '코드'], ['name', '품명'], ['spec', '규격']] as const
  const rename = (i: SpecItem, k: 'code' | 'name' | 'spec', raw: string, el: HTMLInputElement) => {
    const v = raw.trim() || null
    if (v === (i[k] ?? null)) return
    if (k === 'name' && !v) { toast('품명은 비울 수 없습니다'); el.value = i.name; return }
    if (k === 'code' && v && items.some(x => x.id !== i.id && x.status !== 'dropped' && normCode(x.code) === normCode(v)) && !window.confirm(`${v} 번호를 이미 쓰는 항목이 있습니다. 그래도 바꿀까요? 평면에서는 두 항목이 같은 번호로 묶입니다.`)) { el.value = i.code ?? ''; return }
    if (k === 'code' && !v && i.code && !window.confirm(`번호를 비우면 평면 · 보드에서 ${i.code} 로 연결된 마감은 그대로 남고 이 항목과의 연결이 끊깁니다. 비울까요?`)) { el.value = i.code; return }
    const next = { code: i.code, name: i.name, spec: i.spec, [k]: v }
    void run(async () => {
      await api.updateSpecItem(i.id, { [k]: v })
      let n = 0, m = 0, q = ''
      let renamed: PlanGeometry | null = null, before: PlanGeometry | null = null
      try {
        const p = await api.getDesignPlan(project.id)
        if (p) { const r = renameFinishRefs(p, i, next); if (r.changed) { await api.saveDesignPlan(project.id, r.plan); n = r.changed; renamed = r.plan; before = p } }
      } catch { throw new Error('스펙은 바꿨지만 평면의 마감 번호는 바꾸지 못했습니다. 평면 · 3D 에서 확인해 주세요') }
      // 수량표 · 견적까지 잇기 (대표 지시 2026-11-17 '하나만 수정해도 모두 연동'): 이미 수량을 쓰는 프로젝트이고 수량 줄의 이름이 바뀌었으면
      // 새 모델 버전으로 반영한다. 견적은 수량이 견적과 달라지면 작업 공간(Design.tsx useAutoEstimate)이 자동으로 다시 계산을 요청한다.
      if (renamed && before && project.model_version > 0) {
        const lines = planQuantities(renamed)
        if (lines.length && JSON.stringify(lines) !== JSON.stringify(planQuantities(before))) {
          try { await api.applyDesignPlan(project.id, renamed, lines); q = '수량표에도 반영했습니다' }
          catch (e) { q = `수량표에는 반영하지 못했습니다 (${friendlyError(e)})` }
        }
      }
      try {
        const row = await api.getProposalBoard(project.id), b = row ? readBoard(row.board) : null
        if (b) { const r = renameBoardFinishRefs(b, i, next); if (r.changed) { await api.saveProposalBoard(project.id, r.board); m = r.changed } }
      } catch { /* 보드는 없어도 된다 · 견본 글은 보드에서 다시 고를 수 있다 */ }
      const label = { code: '코드', name: '품명', spec: '규격' }[k]
      toast([`${label}를 바꿨습니다`, n ? `평면의 마감 ${n}곳도 바꿨습니다` : '', q, m ? `제안 보드 견본 ${m}곳도 바꿨습니다` : ''].filter(Boolean).join(' · '))
      if (q === '수량표에도 반영했습니다') bump()
    })
  }

  const DETAIL = [['finish', 'FINISH (마감 · 색)'], ['size', 'SIZE (크기)'], ['maker', 'MANUFAC. / ORIGIN (제조사 · 원산지)'], ['distributor', 'DISTRIBUTOR (납품 업체)'], ['contact', 'CONNECT NO. (담당 · 연락처)'], ['delivery', 'DELIVERY (납기)'], ['stock', 'STOCK (재고 · 수량)'], ['note', '비고']] as const
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
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${project.code ?? ''} 스펙북</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:'Pretendard','Noto Sans KR',sans-serif;font-size:9pt;color:#111}h1{font-size:16pt;margin:0 0 2mm}h2{font-size:11pt;margin:6mm 0 2mm;border-left:3pt solid #111;padding-left:2mm}table{width:100%;border-collapse:collapse}th,td{border:0.4pt solid #999;padding:1.5mm 2mm;text-align:left;vertical-align:top}th{background:#eee}p{color:#555;margin:0 0 3mm}.cards{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.card{break-inside:avoid}.card .code{font-size:11pt;text-align:right;background:#111;color:#fff}.card .l{width:32%;color:#555}.thumb{width:16mm;height:12mm;object-fit:cover;display:block}</style></head><body>${sheet.current.innerHTML}</body></html>`)
    win.document.close(); window.setTimeout(() => win.print(), 400)
  }
  const tone = (s: SpecItem['status']) => (s === 'confirmed' ? 'blue' : s === 'selected' ? 'yellow' : s === 'dropped' ? 'gray' : 'outline')
  const next: Record<SpecItem['status'], SpecItem['status']> = { review: 'selected', selected: 'confirmed', confirmed: 'review', dropped: 'review' }
  const withPhoto = live.filter(i => img(i.id)).length
  return (
    <div className="design-block dsp" onDragOver={e => { if (hasFiles(e.dataTransfer)) e.preventDefault() }} onDrop={e => { if (hasFiles(e.dataTransfer)) { e.preventDefault(); setDragOn(null); toast('사진을 넣을 항목의 줄이나 카드 위에 놓아 주세요') } }}>
      <div className="design-plan-bar">
        <b className="t-bodyb">스펙북 · {live.length}개</b>
        <span className="dsp-count" title="사진이 있는 항목 수">사진 {withPhoto}/{live.length}</span>
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
      {items.length > 0 && <p className="dsp-tip">제품 사진은 줄 맨 앞 칸을 누르거나, 사진 파일을 줄 · 카드 위에 끌어 놓거나, 줄에 마우스를 올린 채 Ctrl+V 로 붙여 넣으면 들어갑니다. 넣은 사진은 제안 보드의 스펙 카드에도 바로 나옵니다.</p>}
      {items.length === 0 ? <Empty>아직 스펙이 없습니다. 위에서 자재 목록을 찾아 넣거나 직접 넣으세요.</Empty> : groups.map(([name, rows]) => (
        <section key={name} className="design-spec-group">
          <h3 className="t-bodyb">{name} <span className="t-cap">{rows.length}</span></h3>
          {view === 'table' ? (
            <div className="table-wrap"><table className="table dsp-table">
              <thead><tr><th className="dsp-photo-col">사진</th><th>코드</th><th>품명</th><th>규격</th><th>{by === 'book' ? '위치' : '종류'}</th><th>제조사</th><th>상태</th><th /></tr></thead>
              <tbody>{rows.map(i => <tr key={i.id} className={`dsp-row${i.status === 'dropped' ? ' design-off' : ''}${dragOn === i.id ? ' dsp-over' : ''}`} {...target(i)}>
                <td className="dsp-photo-col">{photo(i, 'sm')}</td>
                <td className="nowrap strong">{i.code}</td><td>{i.product_url ? <a href={i.product_url} target="_blank" rel="noreferrer">{i.name}</a> : i.name}</td><td className="max">{i.spec}</td>
                <td>{by === 'book' ? <input className="input xs design-sec" defaultValue={i.location ?? ''} aria-label={`${i.name} 위치`} onBlur={e => { const v = e.target.value.trim() || null; if (v !== i.location) run(() => api.updateSpecItem(i.id, { location: v })) }} /> : SPEC_BOOKS[i.book]}</td>
                <td>{i.maker}</td>
                <td><button type="button" className="design-status" disabled={busy} title="눌러서 다음 상태로" onClick={() => run(() => api.updateSpecItem(i.id, { status: next[i.status] }))}><Badge tone={tone(i.status)}>{SPEC_STATUS[i.status]}</Badge></button></td>
                <td className="nowrap">{i.status !== 'dropped' && <Button size="sm" kind="ghost" disabled={busy} onClick={() => run(() => api.updateSpecItem(i.id, { status: 'dropped' }))}>제외</Button>}<Button size="sm" kind="ghost" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>상세</Button><Button size="sm" kind="ghost" disabled={busy} onClick={async () => { if (await confirmDelete(`스펙북의 '${i.name}' 항목을`)) void run(() => api.deleteSpecItem(i.id)) }} aria-label={`${i.name} 지우기`}>지우기</Button></td>
              </tr>).flatMap((tr, n) => { const i = rows[n]; return open === i.id ? [tr, <tr key={`${i.id}-d`} className="dsp-detail" {...target(i)} tabIndex={-1}><td colSpan={8}>
                <div className="design-add dsp-ident" aria-label={`${i.name} 번호 · 이름 고치기`}>{IDENT.map(([k, label]) => <label key={k} className="design-spec-f"><span className="t-cap">{label}{k === 'code' ? ' (고치면 평면 · 3D · 수량의 마감 번호도 함께 바뀝니다)' : ''}</span><input key={`${i.id}-${k}-${i[k] ?? ''}`} className="input" defaultValue={i[k] ?? ''} aria-label={`${i.name} ${label}`} disabled={busy}
                  onBlur={e => rename(i, k, e.target.value, e.target)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur() } }} /></label>)}</div>
                <div className="design-add">{DETAIL.map(([k, label]) => <label key={k} className="design-spec-f"><span className="t-cap">{label}</span><input className="input" defaultValue={i[k] ?? ''} onBlur={e => { const v = e.target.value.trim() || null; if (v !== (i[k] ?? null)) run(() => api.updateSpecItem(i.id, { [k]: v })) }} /></label>)}
                  <div className="design-spec-f"><span className="t-cap">SAMPLE / IMAGE (샘플 사진 · 작게 줄여 보관)</span><div className="row">
                    {img(i.id) && <img className="design-spec-img" src={img(i.id)} alt={`${i.name} 샘플`} />}
                    <input type="file" accept="image/*" aria-label={`${i.name} 샘플 사진`} disabled={!!photoBusy[i.id]} onChange={e => { pick(i, e.target.files?.[0]); e.target.value = '' }} />
                    {img(i.id) && <Button size="sm" kind="ghost" disabled={!!photoBusy[i.id]} onClick={() => clearPhoto(i)}>사진 지우기</Button>}
                  </div></div>
                </div></td></tr>] : [tr] })}</tbody>
            </table></div>
          ) : (
            <ul className="design-spec-cards dsp-cards">{rows.map(i => <li key={i.id} className={`${i.status === 'dropped' ? 'design-off' : ''}${dragOn === i.id ? ' dsp-over' : ''}`} {...target(i)}>
              {photo(i, 'lg')}
              <div className="row"><b className="design-spec-code">{i.code ?? '—'}</b><button type="button" className="design-status" disabled={busy} title="눌러서 다음 상태로" onClick={() => run(() => api.updateSpecItem(i.id, { status: next[i.status] }))}><Badge tone={tone(i.status)}>{SPEC_STATUS[i.status]}</Badge></button></div>
              <b>{i.name}</b><span className="t-cap">{[i.spec, i.maker, i.location].filter(Boolean).join(' · ')}</span>
            </li>)}</ul>
          )}
        </section>
      ))}
      {lightCodes.length > 0 && <section className="design-spec-group" aria-label="조명 수량표">
        <h3 className="t-bodyb">조명 수량표 <span className="t-cap">실 × 조명 기호 (표본 스펙북 '총계' 양식) · 여기 수량은 '평면 · 3D'의 수량에 조명 기구로 들어갑니다</span></h3>
        {rooms.length === 0 ? <Empty>'평면 · 3D' 단계의 '실별 마감'에서 실을 추가하면 여기에서 실마다 조명 수량을 적을 수 있습니다.</Empty> : (
          <div className="table-wrap"><table className="table design-rooms">
            <thead><tr><th>실번호</th><th>실명</th>{lightCodes.map(c => <th key={c} className="num">{c}</th>)}<th className="num">소계</th></tr></thead>
            <tbody>{rooms.map(r => <tr key={r.id}><td className="nowrap">{r.no}</td><td className="strong">{r.name}</td>
              {lightCodes.map(c => <td key={c}><input className="input xs" inputMode="numeric" defaultValue={r.lights?.[c] || ''} aria-label={`${r.name} ${c} 수량`} disabled={busy} onBlur={e => { const n = Number(e.target.value.replace(/\D/g, '')) || 0; if (n !== (r.lights?.[c] ?? 0)) setLight(r.id, c, n) }} /></td>)}
              <td className="num strong">{lightCodes.reduce((a, c) => a + (r.lights?.[c] ?? 0), 0)}</td></tr>)}
              <tr><td /><td className="strong">합계</td>{lightCodes.map(c => <td key={c} className="num strong">{total(c)}</td>)}<td className="num strong">{lightCodes.reduce((a, c) => a + total(c), 0)}</td></tr>
            </tbody>
          </table></div>)}
      </section>}
      <p className="t-cap">상태는 검토 → 선정 → 확정 순서입니다(눌러서 바꿈). '제외'한 항목은 인쇄 · 내보내기에서 빠집니다. 금액은 스펙북에 넣지 않습니다. '상세'에서 코드 · 품명 · 규격을 고치면 평면 · 3D · 수량(견적)의 마감 번호도 함께 바뀌고, 마감 · 크기 · 납품 업체 · 납기 등을 적으면 인쇄할 때 표본 스펙북처럼 CODE LIST 와 품목별 SPEC 카드로 나옵니다.</p>
      <div ref={sheet} hidden>
        <h1>{project.name} — SPEC BOOK</h1><p>{[project.code, project.client_name, new Date().toISOString().slice(0, 10)].filter(Boolean).join(' · ')} · 주식회사 아트리어디자인스튜디오</p>
        {(Object.keys(SPEC_BOOKS) as SpecBook[]).filter(k => live.some(i => i.book === k)).map(k => { const rows = live.filter(i => i.book === k); return <div key={k}>
          <h2>{SPEC_BOOKS[k]} — CODE LIST</h2>
          <table><thead><tr><th>IMAGE</th><th>CODE</th><th>ITEM</th><th>DISTRIBUTOR</th><th>CONNECT NO.</th><th>REMARKS_SIZE / COLOR</th><th>STOCK</th><th>AREA</th><th>상태</th></tr></thead>
            <tbody>{rows.map(i => <tr key={i.id}><td>{img(i.id) ? <img className="thumb" src={img(i.id)} alt="" /> : ''}</td><td><b>{i.code}</b></td><td>{i.name}</td><td>{i.distributor ?? i.maker}</td><td>{i.contact}</td><td>{[i.size ?? i.spec, i.finish].filter(Boolean).join(' / ')}</td><td>{i.stock ?? (i.qty != null ? `${i.qty}${i.unit ?? ''}` : '')}</td><td>{i.location}</td><td>{SPEC_STATUS[i.status]}</td></tr>)}</tbody></table>
          {k === 'lighting' && rooms.length > 0 && lightCodes.some(c => total(c) > 0) && <><h2>조명 수량표</h2>
            <table><thead><tr><th>실번호</th><th>실명</th>{lightCodes.map(c => <th key={c}>{c}</th>)}<th>조명수량 소계</th></tr></thead>
              <tbody>{rooms.map(r => <tr key={r.id}><td>{r.no}</td><td>{r.name}</td>{lightCodes.map(c => <td key={c}>{r.lights?.[c] || ''}</td>)}<td><b>{lightCodes.reduce((a, c) => a + (r.lights?.[c] ?? 0), 0)}</b></td></tr>)}
                <tr><td /><td><b>합계</b></td>{lightCodes.map(c => <td key={c}><b>{total(c)}</b></td>)}<td><b>{lightCodes.reduce((a, c) => a + total(c), 0)}</b></td></tr></tbody></table></>}
          <h2>{SPEC_BOOKS[k]} — SPEC</h2>
          <div className="cards">{rows.map(i => <table key={i.id} className="card"><tbody>
            <tr><th colSpan={2} className="code">{i.code ?? '—'}</th></tr>
            {img(i.id) && <tr><td className="l">SAMPLE / IMAGE</td><td><img src={img(i.id)} alt="" style={{ maxWidth: '60mm', maxHeight: '40mm' }} /></td></tr>}
            {([['AREA', i.location], ['ITEM', [i.name, i.spec].filter(Boolean).join(' · ')], ['FINISH', i.finish], ['SIZE', i.size], ['MANUFAC. / ORIGIN', i.maker], ['DISTRIBUTOR', i.distributor], ['CONNECT NO.', i.contact], ['DELIVERY', i.delivery], ['STOCK', i.stock], ['REMARKS', i.note]] as const).map(([l, v]) => <tr key={l}><td className="l">{l}</td><td>{v || '-'}</td></tr>)}
          </tbody></table>)}</div>
        </div> })}
      </div>
    </div>
  )
}
