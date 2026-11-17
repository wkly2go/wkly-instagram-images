// 평면 → 3D 장면 (2026-11-17 대표 지시 '평면과 3D 작업공간을 더욱 현실에 맞게')
// 벽(문 · 창 자리에서 끊고 모서리는 맞물리게) · 바닥 · 천장 · 걸레받이 · 문 · 창 · 부품 · 크기 가늠용 사람을 세운다.
// 평면이 바뀌면 달라진 것만 다시 만든다 — 부품을 끄는 동안에도 가볍게 따라온다.
// 좌표: 평면 x → X, 평면 y(화면 아래쪽) → Z, 높이 → Y. 단위 m.
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { floorOutline, wallLength, type PlanGeometry, type PlanOpening, type PlanWall } from './designPlan.ts'
import { along, doorStyle, planBounds, wallFrame, wallPieces, DOOR_H, HEAD_H, SILL_H, type Pt, type WallPiece } from './designPlanDraw.ts'
import { itemShape, mix, SHAPE_COLOR, type FinishKind, type FinishLook, type ItemShape } from './designPlanLook.ts'
import { buildItem, buildPerson, Kit, type Tone } from './designPlan3dParts.ts'
import { surfaceTexture, type TexSpec } from './designPlan3dTex.ts'

export type Look3D = (finish?: string | null, fallback?: FinishKind) => FinishLook
/** 눈높이로 걸을 때 막히는 벽 구간 (문 자리는 뚫려 있다) */
export interface Solid { ax: number; az: number; bx: number; bz: number; half: number }
export interface SceneInfo {
  empty: boolean
  /** 기존 벽이 닫힌 방을 이루는지 (아니면 바닥은 전체를 감싸는 사각형) */
  closed: boolean
  /** 천장 높이 m */
  H: number
  center: { x: number; z: number }
  /** 눈높이 보기의 첫 자리와 바라보는 방향 */
  eye: { x: number; z: number; yaw: number }
  person: { x: number; z: number; yaw: number }
  solids: Solid[]
}

/** 벽 윗면(자른 면) 색: 짙고 따뜻한 회갈색 — 단면 모형처럼 읽히게. 새 가벽은 조금 밝게 */
const CAP = '#6e665d', CAP_NEW = '#93877a'
/** 여닫이 문이 열린 각도 */
const OPEN = (70 * Math.PI) / 180
/** 평면에서 90° 돌린 부품의 방향: 화면에서 시계 방향 (등받이가 위쪽 → 오른쪽) */
const ROT90 = -Math.PI / 2
const cl = (v: number, lo: number, hi: number) => (hi < lo ? hi : Math.min(hi, Math.max(lo, v)))
const lookKey = (l: FinishLook) => `${l.kind}|${l.color}|${l.roughness}|${l.metalness}`

interface Corners { sl: Pt; sr: Pt; el: Pt; er: Pt }
const near = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) < 1 && Math.abs(ay - by) < 1

/** 벽 바닥면의 네 모서리. 두 벽이 끝에서 만나는 모서리는 서로 비스듬히 맞물리게(빈 틈 · 겹침 없이) */
export function wallCorners(walls: PlanWall[]): Map<string, Corners> {
  const out = new Map<string, Corners>()
  for (const w of walls) {
    const f = wallFrame(w), h = w.t / 2
    const c: Corners = { sl: along(w, f, 0, h), sr: along(w, f, 0, -h), el: along(w, f, f.len, h), er: along(w, f, f.len, -h) }
    for (const end of ['s', 'e'] as const) {
      const ex = end === 's' ? w.x1 : w.x2, ey = end === 's' ? w.y1 : w.y2
      const others = walls.filter(o => o !== w && (near(o.x1, o.y1, ex, ey) || near(o.x2, o.y2, ex, ey)))
      if (others.length === 0) {
        // 다른 벽의 중간에 닿은 끝(T 자): 그 벽의 면에서 멈춘다 (벽 속으로 파고들어 윗면이 겹치지 않게)
        const da = end === 's' ? { x: f.ux, y: f.uy } : { x: -f.ux, y: -f.uy }
        for (const o of walls) {
          if (o === w) continue
          const of = wallFrame(o), t = (ex - o.x1) * of.ux + (ey - o.y1) * of.uy, off = (ex - o.x1) * of.nx + (ey - o.y1) * of.ny
          const cross = da.x * of.uy - da.y * of.ux
          if (Math.abs(off) > 1 || t < 1 || t > of.len - 1 || Math.abs(cross) < 0.08) continue
          // 이 벽이 뻗어 나가는 쪽의 면
          const sg = da.x * of.nx + da.y * of.ny >= 0 ? 1 : -1, qx = ex + of.nx * sg * (o.t / 2), qy = ey + of.ny * sg * (o.t / 2)
          const cut = (s: 1 | -1): Pt => {
            const px = ex + da.y * h * s, py = ey - da.x * h * s, k = ((qx - px) * of.uy - (qy - py) * of.ux) / cross
            return { x: px + da.x * k, y: py + da.y * k }
          }
          const plus = cut(1), minus = cut(-1)
          if (Math.hypot(plus.x - ex, plus.y - ey) > 4 * Math.max(h, o.t / 2) + 1 || Math.hypot(minus.x - ex, minus.y - ey) > 4 * Math.max(h, o.t / 2) + 1) break
          if (end === 's') { c.sl = plus; c.sr = minus } else { c.er = plus; c.el = minus }
          break
        }
        continue
      }
      if (others.length !== 1) continue
      const o = others[0], of = wallFrame(o), oh = o.t / 2, oStart = near(o.x1, o.y1, ex, ey)
      // 모서리에서 멀어지는 방향
      const da = end === 's' ? { x: f.ux, y: f.uy } : { x: -f.ux, y: -f.uy }
      const db = oStart ? { x: of.ux, y: of.uy } : { x: -of.ux, y: -of.uy }
      const cross = da.x * db.y - da.y * db.x
      if (Math.abs(cross) < 0.08) continue // 거의 일직선이면 맞대기
      const pa = { x: da.y, y: -da.x }, pb = { x: db.y, y: -db.x }
      // 이 벽의 한쪽 면과 이웃 벽의 맞은편 면이 만나는 점
      const hit = (s: 1 | -1): Pt => {
        const px = ex + pa.x * h * s, py = ey + pa.y * h * s, qx = ex - pb.x * oh * s, qy = ey - pb.y * oh * s
        const k = ((qx - px) * db.y - (qy - py) * db.x) / cross
        return { x: px + da.x * k, y: py + da.y * k }
      }
      const plus = hit(1), minus = hit(-1), lim = 4 * Math.max(h, oh) + 1
      if (Math.hypot(plus.x - ex, plus.y - ey) > lim || Math.hypot(minus.x - ex, minus.y - ey) > lim) continue
      if (end === 's') { c.sl = plus; c.sr = minus } else { c.er = plus; c.el = minus }
    }
    out.set(w.id, c)
  }
  return out
}

