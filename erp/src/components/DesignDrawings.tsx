// Drawing set step: sheet list + preview (Programa pattern), A3 print to PDF, DXF download.
// Sheets are drawn as SVG in paper millimetres (A3 420×297) from the saved plan; title block follows the learned CAD standard.
import { useMemo, useRef, useState } from 'react'
import { Button, Empty } from './ui'
import { useApp, useAsync } from '../lib/app'
import type { DesignBase, DesignProject, Placement, SpecItem } from '../lib/design'
import { wallLength, type PlanGeometry, type PlanItem, type PlanRoom } from '../lib/designPlan'
import { BASE_TYPES, CEILING_TYPES, FLOOR_TYPES, wallType, type BaseType, type CeilingType, type FloorType, type WallType } from '../lib/designWallTypes'
import { DOORS_PER_SHEET, doorGroups, elevationItems, furnitureTypes, materialKind, type DoorGroup, openingSize, wallFaceArea, wallFinishRows, planBounds, planDxf, ROWS_PER_SHEET, sheetList, type SheetMeta } from '../lib/designDrawings'

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
        <rect x={px(i.x)} y={py(i.y)} width={w} height={d} fill={mode === 'furniture' ? '#ececea' : 'none'} stroke="#111" strokeWidth={0.25} />
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
      <rect x={x0 + i.a / scale} y={base - i.h / scale} width={(i.b - i.a) / scale} height={i.h / scale} fill="#f7f7f7" stroke="#111" strokeWidth={0.25} strokeDasharray="1.2 0.8" />
      <text x={x0 + (i.a + i.b) / 2 / scale} y={base - i.h / scale - 1.2} fontSize={2.2} textAnchor="middle">{i.name.slice(0, 12)} H{f(i.h)}</text>
    </g>)}
    {ops.map(o => {
      const oh = openingSize(o, g.height).h / scale, sill = openingSize(o, g.height).sill / scale
      return <g key={o.id}><rect x={x0 + (o.pos - o.width / 2) / scale} y={base - sill - oh} width={o.width / scale} height={oh} fill="#fff" stroke="#111" strokeWidth={0.3} />
        <text x={x0 + o.pos / scale} y={base - sill - oh / 2} fontSize={2.4} textAnchor="middle">{o.kind === 'door' ? '문' : '창'} {f(o.width)}</text></g>
    })}
    {cuts.length > 2 && cuts.slice(1).map((c, i) => <Dim key={c} x1={x0 + cuts[i] / scale} y1={base + 7} x2={x0 + c / scale} y2={base + 7} label={f(c - cuts[i])} />)}
    <Dim x1={x0} y1={base + (cuts.length > 2 ? 14 : 8)} x2={x0 + len / scale} y2={base + (cuts.length > 2 ? 14 : 8)} label={f(len)} />
    <Dim x1={x0 - 6} y1={y0} x2={x0 - 6} y2={base} label={`CH ${f(g.height)}`} />
    <text x={x0 - 9} y={base + 1} fontSize={2.2} textAnchor="end">FL ±0</text>
    <text x={x0} y={y0 - 4} fontSize={2.6} fill="#555">{w.kind === 'new' ? '새 가벽' : '기존 벽'} · 두께 {w.t}{w.type ? ` · 벽체 유형 ${w.type}` : ''}{w.kind === 'new' || w.type ? ' · 단면은 벽체 상세(ID-200) 참조' : ''}</text>
    {w.finish?.trim() ? <g>
      <text x={x0 + len / scale / 2} y={y0 + 6} fontSize={3} textAnchor="middle" fontWeight={800}>{w.finish.trim().slice(0, 40)}</text>
      <text x={AREA.x} y={AREA.y + AREA.h - 14} fontSize={2.8} fontWeight={800}>마감: {w.finish.trim().slice(0, 70)} · 면적 {wallFaceArea(g, w).toLocaleString('ko-KR')}㎡ (개구부 제외 · 한 면)</text>
    </g> : <g fontSize={2.5}>
      <text x={AREA.x} y={AREA.y + AREA.h - 20} fontWeight={800} fill="#c00">이 벽의 마감이 정해지지 않았습니다 — '평면 · 3D'에서 벽을 골라 마감을 적어 주세요. 참고: 수량표의 벽 마감 항목</text>
      {finishes.slice(0, 4).map((t, i) => <text key={i} x={AREA.x} y={AREA.y + AREA.h - 15.5 + i * 4}>· {t.slice(0, 90)}</text>)}
    </g>}
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
    {[x, x + tw - board].map(bx => <rect key={bx} x={bx} y={top} width={board} height={bot - top} fill="#f0f0ee" stroke="#111" strokeWidth={0.3} />)}
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

