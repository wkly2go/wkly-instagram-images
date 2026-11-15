// 평면 · 3D 모델링 — 인트라넷 화면에서 평면을 그리고(벽 · 문 · 창 · 부품) 바로 3D 로 보고, 수량을 견적으로 넘긴다
// 레퍼런스: Coohom · 아키스케치(평면 → 3D 한 흐름) · magicplan(고른 대상의 동작만 보이기) · Houzz Pro(물량 → 견적)
// 정밀 모델 · 렌더(Enscape)는 스케치업에서 한다. 여기서는 블록 수준 배치와 수량까지.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty } from './ui'
import { useAction, useApp, useAsync } from '../lib/app'
import type { DesignBase, DesignProject, SpecItem } from '../lib/design'
import { BASE_TYPES, CEILING_TYPES, FLOOR_TYPES, WALL_TYPES } from '../lib/designWallTypes'
import { EMPTY_PLAN, floorArea, keepLights, planQuantities, snapPoint, wallLength, type PlanGeometry, type PlanItem, type PlanWall } from '../lib/designPlan'

const Plan3D = lazy(() => import('./DesignPlan3D'))
type Tool = 'select' | 'wall' | 'newwall' | 'door' | 'window' | 'item'
const TOOLS: [Tool, string, string][] = [
  ['select', '고르기', '벽 · 부품을 눌러 고르고, 부품은 끌어서 옮깁니다'],
  ['wall', '기존 벽', '점을 차례로 눌러 벽을 그립니다. 두 번 누르거나 Esc 로 끝냅니다'],
  ['newwall', '새 가벽', '새로 세우는 벽입니다. 수량(㎡)에 들어갑니다'],
  ['door', '문', '벽을 누르면 그 자리에 문(900)을 냅니다'],
  ['window', '창', '벽을 누르면 그 자리에 창(1200)을 냅니다'],
  ['item', '부품 놓기', '아래에서 부품을 정한 뒤 평면을 눌러 놓습니다'],
]
const GRID = 50
const uid = () => Math.random().toString(36).slice(2, 10)