/** 점이 다각형 안에 있는지 (mm) */
export function insidePolygon(pts: Pt[], x: number, y: number): boolean {
  let r = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) r = !r
  }
  return r
}

interface UvFrame { ox: number; oy: number; ux: number; uy: number; tw: number; th: number; upright: boolean }
/** 벽 조각 하나: 바닥면 네 점(mm)을 y0~y1(m) 로 세운 기둥. 윗면은 따로 색을 입힐 수 있게 묶음을 나눈다 */
function prism(q: Pt[], y0: number, y1: number, m: UvFrame, capTop: boolean): THREE.BufferGeometry {
  const P = q.map(p => ({ x: p.x / 1000, z: p.y / 1000 }))
  const cx = (P[0].x + P[1].x + P[2].x + P[3].x) / 4, cz = (P[0].z + P[1].z + P[2].z + P[3].z) / 4
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  const map = (a: number, b: number) => (m.upright ? [b / m.tw, a / m.th] : [a / m.tw, b / m.th])
  const quad = (v: number[][], n: number[], t: number[][]) => {
    const i = pos.length / 3
    for (let k = 0; k < 4; k++) { pos.push(...v[k]); nor.push(...n); uv.push(...t[k]) }
    // 면이 n 쪽을 보도록 감는 순서를 맞춘다
    const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]]
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] >= 0) idx.push(i, i + 1, i + 2, i, i + 2, i + 3)
    else idx.push(i, i + 2, i + 1, i, i + 3, i + 2)
  }
  for (let k = 0; k < 4; k++) {
    const A = P[k], B = P[(k + 1) % 4], dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    let nx = dz / len, nz = -dx / len
    if (nx * ((A.x + B.x) / 2 - cx) + nz * ((A.z + B.z) / 2 - cz) < 0) { nx = -nx; nz = -nz }
    // 무늬는 벽을 따라 잰 길이로 이어 붙인다 (끝면은 두께 방향)
    const lengthwise = Math.abs(dx * m.ux + dz * m.uy) >= Math.abs(dx * m.uy - dz * m.ux)
    const u = (p: { x: number; z: number }) => (lengthwise ? (p.x - m.ox) * m.ux + (p.z - m.oy) * m.uy : (p.x - m.ox) * m.uy - (p.z - m.oy) * m.ux)
    quad([[A.x, y0, A.z], [B.x, y0, B.z], [B.x, y1, B.z], [A.x, y1, A.z]], [nx, 0, nz], [map(u(A), y0), map(u(B), y0), map(u(B), y1), map(u(A), y1)])
  }
  quad(P.map(p => [p.x, y0, p.z]), [0, -1, 0], P.map(p => map(p.x, p.z)))
  const body = idx.length
  quad(P.map(p => [p.x, y1, p.z]), [0, 1, 0], P.map(p => map(p.x, p.z)))
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.addGroup(0, body, 0)
  geo.addGroup(body, idx.length - body, capTop ? 1 : 0)
  return geo
}