/** Wall type section from the learned catalogue (sample set ID-201~204): layer callouts on both faces and the label bar. */
function WallTypeDetail({ t }: { t: WallType }) {
  const tw = Math.min(Math.max((Number(t.thk) || 140) / 6, 8), 60), cx = AREA.x + AREA.w / 2, x = cx - tw / 2, top = AREA.y + 34, bot = AREA.y + AREA.h - 44, face = Math.max(tw * 0.14, 2.4), cy = top + 60
  const side = (rows: string[], left: boolean) => rows.slice(0, 9).map((r, i) => <g key={i}>
    <line x1={left ? x - 4 : x + tw + 4} y1={cy + i * 6} x2={left ? x + face / 2 : x + tw - face / 2} y2={cy} stroke="#888" strokeWidth={0.12} />
    <text x={left ? x - 6 : x + tw + 6} y={cy + i * 6 + 1} fontSize={2.6} textAnchor={left ? 'end' : 'start'}>{r.slice(0, 52)}</text>
  </g>)
  return <g>
    <rect x={x} y={top} width={face} height={bot - top} fill="#f0f0ee" stroke="#111" strokeWidth={0.3} /><rect x={x + tw - face} y={top} width={face} height={bot - top} fill="#f0f0ee" stroke="#111" strokeWidth={0.3} />
    {tw - face * 2 > 3 && Array.from({ length: Math.floor((bot - top) / 9) }, (_, i) => <path key={i} d={`M${x + face + 0.6} ${top + 2 + i * 9} q${(tw - face * 2 - 1.2) / 2} 4.5 0 9`} fill="none" stroke="#bbb" strokeWidth={0.15} />)}
    <Dim x1={x} y1={top - 6} x2={x + tw} y2={top - 6} label={t.thk && t.thk !== 'VAR' ? t.thk : 'VAR.'} />
    {side(t.left, true)}{side(t.right, false)}
    <g>
      <rect x={AREA.x} y={bot + 8} width={AREA.w} height={14} fill="none" stroke="#111" strokeWidth={0.4} />
      <line x1={AREA.x + 20} y1={bot + 8} x2={AREA.x + 20} y2={bot + 22} stroke="#111" strokeWidth={0.3} /><line x1={AREA.x + 20} y1={bot + 15} x2={AREA.x + AREA.w} y2={bot + 15} stroke="#111" strokeWidth={0.3} />
      <text x={AREA.x + 10} y={bot + 17} fontSize={4.6} fontWeight={800} textAnchor="middle">{t.code}</text>
      <text x={AREA.x + 23} y={bot + 13} fontSize={3} fontWeight={800}>{t.composition}</text>
      <text x={AREA.x + 23} y={bot + 20} fontSize={3} fontWeight={800}>{t.name}{t.extent ? ` [${t.extent}]` : ''}</text>
      <text x={AREA.x + AREA.w - 3} y={bot + 20} fontSize={3} fontWeight={800} textAnchor="end">THK={t.thk || '확인 필요'}</text>
    </g>
    <text x={AREA.x} y={AREA.y + AREA.h - 6} fontSize={2.6} fill="#555">표본 실시설계 도면의 벽체 유형을 그대로 옮긴 것입니다(재료 표기는 표본 원문). 단면 그림은 두께만 맞춘 약식이므로 현장 조건에 맞춰 확인합니다.</text>
  </g>
}

