// Drawing set step: sheet list + preview (Programa pattern), A3 print to PDF, DXF download.
// Sheets are drawn as SVG in paper millimetres (A3 420×297) from the saved plan; title block follows the learned CAD standard.
import { useMemo, useRef, useState } from 'react'
import { Button, Empty } from './ui'
import { useApp, useAsync } from '../lib/app'
import type { DesignBase, DesignProject, Placement } from '../lib/design'
import { wallLength, type PlanGeometry, type PlanItem } from '../lib/designPlan'
import { elevationItems, furnitureTypes, planBounds, planDxf, ROWS_PER_SHEET, sheetList, type SheetMeta } from '../lib/designDrawings'

const W = 420, H = 297, M = 10, TB = 62 // paper, margin, title-block width (mm)
const AREA = { x: M + 6, y: M + 6, w: W - M * 2 - TB - 12, h: H - M * 2 - 12 }
const COMPANY = '주식회사 아트리어디자인스튜디오'
const f = (n: number) => Math.round(n).toLocaleString('ko-KR')

function Frame({ meta, project, index, total, children }: { meta: SheetMeta; project: DesignProject; index: number; total: number; children: React.ReactNode }) {
  const x = W - M - TB, rows: [string, string, number][] = [
    ['CLIENT / PROJECT TITLE', `${project.client_name ?? ''}\n${project.name}`, 34], ['NOTE', '치수 단위 mm · 현장 실측 우선', 30],
    ['ISSUES & REVISIONS', `01 · 초안 · ${new Date().toISOString().slice(0, 10)}`, 26], ['APPROVED BY', '', 14], ['CHECKED BY', '', 14], ['DRAWN BY', '', 14],
    ['PROJECT NO.', project.code ?? '', 16], ['DRAWING TITLE', meta.title, 22], ['DATE', new Date().toISOString().slice(0, 10), 14], ['SCALE (A3)', meta.scale, 14],
    ['DRAWING NO.', meta.no, 24], ['SHEET NO.', `${index + 1} / ${total}`, 14],
  ]
  let y = M + 18
  return (
    <svg className="design-sheet" viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${meta.no} ${meta.title}`}>
      <rect width={W} height={H} fill="#fff" />
      <rect x={M} y={M} width={W - M * 2} height={H - M * 2} fill="none" stroke="#111" strokeWidth={0.5} />
      <line x1={x} y1={M} x2={x} y2={H - M} stroke="#111" strokeWidth={0.35} />
      <text x={x + 3} y={M + 8} fontSize={4.2} fontWeight={800}>ARTERIOR</text>
      <text x={x + 3} y={M + 13} fontSize={2.2} fill="#444">{COMPANY}</text>
      {rows.map(([label, value, h]) => {
        const top = y; y += h
        return <g key={label}>
          <line x1={x} y1={top} x2={W - M} y2={top} stroke="#111" strokeWidth={0.2} />
          <text x={x + 2.5} y={top + 4} fontSize={1.9} fill="#555">{label}</text>
          {value.split('\n').map((v, i) => <text key={i} x={x + 2.5} y={top + 9.5 + i * 5} fontSize={label === 'DRAWING NO.' ? 6 : 3.2} fontWeight={label === 'DRAWING NO.' || label === 'DRAWING TITLE' ? 800 : 500}>{v.slice(0, 26)}</text>)}
        </g>
      })}
      {children}
    </svg>
  )
}

function Table({ head, rows: allRows, widths, page = 0 }: { head: string[]; rows: (string | number)[][]; widths: number[]; page?: number }) {
  const rows = allRows.slice(page * ROWS_PER_SHEET, (page + 1) * ROWS_PER_SHEET)
  const rh = 6.2, x0 = AREA.x, y0 = AREA.y + 14
  const xs = widths.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [x0])
  return <g fontSize={2.9}>
    <rect x={x0} y={y0} width={xs[xs.length - 1] - x0} height={rh} fill="#eee" />
    {[head, ...rows].map((r, ri) => <g key={ri}>
      <line x1={x0} y1={y0 + rh * (ri + 1)} x2={xs[xs.length - 1]} y2={y0 + rh * (ri + 1)} stroke="#111" strokeWidth={ri === 0 ? 0.35 : 0.12} />
      {r.map((c, ci) => <text key={ci} x={typeof c === 'number' ? xs[ci + 1] - 2 : xs[ci] + 2} y={y0 + rh * ri + 4.3} textAnchor={typeof c === 'number' ? 'end' : 'start'} fontWeight={ri === 0 ? 800 : 400}>{typeof c === 'number' ? c.toLocaleString('ko-KR') : String(c).slice(0, Math.floor(widths[ci] / 2.1))}</text>)}
    </g>)}
  </g>
}

function PlanSheet({ g, mode, scale }: { g: PlanGeometry; mode: 'plan' | 'ceiling' | 'furniture'; scale: number }) {
  const b = planBounds(g)!
  const ox = AREA.x + (AREA.w - (b.maxX - b.minX) / scale) / 2 - b.minX / scale, oy = AREA.y + 10 + (AREA.h - 20 - (b.maxY - b.minY) / scale) / 2 - b.minY / scale
  const px = (v: number) => ox + v / scale, py = (v: number) => oy + v / scale
  const top = py(b.minY) - 9, left = px(b.minX) - 9
  return <g>
    {g.walls.map(w => <line key={w.id} x1={px(w.x1)} y1={py(w.y1)} x2={px(w.x2)} y2={py(w.y2)} stroke="#111" strokeWidth={Math.max(w.t / scale, 0.6)} strokeLinecap="square" strokeDasharray={w.kind === 'new' && mode === 'plan' ? '3 1' : undefined} opacity={mode === 'ceiling' ? 0.55 : 1} />)}
    {g.openings.map(o => {
      const w = g.walls.find(x => x.id === o.wall)
      if (!w) return null
      const len = wallLength(w) || 1, ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len, a = o.pos - o.width / 2, c = o.pos + o.width / 2
      const x1 = px(w.x1 + ux * a), y1 = py(w.y1 + uy * a), x2 = px(w.x1 + ux * c), y2 = py(w.y1 + uy * c), r = o.width / scale
      return <g key={o.id}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth={Math.max(w.t / scale, 0.6) + 0.3} />
        {o.kind === 'window' ? <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#111" strokeWidth={0.25} />
          : mode !== 'ceiling' && <path d={`M${x1} ${y1} L${x1 - uy * r} ${y1 + ux * r} A${r} ${r} 0 0 0 ${x2} ${y2}`} fill="none" stroke="#111" strokeWidth={0.2} />}
      </g>
    })}
    {mode !== 'ceiling' && g.items.map((i, n) => {
      const w = (i.rot === 90 ? i.d : i.w) / scale, d = (i.rot === 90 ? i.w : i.d) / scale
      return <g key={i.id}>
        <rect x={px(i.x)} y={py(i.y)} width={w} height={d} fill={mode === 'furniture' ? '#e8efe8' : 'none'} stroke="#111" strokeWidth={0.25} />
        {mode === 'furniture' ? <><circle cx={px(i.x) + w / 2} cy={py(i.y) + d / 2} r={2.6} fill="#fff" stroke="#111" strokeWidth={0.25} /><text x={px(i.x) + w / 2} y={py(i.y) + d / 2 + 1} fontSize={2.6} textAnchor="middle" fontWeight={800}>{n + 1}</text></>
          : <text x={px(i.x) + w / 2} y={py(i.y) + d / 2 + 1} fontSize={2.2} textAnchor="middle">{i.name.slice(0, 10)}</text>}
      </g>
    })}
    {mode === 'plan' && g.walls.map(w => <text key={w.id} x={px((w.x1 + w.x2) / 2)} y={py((w.y1 + w.y2) / 2) - 1.6} fontSize={2.2} textAnchor="middle" fill="#333">{f(wallLength(w))}</text>)}
    {mode === 'ceiling' && <text x={px((b.minX + b.maxX) / 2)} y={py((b.minY + b.maxY) / 2)} fontSize={3.4} textAnchor="middle" fontWeight={800}>CL +{f(g.height)}</text>}
    <g stroke="#111" strokeWidth={0.2} fontSize={2.6} textAnchor="middle">
      <line x1={px(b.minX)} y1={top} x2={px(b.maxX)} y2={top} /><line x1={px(b.minX)} y1={top - 1.5} x2={px(b.minX)} y2={top + 1.5} /><line x1={px(b.maxX)} y1={top - 1.5} x2={px(b.maxX)} y2={top + 1.5} />
      <text x={px((b.minX + b.maxX) / 2)} y={top - 1.5} stroke="none">{f(b.maxX - b.minX)}</text>
      <line x1={left} y1={py(b.minY)} x2={left} y2={py(b.maxY)} /><line x1={left - 1.5} y1={py(b.minY)} x2={left + 1.5} y2={py(b.minY)} /><line x1={left - 1.5} y1={py(b.maxY)} x2={left + 1.5} y2={py(b.maxY)} />
      <text x={left - 1.5} y={py((b.minY + b.maxY) / 2)} stroke="none" transform={`rotate(-90 ${left - 1.5} ${py((b.minY + b.maxY) / 2)})`}>{f(b.maxY - b.minY)}</text>
    </g>
    {mode === 'furniture' && <g fontSize={2.6}>{g.items.slice(0, 14).map((i, n) => <text key={i.id} x={AREA.x} y={AREA.y + AREA.h - 2 - (Math.min(g.items.length, 14) - 1 - n) * 4}>{n + 1}. {i.name} · W{i.w} D{i.d} H{i.h}</text>)}</g>}
  </g>
}

/** Dimension line with end ticks; horizontal when y1 === y2, otherwise vertical. */
function Dim({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label: string }) {
  const hz = y1 === y2, mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  return <g stroke="#111" strokeWidth={0.18} fontSize={2.5} textAnchor="middle">
    <line x1={x1} y1={y1} x2={x2} y2={y2} />
    {hz ? <><line x1={x1} y1={y1 - 1.4} x2={x1} y2={y1 + 1.4} /><line x1={x2} y1={y2 - 1.4} x2={x2} y2={y2 + 1.4} /><text x={mx} y={y1 - 1.3} stroke="none">{label}</text></>
      : <><line x1={x1 - 1.4} y1={y1} x2={x1 + 1.4} y2={y1} /><line x1={x2 - 1.4} y1={y2} x2={x2 + 1.4} y2={y2} /><text x={x1 - 1.3} y={my} stroke="none" transform={`rotate(-90 ${x1 - 1.3} ${my})`}>{label}</text></>}
  </g>
}

function Elevation({ g, wallId, scale, finishes }: { g: PlanGeometry; wallId: string; scale: number; finishes: string[] }) {
  const w = g.walls.find(x => x.id === wallId)!
  const len = wallLength(w), x0 = AREA.x + (AREA.w - len / scale) / 2, y0 = AREA.y + 24 + (AREA.h - 62 - g.height / scale) / 2, base = y0 + g.height / scale
  const ops = g.openings.filter(o => o.wall === wallId).sort((a, c) => a.pos - c.pos), items = elevationItems(g, w)
  const cuts = [...new Set([0, ...ops.flatMap(o => [o.pos - o.width / 2, o.pos + o.width / 2]), len].map(v => Math.round(Math.min(len, Math.max(0, v)))))].sort((a, c) => a - c)
  const b = planBounds(g)!, ks = Math.max((b.maxX - b.minX) / 34, (b.maxY - b.minY) / 24), kx = AREA.x + AREA.w - 38, ky = AREA.y + 2
  return <g>
    <rect x={x0} y={y0} width={len / scale} height={g.height / scale} fill="none" stroke="#111" strokeWidth={0.5} />
    <line x1={x0 - 8} y1={base} x2={x0 + len / scale + 8} y2={base} stroke="#111" strokeWidth={0.7} />
    {items.map(i => <g key={i.id}>
      <rect x={x0 + i.a / scale} y={base - i.h / scale} width={(i.b - i.a) / scale} height={i.h / scale} fill="#f7f7f4" stroke="#111" strokeWidth={0.25} strokeDasharray="1.2 0.8" />
      <text x={x0 + (i.a + i.b) / 2 / scale} y={base - i.h / scale - 1.2} fontSize={2.2} textAnchor="middle">{i.name.slice(0, 12)} H{f(i.h)}</text>
    </g>)}
    {ops.map(o => {
      const oh = (o.kind === 'door' ? Math.min(2100, g.height) : 1200) / scale, sill = (o.kind === 'door' ? 0 : 900) / scale
      return <g key={o.id}><rect x={x0 + (o.pos - o.width / 2) / scale} y={base - sill - oh} width={o.width / scale} height={oh} fill="#fff" stroke="#111" strokeWidth={0.3} />
        <text x={x0 + o.pos / scale} y={base - sill - oh / 2} fontSize={2.4} textAnchor="middle">{o.kind === 'door' ? '문' : '창'} {f(o.width)}</text></g>
    })}
    {cuts.length > 2 && cuts.slice(1).map((c, i) => <Dim key={c} x1={x0 + cuts[i] / scale} y1={base + 7} x2={x0 + c / scale} y2={base + 7} label={f(c - cuts[i])} />)}
    <Dim x1={x0} y1={base + (cuts.length > 2 ? 14 : 8)} x2={x0 + len / scale} y2={base + (cuts.length > 2 ? 14 : 8)} label={f(len)} />
    <Dim x1={x0 - 6} y1={y0} x2={x0 - 6} y2={base} label={`CH ${f(g.height)}`} />
    <text x={x0 - 9} y={base + 1} fontSize={2.2} textAnchor="end">FL ±0</text>
    <text x={x0} y={y0 - 4} fontSize={2.6} fill="#555">{w.kind === 'new' ? '새 가벽' : '기존 벽'} · 두께 {w.t}{w.kind === 'new' ? ' · 단면은 가벽 단면 상세(ID) 참조' : ''}</text>
    <g fontSize={2.5}>
      <text x={AREA.x} y={AREA.y + AREA.h - 20} fontWeight={800}>마감 (수량표의 벽 · 도장 · 마감 항목 — 이 벽에 해당하는 것만 남기고 확인)</text>
      {finishes.length ? finishes.slice(0, 4).map((t, i) => <text key={i} x={AREA.x} y={AREA.y + AREA.h - 15.5 + i * 4}>· {t.slice(0, 90)}</text>)
        : <text x={AREA.x} y={AREA.y + AREA.h - 15.5} fill="#c00">수량표에 벽 마감 항목이 없습니다 — 실내재료마감표(I-004)를 채워 주세요.</text>}
    </g>
    <g aria-label="키 플랜">
      <text x={kx} y={ky} fontSize={2.2} fill="#555">KEY PLAN</text>
      {g.walls.map(k => <line key={k.id} x1={kx + (k.x1 - b.minX) / ks} y1={ky + 3 + (k.y1 - b.minY) / ks} x2={kx + (k.x2 - b.minX) / ks} y2={ky + 3 + (k.y2 - b.minY) / ks} stroke={k.id === wallId ? '#111' : '#aaa'} strokeWidth={k.id === wallId ? 1.1 : 0.3} />)}
    </g>
  </g>
}

/** Typical section through a new partition, drawn from its thickness only. Board and stud make-up is not in the data, so it is labelled for confirmation. */
function WallDetail({ t, height, scale }: { t: number; height: number; scale: number }) {
  const tw = t / scale, board = Math.max(tw * 0.14, 2), cx = AREA.x + AREA.w / 2, x = cx - tw / 2, top = AREA.y + 40, bot = AREA.y + AREA.h - 46, mid = (top + bot) / 2
  const note = (y: number, s: string) => <g><line x1={x + tw} y1={y} x2={x + tw + 26} y2={y} stroke="#111" strokeWidth={0.15} /><text x={x + tw + 28} y={y + 1} fontSize={2.6}>{s}</text></g>
  return <g>
    <rect x={x - 50} y={top - 9} width={tw + 100} height={9} fill="#ddd" stroke="#111" strokeWidth={0.3} /><text x={x - 48} y={top - 3} fontSize={2.4}>천장 슬래브 / 천장틀</text>
    <rect x={x - 50} y={bot} width={tw + 100} height={9} fill="#ddd" stroke="#111" strokeWidth={0.3} /><text x={x - 48} y={bot + 6} fontSize={2.4}>바닥 슬래브</text>
    {[x, x + tw - board].map(bx => <rect key={bx} x={bx} y={top} width={board} height={bot - top} fill="#f1efe8" stroke="#111" strokeWidth={0.3} />)}
    <rect x={x + board} y={top} width={tw - board * 2} height={5} fill="none" stroke="#111" strokeWidth={0.3} /><rect x={x + board} y={bot - 5} width={tw - board * 2} height={5} fill="none" stroke="#111" strokeWidth={0.3} />
    <line x1={x + board} y1={top + 5} x2={x + tw - board} y2={bot - 5} stroke="#999" strokeWidth={0.15} /><line x1={x + tw - board} y1={top + 5} x2={x + board} y2={bot - 5} stroke="#999" strokeWidth={0.15} />
    <path d={`M${x - 8} ${mid - 2} l${tw / 2 + 6} 0 l2 -3 l4 6 l2 -3 l${tw / 2 + 6} 0 M${x - 8} ${mid + 2} l${tw / 2 + 6} 0 l2 -3 l4 6 l2 -3 l${tw / 2 + 6} 0`} fill="none" stroke="#111" strokeWidth={0.2} />
    <rect x={x - 9} y={mid - 1.8} width={tw + 18} height={3.6} fill="#fff" />
    <Dim x1={x} y1={bot + 16} x2={x + tw} y2={bot + 16} label={`T ${f(t)}`} />
    <Dim x1={x - 16} y1={top} x2={x - 16} y2={bot} label={`CH ${f(height)} (중간 생략)`} />
    {note(top + 2.5, '상부 런너 — 천장틀 또는 슬래브에 고정')}{note(top + 26, '마감 보드 (양면) · 줄눈 퍼티 뒤 마감')}{note(mid + 14, '경량 스터드 또는 각재 @450 · 속 채움(흡음재)은 사양 확인')}{note(bot - 2.5, '하부 런너 — 바닥 고정 · 걸레받이 별도')}
    <text x={AREA.x} y={AREA.y + AREA.h - 6} fontSize={2.6} fill="#c00">표준 단면입니다. 보드 종류 · 겹수 · 스터드 규격은 자료에 없어 적지 않았습니다 — 발주 전에 사양을 확인해 적어 주세요.</text>
  </g>
}

/** Three views (front · side · plan) of one furniture type with overall sizes. */
function FurnDetail({ item, count, scale }: { item: PlanItem; count: number; scale: number }) {
  const w = item.w / scale, d = item.d / scale, h = item.h / scale, gap = 26, x = AREA.x + (AREA.w - (w + gap + d)) / 2, y = AREA.y + 30 + (AREA.h - 60 - (h + gap + d)) / 2
  const box = (bx: number, by: number, bw: number, bh: number, label: string) => <g><rect x={bx} y={by} width={bw} height={bh} fill="#fafaf7" stroke="#111" strokeWidth={0.4} /><text x={bx} y={by - 9} fontSize={2.8} fontWeight={800}>{label}</text></g>
  return <g>
    {box(x, y, w, h, '정면도')}{box(x + w + gap, y, d, h, '측면도')}{box(x, y + h + gap, w, d, '평면도')}
    <line x1={x - 6} y1={y + h} x2={x + w + gap + d + 6} y2={y + h} stroke="#111" strokeWidth={0.6} />
    <Dim x1={x} y1={y - 4} x2={x + w} y2={y - 4} label={`W ${f(item.w)}`} /><Dim x1={x + w + gap} y1={y - 4} x2={x + w + gap + d} y2={y - 4} label={`D ${f(item.d)}`} />
    <Dim x1={x - 6} y1={y} x2={x - 6} y2={y + h} label={`H ${f(item.h)}`} /><Dim x1={x - 6} y1={y + h + gap} x2={x - 6} y2={y + h + gap + d} label={`D ${f(item.d)}`} />
    <g fontSize={2.8}>
      <text x={x + w + gap} y={y + h + gap + 4} fontWeight={800}>{item.name} · {count}개</text>
      <text x={x + w + gap} y={y + h + gap + 9.5}>W {f(item.w)} × D {f(item.d)} × H {f(item.h)} mm</text>
      <text x={x + w + gap} y={y + h + gap + 15}>{item.spec ? `규격: ${item.spec.slice(0, 40)}` : '규격 · 재질: 수량표에 없음 — 확인 필요'}</text>
    </g>
    <text x={AREA.x} y={AREA.y + AREA.h - 6} fontSize={2.6} fill="#555">겉 치수만 그린 제작 기준도입니다. 내부 구조 · 재질 · 마감 · 철물은 캐드에서 이어 그리거나 제작 업체 도면으로 확정합니다.</text>
  </g>
}

export function DesignDrawings({ project, base }: { project: DesignProject; base: DesignBase }) {
  const { api, version, toast } = useApp()
  const { data: plan, loading } = useAsync(() => api.getDesignPlan(project.id), [project.id, version], null as PlanGeometry | null)
  const { data: rows } = useAsync(() => api.listPlacements(project.id, project.model_version), [project.id, project.model_version, version], [] as Placement[])
  const g = plan ?? { unit: 'mm' as const, height: 2700, walls: [], openings: [], items: [] }
  const sheets = useMemo(() => sheetList(g, rows.length), [plan, rows.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const [cur, setCur] = useState(0)
  const all = useRef<HTMLDivElement>(null)
  const tname = (c: string) => base.trades.find(t => t.code === c)?.name ?? c
  const finishes = useMemo(() => rows.filter(r => /벽|도장|도배|필름|타일|마감|페인트|목공|목작업/.test(`${tname(r.trade_code)} ${r.item}`)).map(r => `${tname(r.trade_code)} — ${r.item}${r.spec ? ` (${r.spec})` : ''}`), [rows, base.trades]) // eslint-disable-line react-hooks/exhaustive-deps
  const types = useMemo(() => furnitureTypes(g), [plan]) // eslint-disable-line react-hooks/exhaustive-deps
  const render = (meta: SheetMeta, i: number) => {
    const sc = Number(meta.scale.split('/')[1]) || 100
    return <Frame key={meta.no} meta={meta} project={project} index={i} total={sheets.length}>
      {meta.kind !== 'cover' && <text x={AREA.x} y={AREA.y + 6} fontSize={5} fontWeight={800}>{meta.title}{meta.scale !== 'NONE' ? `  SCALE ${meta.scale}` : ''}</text>}
      {meta.kind === 'cover' && <g><text x={AREA.x + 8} y={110} fontSize={16} fontWeight={800}>{project.name}</text><text x={AREA.x + 8} y={126} fontSize={7}>INTERIOR DESIGN DRAWINGS</text>
        <text x={AREA.x + 8} y={150} fontSize={4} fill="#444">{[project.code, project.client_name, project.address].filter(Boolean).join(' · ')}</text><text x={AREA.x + 8} y={160} fontSize={4} fill="#444">{COMPANY} · {new Date().toISOString().slice(0, 10)}</text></g>}
      {meta.kind === 'list' && <Table head={['도면 번호', '도면 이름', '축척 (A3)', '비고']} widths={[40, 150, 40, 100]} rows={sheets.map(s => [s.no, s.title, s.scale, ''])} />}
      {meta.kind === 'finish' && <Table head={['공종', '품목', '규격', '수량', '단위']} widths={[50, 100, 120, 35, 25]} page={meta.page} rows={rows.map(r => [tname(r.trade_code), r.item, r.spec, r.qty, r.unit])} />}
      {(meta.kind === 'plan' || meta.kind === 'ceiling' || meta.kind === 'furniture') && <PlanSheet g={g} mode={meta.kind} scale={sc} />}
      {meta.kind === 'elevation' && meta.wall && <Elevation g={g} wallId={meta.wall} scale={sc} finishes={finishes} />}
      {meta.kind === 'wallDetail' && meta.t && <WallDetail t={meta.t} height={g.height} scale={sc} />}
      {meta.kind === 'furnDetail' && (() => { const it = types.find(x => x.id === meta.item); return it ? <FurnDetail item={it} count={it.count} scale={sc} /> : null })()}
    </Frame>
  }
  const print = () => {
    const html = all.current?.innerHTML
    const win = html && window.open('', '_blank')
    if (!win) { toast('인쇄 창을 열지 못했습니다. 팝업 차단을 풀어 주세요'); return }
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${project.code ?? ''} 도면 세트</title><style>@page{size:A3 landscape;margin:0}body{margin:0;font-family:'Pretendard','Noto Sans KR','Apple SD Gothic Neo',sans-serif}svg{display:block;width:420mm;height:297mm;page-break-after:always}</style></head><body>${html}</body></html>`)
    win.document.close()
    win.onload = () => win.print()
    window.setTimeout(() => win.print(), 600)
  }
  const dxf = () => {
    const url = URL.createObjectURL(new Blob([planDxf(g)], { type: 'application/dxf' }))
    const a = document.createElement('a')
    a.href = url; a.download = `[I-100] ${project.code ?? 'PLAN'} PLAN SERIES ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.dxf`
    document.body.appendChild(a); a.click(); a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  const safe = Math.min(cur, sheets.length - 1)
  return (
    <div className="design-block">
      <div className="design-plan-bar">
        <b className="t-bodyb">도면 세트 · {sheets.length}장</b>
        <span className="t-cap">평면 · 3D 단계에서 저장한 평면과 수량표로 만듭니다{loading ? ' · 불러오는 중…' : ''}</span>
        <span className="design-gap" />
        <Button size="sm" kind="outline" onClick={dxf} disabled={!plan}>캐드 파일(DXF) 내려받기</Button>
        <Button size="sm" onClick={print}>A3 PDF로 인쇄</Button>
      </div>
      {!plan && !loading && <Empty>아직 평면이 없습니다. '평면 · 3D' 단계에서 벽을 그리고 저장하면 평면도 · 천장도 · 입면도가 여기에 만들어집니다.</Empty>}
      <div className="design-draw">
        <ol className="design-draw-list" aria-label="도면 목록">
          {sheets.map((s, i) => <li key={s.no}><button type="button" className={i === safe ? 'on' : ''} aria-current={i === safe ? 'true' : undefined} onClick={() => setCur(i)}><b>{s.no}</b><span>{s.title}</span><small>{s.scale}</small></button></li>)}
        </ol>
        <div className="design-draw-view">{render(sheets[safe], safe)}</div>
      </div>
      <p className="t-cap">도면 번호 · 표제란은 표본 도면 세트 기준(I-000 공통 · I-100 평면 시리즈 · 입면도 · ID 상세 · IF 가구 상세)입니다. 상세도는 치수에서 그린 기준도라 재질 · 내부 구조는 캐드에서 이 DXF를 열어 이어서 작업합니다(DWG 로 저장도 캐드에서). 'A3 PDF로 인쇄'는 인쇄 창에서 'PDF로 저장'을 고르세요.</p>
      <div ref={all} hidden>{sheets.map(render)}</div>
    </div>
  )
}