export function DesignPlan({ project, base }: { project: DesignProject; base: DesignBase }) {
  const { api, version } = useApp()
  const { run, busy } = useAction()
  const { data: specs } = useAsync(() => api.listSpecItems(project.id), [project.id, version], [] as SpecItem[])
  const { data: saved, loading } = useAsync(() => api.getDesignPlan(project.id), [project.id, version], null as PlanGeometry | null)
  const [plan, setPlan] = useState<PlanGeometry>(EMPTY_PLAN)
  const [dirty, setDirty] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [sel, setSel] = useState<string | null>(null)
  const [chain, setChain] = useState<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [preset, setPreset] = useState({ name: '', trade_code: '', unit: 'EA', w: '1200', d: '600', h: '900', measure: 'count' as PlanItem['measure'], section: '' })
  const [view, setView] = useState({ x: -1000, y: -1000, w: 12000 })
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  useEffect(() => {
    if (!saved || dirty) return
    const g = { ...EMPTY_PLAN, ...saved }
    setPlan(g)
    // fit the view to what is drawn
    const xs = [...g.walls.flatMap(w => [w.x1, w.x2]), ...g.items.flatMap(i => [i.x, i.x + i.w])], ys = [...g.walls.flatMap(w => [w.y1, w.y2]), ...g.items.flatMap(i => [i.y, i.y + i.d])]
    if (xs.length) { const w = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) / 0.62, 3000) * 1.25; setView({ x: (Math.min(...xs) + Math.max(...xs)) / 2 - w / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 - (w * 0.62) / 2, w }) }
  }, [saved]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setChain(null); setTool('select') }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); remove(sel) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const change = (next: PlanGeometry) => { setPlan(next); setDirty(true) }
  const remove = (id: string) => { change({ ...plan, walls: plan.walls.filter(w => w.id !== id), openings: plan.openings.filter(o => o.id !== id && o.wall !== id), items: plan.items.filter(i => i.id !== id) }); setSel(null) }
  const point = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect()
    const h = view.w * (r.height / r.width)
    return { x: view.x + ((e.clientX - r.left) / r.width) * view.w, y: view.y + ((e.clientY - r.top) / r.height) * h }
  }
  const nearestWall = (p: { x: number; y: number }) => {
    let best: { w: PlanWall; pos: number; dist: number } | null = null
    for (const w of plan.walls) {
      const len = wallLength(w)
      if (!len) continue
      const t = Math.max(0, Math.min(1, ((p.x - w.x1) * (w.x2 - w.x1) + (p.y - w.y1) * (w.y2 - w.y1)) / (len * len)))
      const dist = Math.hypot(p.x - (w.x1 + t * (w.x2 - w.x1)), p.y - (w.y1 + t * (w.y2 - w.y1)))
      if (!best || dist < best.dist) best = { w, pos: t * len, dist }
    }
    return best && best.dist < view.w * 0.02 ? best : null
  }
  const click = (e: React.MouseEvent) => {
    const raw = point(e)
    if (tool === 'wall' || tool === 'newwall') {
      const p = snapPoint(raw.x, raw.y, GRID, chain)
      if (chain && (chain.x !== p.x || chain.y !== p.y)) change({ ...plan, walls: [...plan.walls, { id: uid(), x1: chain.x, y1: chain.y, x2: p.x, y2: p.y, t: 100, kind: tool === 'newwall' ? 'new' : 'existing' }] })
      setChain(chain && chain.x === p.x && chain.y === p.y ? null : p)
    } else if (tool === 'door' || tool === 'window') {
      const hit = nearestWall(raw)
      if (hit) change({ ...plan, openings: [...plan.openings, { id: uid(), wall: hit.w.id, pos: Math.round(hit.pos / GRID) * GRID, width: tool === 'door' ? 900 : 1200, kind: tool }] })
    } else if (tool === 'item') {
      if (!preset.name.trim() || !preset.trade_code) return
      const p = snapPoint(raw.x, raw.y, GRID)
      const it: PlanItem = { id: uid(), x: p.x, y: p.y, w: Number(preset.w) || 600, d: Number(preset.d) || 600, h: Number(preset.h) || 900, rot: 0, name: preset.name.trim(), trade_code: preset.trade_code, spec: '', unit: preset.unit, measure: preset.measure, section: preset.section.trim() || null }
      change({ ...plan, items: [...plan.items, it] })
      setSel(it.id)
    } else setSel(null)
  }
  const move = (e: React.PointerEvent) => {
    const raw = point(e)
    setHover(tool === 'wall' || tool === 'newwall' ? snapPoint(raw.x, raw.y, GRID, chain) : null)
    const d = drag.current
    if (d) { const p = snapPoint(raw.x - d.dx, raw.y - d.dy, GRID); setPlan(pl => ({ ...pl, items: pl.items.map(i => (i.id === d.id ? { ...i, x: p.x, y: p.y } : i)) })); setDirty(true) }
  }
  const zoom = (f: number) => setView(v => { const w = Math.min(60000, Math.max(3000, v.w * f)); return { x: v.x + (v.w - w) / 2, y: v.y + (v.w - w) / 2, w } })
  const lines = useMemo(() => planQuantities(plan), [plan])
  const area = useMemo(() => floorArea(plan.walls.filter(w => w.kind === 'existing')), [plan.walls])
  const rooms = plan.rooms ?? []
  // Lighting counts are edited in the spec book; pick up the latest ones so saving here does not wipe them.
  const latest = async () => keepLights(plan, await api.getDesignPlan(project.id))
  const selItem = plan.items.find(i => i.id === sel), selWall = plan.walls.find(w => w.id === sel), selOpen = plan.openings.find(o => o.id === sel)
  const patchOpen = (p: Partial<PlanGeometry['openings'][number]>) => change({ ...plan, openings: plan.openings.map(o => (o.id === sel ? { ...o, ...p } : o)) })
  const patchItem = (p: Partial<PlanItem>) => change({ ...plan, items: plan.items.map(i => (i.id === sel ? { ...i, ...p } : i)) })
  const tname = (c: string) => base.trades.find(t => t.code === c)?.name ?? c
  const stroke = Math.max(view.w / 600, 8)
  const hgt = 0.62
  return (
    <div className="design-block">
      <div className="design-plan-bar" role="toolbar" aria-label="평면 도구">
        {TOOLS.map(([k, label, tip]) => <button type="button" key={k} title={tip} className={`chip${tool === k ? ' active' : ''}`} aria-pressed={tool === k} onClick={() => { setTool(k); setChain(null) }}>{label}</button>)}
        <span className="design-gap" />
        <Button size="sm" kind="ghost" onClick={() => zoom(0.8)} aria-label="확대">＋</Button>
        <Button size="sm" kind="ghost" onClick={() => zoom(1.25)} aria-label="축소">－</Button>
        <label className="design-plan-h">천장 높이 <input className="input xs" inputMode="numeric" value={plan.height} onChange={e => change({ ...plan, height: Number(e.target.value.replace(/\D/g, '')) || 0 })} /> mm</label>
        <Button size="sm" kind="outline" disabled={busy || !dirty} onClick={() => run(async () => { const p = await latest(); await api.saveDesignPlan(project.id, p); setPlan(p) }, '평면을 저장했습니다').then(ok => ok && setDirty(false))}>{dirty ? '저장' : '저장됨'}</Button>
      </div>
      <p className="t-cap">{TOOLS.find(t => t[0] === tool)?.[2]} · 격자 {GRID}mm · 치수는 mm{loading ? ' · 불러오는 중…' : ''}</p>
      <div className="design-plan-split">
        <svg ref={svg} className={`design-plan-svg tool-${tool}`} viewBox={`${view.x} ${view.y} ${view.w} ${view.w * hgt}`} onClick={click} onPointerMove={move}
          onPointerUp={() => { drag.current = null }} onDoubleClick={() => setChain(null)} role="img" aria-label="평면 그리기 영역">
          <defs><pattern id="dp-grid" width="500" height="500" patternUnits="userSpaceOnUse"><path d="M500 0H0V500" fill="none" stroke="var(--line)" strokeWidth={stroke / 4} /></pattern></defs>
          <rect x={view.x} y={view.y} width={view.w} height={view.w * hgt} fill="url(#dp-grid)" />
          {plan.walls.map(w => {
            const len = wallLength(w), mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2
            return <g key={w.id} onClick={e => { if (tool === 'select') { e.stopPropagation(); setSel(w.id) } }}>
              <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={sel === w.id ? 'var(--pink)' : w.kind === 'new' ? 'var(--blue)' : 'var(--gray)'} strokeWidth={Math.max(w.t, stroke * 2)} strokeDasharray={w.kind === 'new' ? `${stroke * 6} ${stroke * 2}` : undefined} strokeLinecap="square" />
              <text x={mx} y={my - stroke * 3} fontSize={stroke * 7} textAnchor="middle" fill="var(--gray)">{Math.round(len).toLocaleString('ko-KR')}</text>
            </g>
          })}
          {plan.openings.map(o => {
            const w = plan.walls.find(x => x.id === o.wall)
            if (!w) return null
            const len = wallLength(w), ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len
            const a = o.pos - o.width / 2, b = o.pos + o.width / 2
            return <line key={o.id} x1={w.x1 + ux * a} y1={w.y1 + uy * a} x2={w.x1 + ux * b} y2={w.y1 + uy * b} stroke={sel === o.id ? 'var(--pink)' : o.kind === 'door' ? 'var(--white)' : 'var(--yellow)'} strokeWidth={Math.max(w.t, stroke * 2) + stroke}
              onClick={e => { if (tool === 'select') { e.stopPropagation(); setSel(o.id) } }} />
          })}
          {plan.items.map(i => {
            const w = i.rot === 90 ? i.d : i.w, d = i.rot === 90 ? i.w : i.d
            return <g key={i.id} className="design-plan-item" onClick={e => { if (tool === 'select') { e.stopPropagation(); setSel(i.id) } }}
              onPointerDown={e => { if (tool !== 'select') return; const p = point(e); drag.current = { id: i.id, dx: p.x - i.x, dy: p.y - i.y }; setSel(i.id) }}>
              <rect x={i.x} y={i.y} width={w} height={d} fill={sel === i.id ? 'var(--pink)' : 'var(--blue)'} fillOpacity={0.18} stroke={sel === i.id ? 'var(--pink)' : 'var(--blue)'} strokeWidth={stroke} />
              <text x={i.x + w / 2} y={i.y + d / 2 + stroke * 2.5} fontSize={stroke * 7} textAnchor="middle" fill="var(--blue)">{i.name}</text>
            </g>
          })}
          {chain && hover && <line x1={chain.x} y1={chain.y} x2={hover.x} y2={hover.y} stroke="var(--pink)" strokeWidth={stroke * 1.5} strokeDasharray={`${stroke * 3}`} />}
          {chain && hover && <text x={hover.x + stroke * 4} y={hover.y - stroke * 4} fontSize={stroke * 8} fill="var(--pink)">{Math.round(Math.hypot(hover.x - chain.x, hover.y - chain.y)).toLocaleString('ko-KR')}</text>}
        </svg>
        <Suspense fallback={<div className="design-plan-3d t-cap">3D 를 준비하는 중…</div>}><Plan3D plan={plan} selected={sel} /></Suspense>
      </div>

      {tool === 'item' && (
        <div className="design-add" aria-label="놓을 부품">
          <input className="input" value={preset.name} onChange={e => setPreset({ ...preset, name: e.target.value })} placeholder="부품 이름 (예: 진열 집기)" aria-label="부품 이름" />
          <select className="select" value={preset.trade_code} onChange={e => setPreset({ ...preset, trade_code: e.target.value })} aria-label="공종"><option value="">공종</option>{base.trades.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
          {(['w', 'd', 'h'] as const).map(k => <input key={k} className="input design-qty" value={preset[k]} inputMode="numeric" onChange={e => setPreset({ ...preset, [k]: e.target.value.replace(/\D/g, '') })} aria-label={{ w: '가로', d: '세로', h: '높이' }[k]} placeholder={{ w: '가로', d: '세로', h: '높이' }[k]} />)}
          <select className="select" value={preset.measure} onChange={e => setPreset({ ...preset, measure: e.target.value as PlanItem['measure'], unit: e.target.value === 'area' ? 'm2' : e.target.value === 'length' ? 'm' : 'EA' })} aria-label="수량 세는 법"><option value="count">개수로</option><option value="area">바닥 면적(㎡)으로</option><option value="length">길이(m)로</option></select>
          <input className="input" value={preset.section} onChange={e => setPreset({ ...preset, section: e.target.value })} placeholder="견적 구분 (선택)" aria-label="견적 구분" />
        </div>
      )}
      {(selItem || selWall || selOpen) && (
        <div className="design-add" aria-label="고른 대상">
          {selItem && <>
            <b className="design-plan-sel">{selItem.name}</b>
            {(['w', 'd', 'h'] as const).map(k => <label key={k} className="design-plan-h">{{ w: '가로', d: '세로', h: '높이' }[k]} <input className="input xs" inputMode="numeric" value={selItem[k]} onChange={e => patchItem({ [k]: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>)}
            <Button size="sm" kind="outline" onClick={() => patchItem({ rot: selItem.rot === 90 ? 0 : 90 })}>90° 돌리기</Button>
            <Button size="sm" kind="outline" onClick={() => change({ ...plan, items: [...plan.items, { ...selItem, id: uid(), x: selItem.x + 200, y: selItem.y + 200 }] })}>하나 더</Button>
          </>}
          {selWall && <>
            <b className="design-plan-sel">{selWall.kind === 'new' ? '새 가벽' : '기존 벽'} · {Math.round(wallLength(selWall)).toLocaleString('ko-KR')}mm</b>
            <label className="design-plan-h">두께 <input className="input xs" inputMode="numeric" value={selWall.t} onChange={e => change({ ...plan, walls: plan.walls.map(w => (w.id === sel ? { ...w, t: Number(e.target.value.replace(/\D/g, '')) || 0 } : w)) })} /></label>
            <Button size="sm" kind="outline" onClick={() => change({ ...plan, walls: plan.walls.map(w => (w.id === sel ? { ...w, kind: w.kind === 'new' ? 'existing' : 'new' } : w)) })}>{selWall.kind === 'new' ? '기존 벽으로' : '새 가벽으로'}</Button>
            <label className="design-plan-h">유형 <select className="input" value={selWall.type ?? ''} title="표본 도면의 벽체 유형(W1~W30). 고르면 벽체 상세도에 층 구성이 그려지고, 두께가 정해진 유형은 두께도 맞춰집니다"
              onChange={e => { const t = WALL_TYPES.find(x => x.code === e.target.value); change({ ...plan, walls: plan.walls.map(w => (w.id === sel ? { ...w, type: t?.code, t: t && Number(t.thk) ? Number(t.thk) : w.t } : w)) }) }}>
              <option value="">유형 없음</option>{WALL_TYPES.map(t => <option key={t.code} value={t.code}>{t.code} {t.name} · {t.composition.slice(0, 34)} · {t.thk || '?'}</option>)}</select></label>
            <label className="design-plan-h">마감 <input className="input" list="design-wall-finishes" placeholder="예: PT-01 수성 페인트 백색" title="스펙북 마감재에 넣은 재료 번호를 고르거나 직접 적습니다" value={selWall.finish ?? ''} onChange={e => change({ ...plan, walls: plan.walls.map(w => (w.id === sel ? { ...w, finish: e.target.value } : w)) })} /></label>
            <datalist id="design-wall-finishes">{[...new Set([...specs.filter(x => x.book === 'materials' && x.status !== 'dropped').map(x => [x.code, x.name].filter(Boolean).join(' ')), ...plan.walls.map(w => w.finish?.trim())].filter(Boolean))].map(v => <option key={v} value={v} />)}</datalist>
            {selWall.finish?.trim() && <Button size="sm" kind="ghost" title="마감이 비어 있는 벽에만 같은 마감을 넣습니다" onClick={() => change({ ...plan, walls: plan.walls.map(w => (w.finish?.trim() ? w : { ...w, finish: selWall.finish })) })}>빈 벽에 같은 마감</Button>}
          </>}
          {selOpen && <>
            <b className="design-plan-sel">{selOpen.kind === 'door' ? '문' : '창'}</b>
            <label className="design-plan-h">폭 <input className="input xs" inputMode="numeric" value={selOpen.width} onChange={e => change({ ...plan, openings: plan.openings.map(o => (o.id === sel ? { ...o, width: Number(e.target.value.replace(/\D/g, '')) || 0 } : o)) })} /></label>
            {selOpen.kind === 'door' && <>
              <label className="design-plan-h">높이 <input className="input xs" inputMode="numeric" placeholder="2100" value={selOpen.height ?? ''} onChange={e => patchOpen({ height: Number(e.target.value.replace(/\D/g, '')) || undefined })} /></label>
              <label className="design-plan-h">위치 <input className="input" placeholder="들어가는 실 (예: 창고)" value={selOpen.to ?? ''} onChange={e => patchOpen({ to: e.target.value })} /></label>
              <label className="design-plan-h">종류 <input className="input" list="design-door-kinds" placeholder="여닫이 도어" value={selOpen.type ?? ''} onChange={e => patchOpen({ type: e.target.value })} /></label>
              <datalist id="design-door-kinds">{['여닫이 도어', '히든 여닫이 도어', '양개 여닫이 도어', '미닫이 도어', '유리 도어'].map(v => <option key={v} value={v} />)}</datalist>
              <label className="design-plan-h">문 마감 <input className="input" list="design-mat-codes" placeholder="WD-01" value={selOpen.finish ?? ''} onChange={e => patchOpen({ finish: e.target.value })} /></label>
              <label className="design-plan-h">프레임 마감 <input className="input" list="design-mat-codes" placeholder="MT-01" value={selOpen.frame ?? ''} onChange={e => patchOpen({ frame: e.target.value })} /></label>
            </>}
          </>}
          <Button size="sm" kind="ghost" onClick={() => sel && remove(sel)}>지우기</Button>
        </div>
      )}

      <div className="design-plan-qty" aria-label="실별 마감">
        <div className="row wrap">
          <b className="t-bodyb">실별 마감 (실내재료마감표)</b>
          <span className="t-cap">실마다 바닥 · 걸레받이 · 벽 · 천장의 재료 번호와 상세 유형을 적으면 도면 세트의 마감표와 상세도(ID-100 · ID-200)가 만들어집니다. 면적 · 걸레받이 길이를 적으면 아래 수량에도 들어갑니다</span>
          <span className="design-gap" />
          <Button size="sm" kind="outline" onClick={() => change({ ...plan, rooms: [...rooms, { id: `r${Date.now().toString(36)}`, no: String(101 + rooms.length), name: '', floor: {}, base: {}, wall: {}, ceiling: {}, ch: plan.height }] })}>실 추가</Button>
        </div>
        {rooms.length > 0 && <div className="table-wrap"><table className="table design-rooms">
          <thead><tr><th>실번호</th><th>실명</th><th>바닥 재료</th><th>상세</th><th>걸레받이 재료</th><th>상세</th><th>벽 재료</th><th>상세</th><th>천장 재료</th><th>유형</th><th>C.H</th><th>면적 ㎡</th><th>걸레받이 m</th><th /></tr></thead>
          <tbody>{rooms.map(r => { const set = (p: Partial<typeof r>) => change({ ...plan, rooms: rooms.map(x => (x.id === r.id ? { ...x, ...p } : x)) }); return <tr key={r.id}>
            <td><input className="input xs" value={r.no} aria-label="실번호" onChange={e => set({ no: e.target.value })} /></td>
            <td><input className="input" value={r.name} aria-label="실명" placeholder="예: 로비" onChange={e => set({ name: e.target.value })} /></td>
            {(['floor', 'base', 'wall'] as const).map(k => [
              <td key={k}><input className="input" list="design-mat-codes" value={r[k].mat ?? ''} aria-label={`${k} 재료 번호`} placeholder="PT-01" onChange={e => set({ [k]: { ...r[k], mat: e.target.value } })} /></td>,
              <td key={`${k}d`}><select className="input" value={r[k].detail ?? ''} aria-label={`${k} 상세 유형`} onChange={e => set({ [k]: { ...r[k], detail: e.target.value || undefined } })}><option value="">-</option>
                {(k === 'floor' ? FLOOR_TYPES.map(t => [t.code, t.composition]) : k === 'base' ? BASE_TYPES.map(t => [t.code, t.name]) : WALL_TYPES.map(t => [t.code, `${t.name} ${t.thk}`])).map(([c, n]) => <option key={c} value={c}>{c} {n.slice(0, 30)}</option>)}</select></td>])}
            <td><input className="input" list="design-mat-codes" value={r.ceiling.mat ?? ''} aria-label="천장 재료 번호" placeholder="PT-01" onChange={e => set({ ceiling: { ...r.ceiling, mat: e.target.value } })} /></td>
            <td><select className="input" value={r.ceiling.detail ?? ''} aria-label="천장 유형" onChange={e => set({ ceiling: { ...r.ceiling, detail: e.target.value || undefined } })}><option value="">-</option>{CEILING_TYPES.map(t => <option key={t.code} value={t.code}>{t.code} {t.name}</option>)}</select></td>
            <td><input className="input xs" inputMode="numeric" value={r.ch ?? ''} aria-label="천장 높이" onChange={e => set({ ch: Number(e.target.value.replace(/\D/g, '')) || undefined })} /></td>
            <td><input className="input xs" inputMode="decimal" defaultValue={r.area ?? ''} aria-label="면적" placeholder={rooms.length === 1 && area != null ? String(area) : ''} onBlur={e => set({ area: Number(e.target.value.replace(/[^\d.]/g, '')) || undefined })} /></td>
            <td><input className="input xs" inputMode="decimal" defaultValue={r.perimeter ?? ''} aria-label="걸레받이 길이" onBlur={e => set({ perimeter: Number(e.target.value.replace(/[^\d.]/g, '')) || undefined })} /></td>
            <td><Button size="sm" kind="ghost" onClick={() => change({ ...plan, rooms: rooms.filter(x => x.id !== r.id) })}>지우기</Button></td>
          </tr> })}</tbody>
        </table></div>}
        <datalist id="design-mat-codes">{specs.filter(x => x.book === 'materials' && x.status !== 'dropped' && x.code).map(x => <option key={x.id} value={x.code!}>{x.name}</option>)}</datalist>
      </div>

      <div className="design-plan-qty">
        <div className="row wrap">
          <b className="t-bodyb">이 평면의 수량</b>
          <span className="t-cap">{area != null ? `바닥 ${area}㎡ (${(area / 3.3058).toFixed(1)}평)` : '기존 벽이 닫힌 방이 되면 바닥 면적이 나옵니다'}</span>
          <span className="design-gap" />
          <Button size="sm" disabled={busy || lines.length === 0} onClick={() => run(async () => { const p = await latest(); await api.saveDesignPlan(project.id, p); await api.applyDesignPlan(project.id, p, planQuantities(p)); setPlan(p) }, '수량표에 반영했습니다. 새 모델 버전이 만들어졌습니다').then(ok => ok && setDirty(false))}>수량표에 반영</Button>
        </div>
        {lines.length === 0 ? <Empty>새 가벽이나 부품을 그리면 여기에 수량이 모입니다. 기존 벽은 수량에 들어가지 않습니다.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>공종</th><th>품목</th><th>규격</th><th className="num">수량</th><th>단위</th><th>견적 구분</th></tr></thead>
            <tbody>{lines.map((l, i) => <tr key={i}><td className="nowrap strong">{tname(l.trade)}</td><td>{l.item}</td><td className="max">{l.spec}</td><td className="num">{l.qty.toLocaleString('ko-KR')}</td><td>{l.unit}</td><td>{l.section}</td></tr>)}</tbody>
          </table></div>
        )}
        <p className="t-cap">'수량표에 반영'을 누르면 스케치업에서 '수량 보내기'를 한 것과 같이 새 모델 버전이 되고, 직접 넣은 수량은 그대로 남습니다. {area != null && project.area_m2 == null ? '면적은 프로젝트에 자동으로 넣지 않습니다(확인 후 직접 입력).' : ''}</p>
      </div>
    </div>
  )
}