const Bar = ({ code, line1, line2, thk }: { code: string; line1: string; line2?: string; thk: string }) => { const y = AREA.y + AREA.h - 36; return <g>
  <rect x={AREA.x} y={y} width={AREA.w} height={14} fill="none" stroke="#111" strokeWidth={0.4} />
  <line x1={AREA.x + 20} y1={y} x2={AREA.x + 20} y2={y + 14} stroke="#111" strokeWidth={0.3} />{line2 != null && <line x1={AREA.x + 20} y1={y + 7} x2={AREA.x + AREA.w} y2={y + 7} stroke="#111" strokeWidth={0.3} />}
  <text x={AREA.x + 10} y={y + 9} fontSize={4.6} fontWeight={800} textAnchor="middle">{code}</text>
  <text x={AREA.x + 23} y={y + (line2 != null ? 5 : 9)} fontSize={3} fontWeight={800}>{line1}</text>{line2 != null && <text x={AREA.x + 23} y={y + 12} fontSize={3} fontWeight={800}>{line2}</text>}
  {thk !== '' && <text x={AREA.x + AREA.w - 3} y={y + 12} fontSize={3} fontWeight={800} textAnchor="end">THK={thk}</text>}
</g> }
const SAMPLE_NOTE = '표본 실시설계 도면의 유형을 옮긴 것입니다(재료 표기는 표본 원문, 실 이름은 표본의 예). 그림은 약식이므로 현장 조건에 맞춰 확인합니다.'

/** Floor transition section from the learned catalogue (sample ID-101~103): two finishes meeting on the slab, layers called out on each side. */
function FloorDetail({ t }: { t: FloorType }) {
  const x0 = AREA.x + 30, x1 = AREA.x + AREA.w - 30, mx = (x0 + x1) / 2, y = AREA.y + 110
  const side = (rows: string[], left: boolean) => <g>
    {rows[0] && <><rect x={left ? x0 : x1 - 44} y={AREA.y + 34} width={44} height={7} fill="none" stroke="#111" strokeWidth={0.2} /><text x={left ? x0 + 22 : x1 - 22} y={AREA.y + 39} fontSize={3} textAnchor="middle">{rows[0].slice(0, 16)}</text></>}
    {rows.slice(1, 9).map((r, i) => <g key={i}><line x1={(left ? x0 : mx) + 30} y1={AREA.y + 52 + i * 5.5} x2={(left ? x0 : mx) + 30} y2={y - 2} stroke="#aaa" strokeWidth={0.1} /><text x={(left ? x0 : mx) + 33} y={AREA.y + 53 + i * 5.5} fontSize={2.6}>{r.slice(0, 44)}</text></g>)}
  </g>
  return <g>
    <rect x={x0} y={y + 8} width={x1 - x0} height={26} fill="#bbb" /><rect x={x0} y={y} width={x1 - x0} height={8} fill="#e4e4e4" stroke="#999" strokeWidth={0.15} />
    <rect x={x0} y={y - 2.4} width={mx - x0 - 2} height={2.4} fill="#f0f0ee" stroke="#111" strokeWidth={0.25} /><rect x={mx + 2} y={y - 2.4} width={x1 - mx - 2} height={2.4} fill="#fff" stroke="#111" strokeWidth={0.25} />
    <rect x={mx - 2} y={y - 3} width={4} height={8} fill="#fff" stroke="#111" strokeWidth={0.35} /><line x1={mx - 2} y1={y - 3} x2={mx + 2} y2={y + 5} stroke="#111" strokeWidth={0.15} /><line x1={mx + 2} y1={y - 3} x2={mx - 2} y2={y + 5} stroke="#111" strokeWidth={0.15} />
    <text x={x0} y={y - 5} fontSize={2.6}>▼ FL</text><text x={x0 + 3} y={y + 5.5} fontSize={2.4} fill="#444">고름몰탈</text>
    {side(t.left, true)}{side(t.right, false)}
    <Bar code={t.code} line1={t.composition} thk={t.thk} />
    <text x={AREA.x} y={AREA.y + AREA.h - 6} fontSize={2.6} fill="#555">{SAMPLE_NOTE}</text>
  </g>
}