/** 바닥 · 천장 판: 평면 꼭짓점(mm)을 높이 y(m)에. up 이면 위를, 아니면 아래를 본다 */
function slab(pts: Pt[], y: number, up: boolean, tw: number, th: number, turn: boolean): THREE.BufferGeometry {
  const c = pts.map(p => new THREE.Vector2(p.x / 1000, p.y / 1000))
  const tris = THREE.ShapeUtils.triangulateShape(c, [])
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  for (const p of c) { pos.push(p.x, y, p.y); nor.push(0, up ? 1 : -1, 0); if (turn) uv.push(p.y / tw, p.x / th); else uv.push(p.x / tw, p.y / th) }
  for (const [a, b, d] of tris) {
    const A = c[a], B = c[b], D = c[d]
    const ny = (B.y - A.y) * (D.x - A.x) - (B.x - A.x) * (D.y - A.y)
    if (ny > 0 === up) idx.push(a, b, d); else idx.push(a, d, b)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  return geo
}

/** 바깥벽의 가운데 점과 바깥쪽 방향 (m) — 보는 쪽을 가리는 벽을 낮출 때 쓴다 */
interface Outward { x: number; z: number; nx: number; nz: number }
interface Entry { key: string; pose: string; obj: THREE.Object3D; kit: Kit; out?: Outward | null; wallId?: string }
interface Want { id: string; key: string; name: string; make: () => Kit; pose?: string; place?: (obj: THREE.Object3D) => void; out?: Outward | null; wallId?: string }

export class PlanScene {
  /** 평면에서 나온 모든 것 */
  readonly root = new THREE.Group()
  // 3D 파일(.glb)에 들어가는 것
  readonly floorG = new THREE.Group()
  readonly wallG = new THREE.Group()
  readonly openG = new THREE.Group()
  readonly itemG = new THREE.Group()
  // 화면에서만 보이는 것
  readonly ceilG = new THREE.Group()
  readonly personG = new THREE.Group()
  readonly outlineG = new THREE.Group()
  /** 벽 · 부품 전체 범위 (m) */
  readonly bounds = new THREE.Box3()
  info: SceneInfo = { empty: true, closed: false, H: 2.7, center: { x: 0, z: 0 }, eye: { x: 0, z: 0, yaw: 0 }, person: { x: 0, z: 0, yaw: 0 }, solids: [] }

  private tex: (spec: TexSpec) => THREE.Texture | null
  private pink: string
  private walls = new Map<string, Entry>()
  private opens = new Map<string, Entry>()
  private items = new Map<string, Entry>()
  private floor = new Map<string, Entry>()
  private ceil = new Map<string, Entry>()
  private person: Kit | null = null
  private outline: { sig: string; geo: LineSegmentsGeometry; mats: LineMaterial[] } | null = null
  private cuts = new Set<string>()

  constructor(o: { tex?: (spec: TexSpec) => THREE.Texture | null; pink?: string } = {}) {
    this.tex = o.tex ?? (() => null)
    this.pink = o.pink ?? '#fd37be'
    this.floorG.name = '바닥'; this.wallG.name = '벽'; this.openG.name = '문 · 창'; this.itemG.name = '가구 · 기구'
    this.ceilG.name = '천장'; this.personG.name = '사람 (키 1.7m)'
    this.ceilG.visible = false
    this.root.add(this.floorG, this.wallG, this.openG, this.itemG, this.ceilG, this.personG, this.outlineG)
  }

  /** 평면에 맞춘다. 달라진 것이 있으면 true */
  sync(plan: PlanGeometry, look: Look3D, selected: string | null): boolean {
    const H = plan.height > 0 ? plan.height : 2700, Hm = H / 1000
    const g: PlanGeometry = plan.height === H ? plan : { ...plan, height: H }
    const ok = (...v: unknown[]) => v.every(n => typeof n === 'number' && Number.isFinite(n))
    const walls = g.walls.filter(w => ok(w.x1, w.y1, w.x2, w.y2) && wallLength(w) > 1).map(w => (w.t >= 10 ? w : { ...w, t: 10 }))
    const byId = new Map(walls.map(w => [w.id, w]))
    const outline = floorOutline(walls.filter(w => w.kind === 'existing'))
    const corners = wallCorners(walls)
    const room = (k: 'floor' | 'wall' | 'ceiling' | 'base') => g.rooms?.find(r => r[k]?.mat?.trim())?.[k]?.mat?.trim() ?? ''
    let changed = false

    // 벽
    const roomWall = room('wall'), baseText = room('base'), baseLook = baseText ? look(baseText, 'plain') : null
    changed = this.reconcile(this.walls, this.wallG, walls.map(w => {
      const text = w.finish?.trim() || roomWall, lk = look(text, 'paint'), pieces = wallPieces(w, g.openings, H), c = corners.get(w.id)!
      // 닫힌 방의 바깥벽이면 어느 쪽이 방 안인지 안다 (벽 진행 방향의 왼쪽 1 · 오른쪽 -1). 걸레받이는 방 안쪽 면에, 새 가벽은 양쪽에
      const f = wallFrame(w), m = along(w, f, f.len / 2, w.t / 2 + 60), mid = along(w, f, f.len / 2)
      const inner: 1 | -1 | 0 = w.kind === 'existing' && outline ? (insidePolygon(outline, m.x, m.y) ? 1 : -1) : 0
      const sides: (1 | -1)[] = !baseLook ? [] : inner ? [inner] : [1, -1]
      const out: Outward | null = inner ? { x: mid.x / 1000, z: mid.y / 1000, nx: -inner * f.nx, nz: -inner * f.ny } : null
      const key = JSON.stringify([w.x1, w.y1, w.x2, w.y2, w.t, w.kind, H, pieces, c, lookKey(lk), surfaceTexture(lk.kind, 'wall', text)?.key, baseLook && lookKey(baseLook), sides, !!out])
      return { id: w.id, key, name: `벽 · ${text || (w.kind === 'new' ? '새 가벽' : '기존 벽')}`, out, make: () => this.makeWall(w, c, pieces, H, lk, text, baseLook, baseText, sides, !!out) }
    })) || changed

    // 문 · 창
    changed = this.reconcile(this.opens, this.openG, g.openings.filter(o => byId.has(o.wall) && ok(o.pos, o.width)).map(o => {
      const w = byId.get(o.wall)!
      const leaf = look(o.finish, o.kind === 'window' || doorStyle(o) === 'glass' ? 'glass' : 'wood'), frame = o.frame?.trim() ? look(o.frame, o.kind === 'door' ? 'wood' : 'plain') : null
      const key = JSON.stringify([o, w.x1, w.y1, w.x2, w.y2, w.t, H, lookKey(leaf), frame && lookKey(frame)])
      return { id: o.id, key, name: o.kind === 'door' ? `문${o.to?.trim() ? ` · ${o.to.trim()}` : ''}` : '창', wallId: w.id, make: () => this.makeOpening(o, w, H, leaf, frame) }
    })) || changed

    // 가구 · 기구
    changed = this.reconcile(this.items, this.itemG, g.items.filter(it => ok(it.x, it.y, it.w, it.d, it.h)).map(it => {
      const shape = itemShape(it.name, it.shape), lk = it.finish?.trim() ? look(it.finish) : null
      const tone: Tone = lk ? { c: lk.color, rough: lk.roughness, metal: lk.metalness, opacity: lk.kind === 'glass' ? 0.35 : 1 } : { c: SHAPE_COLOR[shape], rough: 0.8, metal: 0, opacity: 1 }
      const w = Math.max(it.w, 5) / 1000, d = Math.max(it.d, 5) / 1000, h = Math.max(it.h, 3) / 1000
      const z = it.z != null && it.z > 0 ? it.z / 1000 : 0
      // 펜던트는 천장에 매단다: 띄운 높이가 적혀 있으면 그 높이, 없으면 머리 위(2m 쯤)까지 내려온다
      const hang = shape === 'pendant' ? Math.max(0, z > 0 ? Math.min(z, Hm - h) : Hm - h - cl(Hm - 2 - h, 0.15, 0.9)) : 0
      const drop = shape === 'pendant' ? Math.max(0, Hm - hang - h) : 0
      const floating = shape === 'tv' ? (it.z ?? 900) > 0 : z > 0
      const key = JSON.stringify([shape, w, d, h, tone, it.name, floating, Math.round(drop * 1000)])
      const fw = it.rot === 90 ? d : w, fd = it.rot === 90 ? w : d
      return {
        id: it.id, key, name: it.name.trim() || '부품', make: () => this.makeItem(shape, w, d, h, tone, { name: it.name, floating, drop }),
        pose: JSON.stringify([it.x, it.y, it.rot, it.z ?? null, H]),
        place: (obj: THREE.Object3D) => {
          const size = obj.userData.size as [number, number, number]
          const y = shape === 'downlight' ? Hm - size[1] : shape === 'pendant' ? hang : shape === 'tv' ? Math.max(0, it.z ?? 900) / 1000 : z
          obj.position.set(it.x / 1000 + fw / 2, y, it.y / 1000 + fd / 2)
          obj.rotation.y = it.rot === 90 ? ROT90 : 0
        },
      }
    })) || changed

    // 범위
    const b = this.bounds.makeEmpty()
    for (const w of walls) { const c = corners.get(w.id)!; for (const p of [c.sl, c.sr, c.el, c.er]) { b.expandByPoint(new THREE.Vector3(p.x / 1000, 0, p.y / 1000)); b.expandByPoint(new THREE.Vector3(p.x / 1000, Hm, p.y / 1000)) } }
    for (const e of this.items.values()) { e.obj.updateWorldMatrix(false, true); b.expandByObject(e.obj) }
    const empty = b.isEmpty()

    // 바닥 · 천장: 닫힌 방이면 그 모양, 아니면 그려진 것 전체를 감싸는 사각형
    const pb = planBounds(g)
    const pts = outline ?? (pb ? [{ x: pb.x0 - 300, y: pb.y0 - 300 }, { x: pb.x1 + 300, y: pb.y0 - 300 }, { x: pb.x1 + 300, y: pb.y1 + 300 }, { x: pb.x0 - 300, y: pb.y1 + 300 }] : null)
    const xs = pts?.map(p => p.x) ?? [0], ys = pts?.map(p => p.y) ?? [0]
    const turn = Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs) // 마루 널은 방의 긴 쪽으로
    const floorText = room('floor'), floorLook = look(floorText, 'wood'), ceilText = room('ceiling'), ceilLook = look(ceilText, 'paint')
    changed = this.reconcile(this.floor, this.floorG, pts ? [{ id: 'floor', key: JSON.stringify([pts, lookKey(floorLook), surfaceTexture(floorLook.kind, 'floor', floorText)?.key, turn]), name: `바닥 · ${floorText || '마감 미정'}`, make: () => this.makeSlab(pts, 0, true, floorLook, floorText, 'floor', turn) }] : []) || changed
    changed = this.reconcile(this.ceil, this.ceilG, pts && walls.length ? [{ id: 'ceiling', key: JSON.stringify([pts, H, lookKey(ceilLook), surfaceTexture(ceilLook.kind, 'ceiling', ceilText)?.key, turn]), name: `천장 · ${ceilText || '마감 미정'}`, make: () => this.makeSlab(pts, Hm, false, ceilLook, ceilText, 'ceiling', turn) }] : []) || changed

    // 사람 · 눈높이 자리 · 막히는 벽
    const info = this.describe(g, walls, byId, outline, empty, Hm)
    if (JSON.stringify(info) !== JSON.stringify(this.info)) changed = true
    this.info = info
    if (!this.person) { this.person = buildPerson(); this.personG.add(this.person.body); changed = true }
    this.personG.position.set(info.person.x, 0, info.person.z)
    this.personG.rotation.y = info.person.yaw

    return this.syncOutline(selected) || changed
  }

  private reconcile(map: Map<string, Entry>, group: THREE.Group, wants: Want[]): boolean {
    let changed = false
    const seen = new Set<string>()
    for (const w of wants) {
      let id = w.id
      for (let n = 2; seen.has(id); n++) id = `${w.id}#${n}`
      seen.add(id)
      let e = map.get(id)
      if (!e || e.key !== w.key) {
        if (e) { group.remove(e.obj); e.kit.free() }
        const kit = w.make(), obj = new THREE.Group()
        obj.add(kit.body, kit.extra)
        obj.userData.size = kit.body.userData.size
        e = { key: w.key, pose: '\u0000', obj, kit }
        group.add(obj)
        map.set(id, e)
        changed = true
      }
      e.obj.name = w.name
      e.out = w.out
      e.wallId = w.wallId
      if (w.place && e.pose !== w.pose) { w.place(e.obj); e.pose = w.pose ?? ''; changed = true }
    }
    for (const [id, e] of map) if (!seen.has(id)) { group.remove(e.obj); e.kit.free(); map.delete(id); changed = true }
    return changed
  }

  private surface(k: Kit, lk: FinishLook, use: 'floor' | 'wall' | 'ceiling', text: string) {
    const spec = lk.kind === 'glass' ? null : surfaceTexture(lk.kind, use, text)
    const map = spec ? this.tex(spec) : null
    const mat = lk.kind === 'glass' ? k.mat(lk.color, { rough: 0.08, opacity: 0.32, name: text || '유리' }) : k.mat(lk.color, { rough: lk.roughness, metal: lk.metalness, map, name: text || undefined })
    return { mat, tw: spec && map ? spec.w : 1, th: spec && map ? spec.h : 1, upright: !!(spec && map && spec.upright) }
  }

  private makeWall(w: PlanWall, c: Corners, pieces: WallPiece[], H: number, lk: FinishLook, text: string, baseLook: FinishLook | null, baseText: string, sides: (1 | -1)[], stub: boolean): Kit {
    const k = new Kit(), f = wallFrame(w), s = this.surface(k, lk, 'wall', text)
    const cap = k.mat(w.kind === 'new' ? CAP_NEW : CAP, { rough: 0.95, name: '벽 단면' })
    const uv: UvFrame = { ox: w.x1 / 1000, oy: w.y1 / 1000, ux: f.ux, uy: f.uy, tw: s.tw, th: s.th, upright: s.upright }
    for (const p of pieces) {
      const a = p.from <= 0.5 ? [c.sl, c.sr] : [along(w, f, p.from, w.t / 2), along(w, f, p.from, -w.t / 2)]
      const b = p.to >= f.len - 0.5 ? [c.el, c.er] : [along(w, f, p.to, w.t / 2), along(w, f, p.to, -w.t / 2)]
      k.put(prism([a[0], b[0], b[1], a[1]], p.z0 / 1000, p.z1 / 1000, uv, p.z1 >= H - 0.5), [s.mat, cap])
      // 낮춘 모습: 바닥에 닿은 조각만 10cm 높이로 (문 자리는 비어 보인다). 평소에는 숨겨 둔다
      if (stub && p.z0 === 0) {
        const low = k.put(prism([a[0], b[0], b[1], a[1]], 0, Math.min(0.1, p.z1 / 1000), uv, true), [s.mat, cap])
        low.visible = false
        low.userData.stub = true
        low.userData.noEdge = true
      }
    }
    if (baseLook && H >= 300) {
      // 걸레받이: 바닥에 닿은 조각의 안쪽 면을 따라 얇은 띠
      const bm = k.mat(baseLook.color, { rough: baseLook.roughness, metal: baseLook.metalness, name: baseText })
      const proj = (p: Pt) => (p.x - w.x1) * f.ux + (p.y - w.y1) * f.uy
      for (const side of sides) {
        const lo = proj(side === 1 ? c.sl : c.sr), hi = proj(side === 1 ? c.el : c.er)
        for (const p of pieces.filter(q => q.z0 === 0)) {
          const from = p.from <= 0.5 ? lo : p.from, to = p.to >= f.len - 0.5 ? hi : p.to
          if (to - from < 20) continue
          const m = along(w, f, (from + to) / 2, side * (w.t / 2 + 5))
          k.box((to - from) / 1000, 0.08, 0.01, m.x / 1000, 0, m.y / 1000, bm).rotation.y = -Math.atan2(f.uy, f.ux)
        }
      }
    }
    return k
  }

  private makeOpening(o: PlanOpening, w: PlanWall, H: number, leafLook: FinishLook, frameLook: FinishLook | null): Kit {
    const k = new Kit(), f = wallFrame(w)
    const a = Math.max(0, o.pos - o.width / 2), b = Math.min(f.len, o.pos + o.width / 2)
    const W = (b - a) / 1000, T = w.t / 1000
    if (!(W >= 0.15)) return k
    // 벽을 따라 x, 높이 y, 벽의 오른쪽(평면 진행 방향 기준)이 +z 인 자리에 만든다
    const mid = along(w, f, (a + b) / 2)
    k.body.position.set(mid.x / 1000, 0, mid.y / 1000)
    k.body.rotation.y = -Math.atan2(f.uy, f.ux)
    const metal = k.mat('#b4b8bc', { rough: 0.3, metal: 0.85 })
    if (o.kind === 'window') {
      const z0 = Math.min(SILL_H, H) / 1000, z1 = Math.min(HEAD_H, H) / 1000, hh = z1 - z0
      if (hh < 0.1) return k
      const fm = k.mat(frameLook?.color ?? '#f1efe9', { rough: frameLook?.roughness ?? 0.5, metal: frameLook?.metalness ?? 0, name: o.frame?.trim() || '창틀' })
      const fs = Math.min(0.05, W * 0.12, hh * 0.2), fd = cl(T * 0.6, Math.min(T, 0.05), 0.14)
      k.box(W, fs, fd, 0, z0, 0, fm); k.box(W, fs, fd, 0, z1 - fs, 0, fm)
      for (const s of [-1, 1]) k.box(fs, hh - 2 * fs, fd, s * (W / 2 - fs / 2), z0 + fs, 0, fm)
      const n = Math.max(1, Math.round(W / 0.9))
      for (let i = 1; i < n; i++) k.box(fs * 0.8, hh - 2 * fs, fd * 0.8, -W / 2 + (W * i) / n, z0 + fs, 0, fm)
      k.box(W - 2 * fs, hh - 2 * fs, 0.008, 0, z0 + fs, 0, k.mat(leafLook.kind === 'glass' ? leafLook.color : '#bcd6de', { rough: 0.05, opacity: 0.28, name: o.finish?.trim() || '유리' }))
      if (z0 > 0.05) k.box(W + 0.06, 0.03, T + 0.07, 0, z0 - 0.03, 0, k.mat('#ebe8e1', { rough: 0.5, name: '창대' }))
      return k
    }
    const top = Math.min(o.height || DOOR_H, H) / 1000, style = doorStyle(o)
    if (top < 0.3) return k
    const glass = style === 'glass'
    const fm = k.mat(frameLook ? frameLook.color : glass ? '#9a9fa3' : mix(leafLook.color, '#5b4a38', 0.22), { rough: frameLook?.roughness ?? (glass ? 0.4 : 0.6), metal: frameLook?.metalness ?? (glass ? 0.6 : 0), name: o.frame?.trim() || '문틀' })
    const lm = glass ? k.mat(leafLook.kind === 'glass' ? leafLook.color : '#bcd6de', { rough: 0.06, opacity: 0.3, name: o.finish?.trim() || '유리 문' }) : k.mat(leafLook.color, { rough: leafLook.roughness, metal: leafLook.metalness, name: o.finish?.trim() || '문짝' })
    const jt = Math.min(0.04, W * 0.08), fd = T + 0.02
    for (const s of [-1, 1]) k.box(jt, top, fd, s * (W / 2 - jt / 2), 0, 0, fm)
    k.box(W - 2 * jt, jt, fd, 0, top - jt, 0, fm)
    // 열리는 쪽: 평면에서 벽 진행 방향의 왼쪽(1)이 여기서는 -z
    const side = o.side === -1 ? -1 : 1, hs = o.hinge === 'end' ? 1 : -1
    const lh = top - jt - 0.008, cw = W - 2 * jt, lt = glass ? 0.012 : 0.04
    if (style === 'slide') {
      // 미닫이: 문짝이 벽면을 따라 반쯤 열린 모습, 위에는 레일
      const z = -side * (T / 2 + 0.035 / 2 + 0.008)
      k.box(W, lh, 0.035, (hs * W) / 2, 0.006, z, lm)
      k.box(W * 2, 0.045, 0.05, (hs * W) / 2, top, z, metal)
      k.box(0.02, 0.3, 0.015, hs * 0.07, 0.9, z - side * (0.035 / 2 + 0.0075), metal)
      return k
    }
    const leaf = (lw: number, hsign: number) => {
      // 경첩 쪽에 축을 두고 70° 연다
      const pivot = new THREE.Group()
      pivot.position.set(hsign * (cw / 2), 0, -side * Math.max(0, T / 2 - lt / 2))
      pivot.rotation.y = -side * hsign * OPEN
      k.body.add(pivot)
      const cx = (-hsign * lw) / 2, tip = -hsign * (lw - Math.min(0.07, lw * 0.15))
      k.box(lw, lh, lt, cx, 0.006, 0, lm, 0, pivot)
      if (glass) {
        for (const y of [0.006, lh - 0.05]) k.box(lw, 0.056, 0.022, cx, y, 0, metal, 0, pivot)
        for (const s of [-1, 1]) k.cyl(0.011, 0.011, Math.min(0.45, lh * 0.3), tip, Math.min(0.85, lh * 0.4), s * (lt / 2 + 0.03), metal, { seg: 10, into: pivot })
      } else if (lh > 1.2) {
        // 손잡이: 문 양쪽에 받침과 레버 (레버는 경첩 쪽을 향한다)
        for (const s of [-1, 1]) {
          k.cyl(0.024, 0.024, 0.012, tip, 0.994, s * (lt / 2 + 0.006), metal, { seg: 16, into: pivot }).rotation.x = Math.PI / 2
          k.box(Math.min(0.12, lw * 0.3), 0.018, 0.018, tip + hsign * Math.min(0.05, lw * 0.12), 0.991, s * (lt / 2 + 0.021), metal, 0, pivot)
        }
      }
    }
    if (style === 'double') { leaf(cw / 2 - 0.003, -1); leaf(cw / 2 - 0.003, 1) } else leaf(cw - 0.006, hs)
    return k
  }

  private makeItem(shape: ItemShape, w: number, d: number, h: number, tone: Tone, ctx: { name: string; floating: boolean; drop: number }): Kit {
    const { kit, size } = buildItem(shape, w, d, h, tone, ctx)
    kit.body.userData.size = size
    return kit
  }

  private makeSlab(pts: Pt[], y: number, up: boolean, lk: FinishLook, text: string, use: 'floor' | 'ceiling', turn: boolean): Kit {
    const k = new Kit(), s = this.surface(k, lk.kind === 'glass' ? { ...lk, kind: 'plain' } : lk, use, text)
    const mesh = k.put(slab(pts, y, up, s.tw, s.th, turn), s.mat)
    mesh.castShadow = false
    mesh.receiveShadow = up
    return k
  }

  /** 사람 자리 · 눈높이 첫 자리 · 걸을 때 막히는 벽 */
  private describe(g: PlanGeometry, walls: PlanWall[], byId: Map<string, PlanWall>, outline: Pt[] | null, empty: boolean, Hm: number): SceneInfo {
    const b = this.bounds
    let cx = empty ? 0 : ((b.min.x + b.max.x) / 2) * 1000, cy = empty ? 0 : ((b.min.z + b.max.z) / 2) * 1000
    if (outline) {
      // 넓이 중심
      let s = 0, sx = 0, sy = 0
      for (let i = 0; i < outline.length; i++) { const p = outline[i], q = outline[(i + 1) % outline.length], k = p.x * q.y - q.x * p.y; s += k; sx += (p.x + q.x) * k; sy += (p.y + q.y) * k }
      if (Math.abs(s) > 1) { cx = sx / (3 * s); cy = sy / (3 * s) }
    }
    const solids: Solid[] = []
    for (const w of walls) {
      const f = wallFrame(w)
      let cur = 0
      const push = (from: number, to: number) => { if (to - from > 1) { const p = along(w, f, from), q = along(w, f, to); solids.push({ ax: p.x / 1000, az: p.y / 1000, bx: q.x / 1000, bz: q.y / 1000, half: w.t / 2000 }) } }
      for (const o of g.openings.filter(x => x.wall === w.id && x.kind === 'door').sort((p, q) => p.pos - q.pos)) {
        const from = Math.max(cur, o.pos - o.width / 2), to = Math.min(f.len, o.pos + o.width / 2)
        if (to <= from) continue
        push(cur, from)
        cur = to
      }
      push(cur, f.len)
    }
    const free = (x: number, y: number, pad: number) => {
      if (outline && !insidePolygon(outline, x, y)) return false
      for (const it of g.items) { const fw = it.rot === 90 ? it.d : it.w, fd = it.rot === 90 ? it.w : it.d; if (x > it.x - pad && x < it.x + fw + pad && y > it.y - pad && y < it.y + fd + pad) return false }
      for (const w of walls) {
        const f = wallFrame(w), t = Math.max(0, Math.min(f.len, (x - w.x1) * f.ux + (y - w.y1) * f.uy)), p = along(w, f, t)
        if (Math.hypot(x - p.x, y - p.y) < w.t / 2 + pad) return false
      }
      return true
    }
    const yawTo = (x: number, y: number, tx: number, ty: number) => Math.atan2(-(tx - x), -(ty - y))
    let eye = { x: cx, y: cy + 1, yaw: 0 }, person = { x: cx, y: cy, yaw: 0 }
    const door = g.openings.find(o => o.kind === 'door' && byId.has(o.wall))
    if (door) {
      const w = byId.get(door.wall)!, f = wallFrame(w), pos = Math.max(0, Math.min(f.len, door.pos))
      const p1 = along(w, f, pos, w.t / 2 + 600), p2 = along(w, f, pos, -(w.t / 2 + 600))
      // 문에서 방 안쪽
      const s = outline ? (insidePolygon(outline, p1.x, p1.y) ? 1 : insidePolygon(outline, p2.x, p2.y) ? -1 : door.side === -1 ? -1 : 1) : Math.hypot(p1.x - cx, p1.y - cy) <= Math.hypot(p2.x - cx, p2.y - cy) ? 1 : -1
      // 문을 막 들어선 자리 (가구에 막혀 있으면 조금 더 안쪽 · 옆으로)
      // 문짝이 방 안으로 열리면 열린 문짝을 지나 더 안쪽에 선다
      const swingsIn = doorStyle(door) !== 'slide' && (door.side === -1 ? -1 : 1) === s, first = swingsIn ? door.width + 350 : 650
      const e = ([[0, first], [0, first + 400], [0, 400], [400, first + 200], [-400, first + 200], [0, first + 900]] as [number, number][]).map(([da, dn]) => along(w, f, pos + da, s * (w.t / 2 + dn))).find(p => free(p.x, p.y, 200)) ?? along(w, f, pos, s * (w.t / 2 + first))
      eye = { x: e.x, y: e.y, yaw: yawTo(e.x, e.y, cx, cy) }
      // 사람은 문 옆 조금 안쪽에: 문이 열리는 길과 가구를 피해 빈 자리를 찾는다
      const latch = door.hinge === 'end' ? -1 : 1
      const tries: [number, number][] = [[latch * (door.width / 2 + 450), 950], [-latch * (door.width / 2 + 450), 950], [latch * (door.width / 2 + 450), 1500], [-latch * (door.width / 2 + 450), 1500], [0, 1700], [latch * (door.width / 2 + 900), 700], [-latch * (door.width / 2 + 900), 700]]
      // 눈높이로 들어섰을 때 시야 한가운데를 막지 않게: 문에서 방 가운데로 가는 길에서 비켜난 자리를 먼저 찾는다
      const sl = Math.hypot(cx - e.x, cy - e.y) || 1, aside = (p: Pt) => Math.abs((p.x - e.x) * (cy - e.y) - (p.y - e.y) * (cx - e.x)) / sl > 850
      const spots = tries.map(([da, dn]) => along(w, f, pos + da, s * (w.t / 2 + dn))).filter(p => free(p.x, p.y, 280))
      const spot = spots.find(aside) ?? spots[0] ?? along(w, f, pos + latch * (door.width / 2 + 450), s * (w.t / 2 + 950))
      person = { x: spot.x, y: spot.y, yaw: yawTo(spot.x, spot.y, cx, cy) + Math.PI }
    } else if (!empty) {
      // 문이 없으면 방의 가장 먼 구석에서 가운데를 본다
      const far = (outline ?? [{ x: b.min.x * 1000, y: b.max.z * 1000 }]).reduce((a, p) => (Math.hypot(p.x - cx, p.y - cy) > Math.hypot(a.x - cx, a.y - cy) ? p : a))
      const dist = Math.hypot(far.x - cx, far.y - cy) || 1, back = Math.min(900, dist * 0.5)
      const e = { x: far.x + ((cx - far.x) / dist) * back, y: far.y + ((cy - far.y) / dist) * back }
      eye = { x: e.x, y: e.y, yaw: yawTo(e.x, e.y, cx, cy) }
      const spot = ([[0, 0], [700, 0], [-700, 0], [0, 700], [0, -700], [1200, 800], [-1200, -800]] as [number, number][]).map(([dx, dy]) => ({ x: cx + dx, y: cy + dy })).find(p => free(p.x, p.y, 280)) ?? { x: cx, y: cy }
      person = { x: spot.x, y: spot.y, yaw: yawTo(spot.x, spot.y, e.x, e.y) + Math.PI }
    }
    const r = (v: number) => Math.round(v) / 1000
    return { empty, closed: !!outline, H: Hm, center: { x: r(cx), z: r(cy) }, eye: { x: r(eye.x), z: r(eye.y), yaw: Math.round(eye.yaw * 1000) / 1000 }, person: { x: r(person.x), z: r(person.y), yaw: Math.round(person.yaw * 1000) / 1000 }, solids }
  }

  /** 고른 것에 분홍 테두리. 가려진 부분은 옅게 비친다 */
  private syncOutline(selected: string | null): boolean {
    const e = selected ? this.items.get(selected) ?? this.walls.get(selected) ?? this.opens.get(selected) : undefined
    const sig = e && selected ? `${selected}|${e.key}|${e.pose}` : ''
    if (sig === (this.outline?.sig ?? '')) return false
    if (this.outline) { this.outlineG.clear(); this.outline.geo.dispose(); this.outline.mats.forEach(m => m.dispose()); this.outline = null }
    if (!e) return true
    this.root.updateWorldMatrix(true, false)
    e.obj.updateWorldMatrix(true, true)
    const inv = this.root.matrixWorld.clone().invert(), m = new THREE.Matrix4(), v = new THREE.Vector3(), seg: number[] = []
    e.obj.traverse(o => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || mesh.userData.noEdge) return
      const box = mesh.userData.edge as [number, number, number] | undefined
      const src = box ? new THREE.BoxGeometry(box[0], box[1], box[2]) : mesh.geometry
      const edges = new THREE.EdgesGeometry(src, 30), p = edges.getAttribute('position')
      m.multiplyMatrices(inv, mesh.matrixWorld)
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); seg.push(v.x, v.y, v.z) }
      edges.dispose()
      if (box) src.dispose()
    })
    if (!seg.length) { this.outline = { sig, geo: new LineSegmentsGeometry(), mats: [] }; return true }
    const geo = new LineSegmentsGeometry().setPositions(seg)
    const solid = new LineMaterial({ color: this.pink, linewidth: 2.4 }), ghost = new LineMaterial({ color: this.pink, linewidth: 1.4, transparent: true, opacity: 0.18, depthTest: false })
    solid.toneMapped = false; ghost.toneMapped = false
    const back = new LineSegments2(geo, ghost), front = new LineSegments2(geo, solid)
    back.renderOrder = 5; front.renderOrder = 6
    this.outlineG.add(back, front)
    this.outline = { sig, geo, mats: [solid, ghost] }
    return true
  }

  /** 3D 파일로 내보낼 묶음: 바닥 · 벽 · 문 · 창 · 가구만 (천장 · 사람 · 고른 표시는 뺀다). 모양 · 재질은 화면의 것을 그대로 가리킨다 */
  exportRoot(name: string): THREE.Group {
    const out = new THREE.Group()
    out.name = name
    for (const g of [this.floorG, this.wallG, this.openG, this.itemG]) out.add(g.clone(true))
    // 화면에서 낮춰 둔 벽도 파일에는 온전한 높이로
    const stubs: THREE.Object3D[] = []
    out.traverse(o => { if (o.userData.stub) stubs.push(o); else o.visible = true; o.userData = {} })
    for (const o of stubs) o.removeFromParent()
    return out
  }

  /** 보는 쪽(cam)을 가리는 바깥벽을 낮춘다 — 안이 들여다보이게. cam 이 null 이면 모두 원래대로. 달라졌으면 true */
  cutWalls(cam: THREE.Vector3 | null): boolean {
    const next = new Set<string>()
    if (cam) for (const [id, e] of this.walls) {
      const o = e.out
      if (!o) continue
      // 벽 바깥쪽에 서 있으면 그 벽이 안을 가린다 (경계에서 깜박이지 않게 여유를 둔다)
      if ((cam.x - o.x) * o.nx + (cam.z - o.z) * o.nz > (this.cuts.has(id) ? 0.05 : 0.3)) next.add(id)
    }
    let changed = next.size !== this.cuts.size
    if (!changed) for (const id of next) if (!this.cuts.has(id)) { changed = true; break }
    this.cuts = next
    for (const [id, e] of this.walls) { const cut = next.has(id); for (const m of e.kit.body.children) m.visible = m.userData.stub ? cut : !cut }
    for (const e of this.opens.values()) e.obj.visible = !(e.wallId && next.has(e.wallId))
    return changed
  }

  /** 눈높이 보기에서 누를 수 있는 것 (바닥 · 벽 · 문 · 창 · 가구) */
  get solidGroups(): THREE.Object3D[] { return [this.floorG, this.wallG, this.openG, this.itemG] }

  dispose() {
    for (const map of [this.walls, this.opens, this.items, this.floor, this.ceil]) { for (const e of map.values()) e.kit.free(); map.clear() }
    this.person?.free()
    this.person = null
    if (this.outline) { this.outline.geo.dispose(); this.outline.mats.forEach(m => m.dispose()); this.outline = null }
    for (const g of [this.floorG, this.wallG, this.openG, this.itemG, this.ceilG, this.personG, this.outlineG]) g.clear()
  }
}