/** Baseboard section from the learned catalogue (sample ID-104~105): wall face, floor line, baseboard with its height. */
function BaseDetail({ t }: { t: BaseType }) {
  const h = (Number(t.thk) || 50) / 6 * 2, x = AREA.x + AREA.w / 2 - 20, fl = AREA.y + 150
  return <g>
    <rect x={x - 70} y={fl} width={190} height={22} fill="#ccc" /><line x1={x - 70} y1={fl} x2={x + 120} y2={fl} stroke="#111" strokeWidth={0.5} />
    <rect x={x - 6} y={AREA.y + 40} width={6} height={fl - AREA.y - 40} fill="#f0f0ee" stroke="#111" strokeWidth={0.3} />
    <rect x={x} y={fl - h} width={2.4} height={h} fill="#111" />
    <rect x={x + 2.4} y={fl - 2} width={117} height={2} fill="#fff" stroke="#111" strokeWidth={0.2} />
    <Dim x1={x + 14} y1={fl - h} x2={x + 14} y2={fl} label={t.thk || '?'} />
    {t.layers.slice(0, 6).map((r, i) => <g key={i}><line x1={x + 2.4} y1={fl - h / 2} x2={x + 28} y2={fl - 44 + i * 6} stroke="#888" strokeWidth={0.12} /><text x={x + 30} y={fl - 43 + i * 6} fontSize={2.6}>{r.slice(0, 60)}</text></g>)}
    <Bar code={t.code} line1={t.name} thk={t.thk} />
    <text x={AREA.x} y={AREA.y + AREA.h - 6} fontSize={2.6} fill="#555">{SAMPLE_NOTE}</text>
  </g>
}

/** Ceiling section at the sample scale (1/25): slab, hangers, frame and finish, with the ceiling heights of the rooms that use it. */
function CeilDetail({ t, rooms }: { t: CeilingType; rooms: PlanRoom[] }) {
  const x0 = AREA.x + 40, x1 = AREA.x + AREA.w - 40, slab = AREA.y + 40, cl = AREA.y + 96, step = t.cove ? 14 : 0, sx = x0 + (x1 - x0) * 0.62
  return <g>
    <rect x={x0} y={slab - 10} width={x1 - x0} height={10} fill="#ccc" stroke="#111" strokeWidth={0.3} /><text x={x0 + 2} y={slab - 3.5} fontSize={2.4}>슬래브</text>
    {Array.from({ length: 7 }, (_, i) => x0 + 14 + i * ((x1 - x0 - 28) / 6)).map(hx => <g key={hx}><line x1={hx} y1={slab} x2={hx} y2={(hx > sx ? cl - step : cl) - 3} stroke="#111" strokeWidth={0.2} /><rect x={hx - 1.2} y={(hx > sx ? cl - step : cl) - 3} width={2.4} height={2.4} fill="#fff" stroke="#111" strokeWidth={0.25} /></g>)}
    <rect x={x0} y={cl - 0.6} width={(t.cove ? sx : x1) - x0} height={1.6} fill="#f0f0ee" stroke="#111" strokeWidth={0.3} />
    {t.cove && <><rect x={sx + 8} y={cl - step - 0.6} width={x1 - sx - 8} height={1.6} fill="#f0f0ee" stroke="#111" strokeWidth={0.3} /><rect x={sx} y={cl - step - 0.6} width={1.6} height={step + 1.6} fill="#f0f0ee" stroke="#111" strokeWidth={0.3} />
      <rect x={sx + 2.4} y={cl - 3} width={4} height={1.6} fill="#ffd54a" stroke="#111" strokeWidth={0.2} /><text x={sx + 10} y={cl + 6} fontSize={2.4}>간접 조명 (단차 {f(step * 25)})</text></>}
    <line x1={x0 - 14} y1={cl + 60} x2={x1 + 14} y2={cl + 60} stroke="#111" strokeWidth={0.6} /><text x={x0 - 14} y={cl + 65} fontSize={2.4}>FL ±0 (높이 생략)</text>
    <Dim x1={x0 - 8} y1={cl + 1} x2={x0 - 8} y2={cl + 60} label={rooms.length ? `C.H ${[...new Set(rooms.map(r => r.ch).filter(Boolean))].map(v => f(v!)).join(' / ') || '확인 필요'}` : 'C.H'} />
    {t.layers.map((r, i) => <g key={i}><line x1={x0 + 60} y1={cl - 1} x2={x0 + 90} y2={cl + 16 + i * 6} stroke="#888" strokeWidth={0.12} /><text x={x0 + 92} y={cl + 17 + i * 6} fontSize={2.6}>{r}</text></g>)}
    <text x={AREA.x} y={AREA.y + AREA.h - 46} fontSize={2.8}>쓰는 실: {rooms.map(r => `${r.no} ${r.name}${r.ceiling.mat ? ` (${r.ceiling.mat})` : ''}`).join(' · ').slice(0, 120) || '-'}</text>
    <Bar code={t.code} line1={t.name} thk="" />
    <text x={AREA.x} y={AREA.y + AREA.h - 6} fontSize={2.6} fill="#555">표본 천장 상세도(ID-301~306)에 나온 부재 · 마감 표기로 만든 기본 유형입니다(유형 기호는 자체 기호). 틀 간격 · 조명 · 설비는 실에 맞춰 캐드에서 이어 그립니다.</text>
  </g>
}

/** Room finish schedule in the sample layout: one row per room, four parts each with 기호 · 마감재 · 상세. */
function Schedule({ rooms, matName }: { rooms: PlanRoom[]; matName: (code?: string) => string }) {
  const x0 = AREA.x, y0 = AREA.y + 14, rh = 6.2, pw = (AREA.w - 52) / 4, parts = [['floor', '바 닥 (floor)'], ['base', '걸 레 받 이 (base)'], ['wall', '벽 (wall)'], ['ceiling', '천 장 (ceiling)']] as const
  return <g fontSize={2.7}>
    <rect x={x0} y={y0} width={AREA.w} height={rh * 2} fill="#eee" />
    <text x={x0 + 2} y={y0 + 8} fontWeight={800}>실번호</text><text x={x0 + 18} y={y0 + 8} fontWeight={800}>실 명</text>
    {parts.map(([k, label], i) => { const px = x0 + 52 + pw * i; return <g key={k}>
      <line x1={px} y1={y0} x2={px} y2={y0 + rh * (rooms.length + 2)} stroke="#111" strokeWidth={0.25} />
      <text x={px + pw / 2} y={y0 + 4.4} textAnchor="middle" fontWeight={800}>{label}</text>
      <text x={px + 2} y={y0 + rh + 4.4} fontWeight={800}>기호</text><text x={px + 16} y={y0 + rh + 4.4} fontWeight={800}>마 감 재</text><text x={px + pw - 2} y={y0 + rh + 4.4} textAnchor="end" fontWeight={800}>{k === 'ceiling' ? '상세 · C.H' : '상세'}</text>
      {rooms.slice(0, 34).map((r, ri) => <g key={r.id}>
        <text x={px + 2} y={y0 + rh * (ri + 2) + 4.4}>{(r[k].mat ?? '').slice(0, 7)}</text><text x={px + 16} y={y0 + rh * (ri + 2) + 4.4}>{matName(r[k].mat).slice(0, Math.floor((pw - 30) / 2.2))}</text>
        <text x={px + pw - 2} y={y0 + rh * (ri + 2) + 4.4} textAnchor="end" fontWeight={800}>{k === 'ceiling' ? [r.ceiling.detail, r.ch ? f(r.ch) : ''].filter(Boolean).join(' · ') : r[k].detail ?? ''}</text>
      </g>)}
    </g> })}
    {rooms.slice(0, 34).map((r, ri) => <g key={r.id}><text x={x0 + 2} y={y0 + rh * (ri + 2) + 4.4}>{r.no.slice(0, 6)}</text><text x={x0 + 18} y={y0 + rh * (ri + 2) + 4.4} fontWeight={800}>{r.name.slice(0, 14)}</text>
      <line x1={x0} y1={y0 + rh * (ri + 3)} x2={x0 + AREA.w} y2={y0 + rh * (ri + 3)} stroke="#111" strokeWidth={0.12} /></g>)}
    <line x1={x0} y1={y0 + rh * 2} x2={x0 + AREA.w} y2={y0 + rh * 2} stroke="#111" strokeWidth={0.35} />
  </g>
}

/** Door list in the sample layout (ID-400, 1/40): each entry is an elevation with frame, plus 위치 · 종류 · SIZE · 마감 · 수량. */
function DoorList({ doors, scale }: { doors: DoorGroup[]; scale: number }) {
  const cw = AREA.w / DOORS_PER_SHEET, base = AREA.y + 130
  return <g>
    {doors.map((d, i) => {
      const cx = AREA.x + cw * i, w = d.width / scale, h = d.height / scale, fr = 2, x = cx + (cw - w) / 2, lw = Math.max(d.width - 53, 0), lh = Math.max(d.height - 26, 0)
      const rows: [string, string][] = [['위치', d.to.length ? `DOOR TO ${d.to.join(', ')}` : '확인 필요'], ['종류', d.type], ['SIZE 프레임', `${f(d.width)} X ${f(d.height)}`], ['SIZE 도어', `${f(lw)} X ${f(lh)}`], ['도어 마감', d.finish || '확인 필요'], ['프레임 마감', d.frame || '확인 필요'], ['수량', `${d.count} SET`]]
      return <g key={d.no}>
        {i > 0 && <line x1={cx} y1={AREA.y + 16} x2={cx} y2={AREA.y + AREA.h - 14} stroke="#111" strokeWidth={0.2} />}
        <text x={cx + 4} y={AREA.y + 24} fontSize={4.2} fontWeight={800}>{d.no}</text>
        <rect x={x - fr} y={base - h - fr} width={w + fr * 2} height={h + fr} fill="#e9e9e9" stroke="#111" strokeWidth={0.3} /><rect x={x} y={base - h} width={w} height={h} fill="#fff" stroke="#111" strokeWidth={0.4} />
        <line x1={x} y1={base - h} x2={x + w} y2={base - h / 2} stroke="#999" strokeWidth={0.15} /><line x1={x + w} y1={base - h / 2} x2={x} y2={base} stroke="#999" strokeWidth={0.15} />
        <circle cx={x + w - 2} cy={base - 1000 / scale} r={0.8} fill="#111" /><line x1={cx + 6} y1={base} x2={cx + cw - 6} y2={base} stroke="#111" strokeWidth={0.6} />
        <Dim x1={x} y1={base + 7} x2={x + w} y2={base + 7} label={f(d.width)} /><Dim x1={x - 8} y1={base - h} x2={x - 8} y2={base} label={f(d.height)} />
        {rows.map(([k, v], r) => <g key={k} fontSize={2.6}>
          <line x1={cx + 4} y1={base + 16 + r * 6.4} x2={cx + cw - 4} y2={base + 16 + r * 6.4} stroke="#111" strokeWidth={0.12} />
          <text x={cx + 5} y={base + 20.5 + r * 6.4} fill="#555">{k}</text><text x={cx + 27} y={base + 20.5 + r * 6.4} fontWeight={800} fill={v === '확인 필요' ? '#c00' : '#111'}>{v.slice(0, 26)}</text>
        </g>)}
      </g>
    })}
    <text x={AREA.x} y={AREA.y + AREA.h - 6} fontSize={2.6} fill="#555">도어 크기는 프레임 − 53 × − 26 (표본 도어 리스트의 값)으로 계산했습니다. 문 높이를 적지 않은 문은 2,100 입니다. 빨간 칸은 '평면 · 3D'에서 문을 골라 적어 주세요.</text>
  </g>
}

/** Three views (front · side · plan) of one furniture type with overall sizes. */
function FurnDetail({ item, count, scale }: { item: PlanItem; count: number; scale: number }) {
  const w = item.w / scale, d = item.d / scale, h = item.h / scale, gap = 26, x = AREA.x + (AREA.w - (w + gap + d)) / 2, y = AREA.y + 30 + (AREA.h - 60 - (h + gap + d)) / 2
  const box = (bx: number, by: number, bw: number, bh: number, label: string) => <g><rect x={bx} y={by} width={bw} height={bh} fill="#fafafa" stroke="#111" strokeWidth={0.4} /><text x={bx} y={by - 9} fontSize={2.8} fontWeight={800}>{label}</text></g>
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
  const { data: specs } = useAsync(() => api.listSpecItems(project.id), [project.id, version], [] as SpecItem[])
  const legend = useMemo(() => specs.filter(x => x.book === 'materials' && x.status !== 'dropped'), [specs])
  const g = plan ?? { unit: 'mm' as const, height: 2700, walls: [], openings: [], items: [] }
  const wallRows = useMemo(() => wallFinishRows(g), [plan]) // eslint-disable-line react-hooks/exhaustive-deps
  const sheets = useMemo(() => sheetList(g, rows.length + wallRows.length, legend.length), [plan, rows.length, wallRows.length, legend.length]) // eslint-disable-line react-hooks/exhaustive-deps
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
      {meta.kind === 'legend' && (legend.length ? <Table head={['번호', '재료 종류', '제조사 - 제품(색)', '쓰는 위치']} widths={[30, 50, 150, 100]} page={meta.page} rows={legend.map(x => [x.code ?? '', materialKind(x.code) || '', [x.maker, x.name, x.spec].filter(Boolean).join(' - '), x.location ?? ''])} />
        : <text x={AREA.x} y={AREA.y + 24} fontSize={3.2} fill="#c00">스펙북 '마감재'에 재료가 없습니다 — 스펙북 단계에서 재료 번호(PT-01 · TL-01 …)와 함께 넣으면 여기에 범례표가 만들어집니다.</text>)}
      {meta.kind === 'schedule' && <Schedule rooms={g.rooms ?? []} matName={c => { const x = legend.find(l => l.code && l.code.replace(/\s/g, '') === (c ?? '').replace(/\s/g, '')); return x ? [x.name, x.spec].filter(Boolean).join(' ') : '' }} />}
      {meta.kind === 'floorDetail' && FLOOR_TYPES.some(t => t.code === meta.wallType) && <FloorDetail t={FLOOR_TYPES.find(t => t.code === meta.wallType)!} />}
      {meta.kind === 'baseDetail' && BASE_TYPES.some(t => t.code === meta.wallType) && <BaseDetail t={BASE_TYPES.find(t => t.code === meta.wallType)!} />}
      {meta.kind === 'ceilDetail' && CEILING_TYPES.some(t => t.code === meta.wallType) && <CeilDetail t={CEILING_TYPES.find(t => t.code === meta.wallType)!} rooms={(g.rooms ?? []).filter(r => r.ceiling.detail === meta.wallType)} />}
      {meta.kind === 'finish' && <Table head={['공종', '품목', '규격', '수량', '단위']} widths={[50, 100, 120, 35, 25]} page={meta.page} rows={[...wallRows.map(r => ['벽 마감', r.label, r.finish, r.area, '㎡']), ...rows.map(r => [tname(r.trade_code), r.item, r.spec, r.qty, r.unit])]} />}
      {(meta.kind === 'plan' || meta.kind === 'ceiling' || meta.kind === 'furniture') && <PlanSheet g={g} mode={meta.kind} scale={sc} />}
      {meta.kind === 'elevation' && meta.wall && <Elevation g={g} wallId={meta.wall} scale={sc} finishes={finishes} />}
      {meta.kind === 'wallDetail' && meta.wallType && wallType(meta.wallType) && <WallTypeDetail t={wallType(meta.wallType)!} />}
      {meta.kind === 'wallDetail' && meta.t && <WallDetail t={meta.t} height={g.height} scale={sc} />}
      {meta.kind === 'doorDetail' && <DoorList doors={doorGroups(g).slice((meta.page ?? 0) * DOORS_PER_SHEET, ((meta.page ?? 0) + 1) * DOORS_PER_SHEET)} scale={sc} />}
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
      <p className="t-cap">도면 번호 · 표제란은 표본 도면 세트 기준(I-000 공통 · 재료마감범례표 · I-100 평면 시리즈 · 입면도 · ID-200 벽체 · ID-400 도어 · IF-700 가구 상세)입니다. 상세도는 치수에서 그린 기준도라 재질 · 내부 구조는 캐드에서 이 DXF를 열어 이어서 작업합니다(DWG 로 저장도 캐드에서). 'A3 PDF로 인쇄'는 인쇄 창에서 'PDF로 저장'을 고르세요.</p>
      <div ref={all} hidden>{sheets.map(render)}</div>
    </div>
  )
}
