// 3D 보기의 가구 · 기구 모양 (2026-11-17 대표 지시 '평면과 3D 작업공간을 더욱 현실에 맞게')
// 부품 하나를 알아볼 수 있는 작은 덩어리 몇 개로 세운다. 크기는 평면에 적힌 가로 · 세로 · 높이 그대로(m).
// 자리: 가운데가 원점, 바닥이 y 0. 등받이 · 벽에 붙는 쪽이 -z (평면에서는 위쪽), 앞이 +z.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mix, type ItemShape } from './designPlanLook.ts'
import { hashText, seeded } from './designPlan3dTex.ts'

export interface MatOpts { rough?: number; metal?: number; opacity?: number; /** 스스로 빛나는 정도 (조명) */ glow?: number; flat?: boolean; both?: boolean; map?: THREE.Texture | null; name?: string }
type Mat = THREE.Material | THREE.Material[]

/** 덩어리를 만들고, 만든 것(모양 · 재질)을 기억했다가 한꺼번에 버린다 */
export class Kit {
  /** 크기를 재는 몸통 */
  readonly body = new THREE.Group()
  /** 크기 밖에 붙는 것 (펜던트 줄 · 수전) */
  readonly extra = new THREE.Group()
  private geos: THREE.BufferGeometry[] = []
  private mats = new Map<string, THREE.MeshStandardMaterial>()

  mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
    const key = [color, o.rough ?? 0.8, o.metal ?? 0, o.opacity ?? 1, o.glow ?? 0, o.flat ? 1 : 0, o.both ? 1 : 0, o.map?.uuid ?? ''].join('|')
    let m = this.mats.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, flatShading: !!o.flat, side: o.both ? THREE.DoubleSide : THREE.FrontSide, map: o.map ?? null })
      if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false }
      if (o.glow) { m.emissive = new THREE.Color(color); m.emissiveIntensity = o.glow }
      if (o.name) m.name = o.name
      this.mats.set(key, m)
    }
    return m
  }
  put(geo: THREE.BufferGeometry, m: Mat, x = 0, y = 0, z = 0, into: THREE.Object3D = this.body): THREE.Mesh {
    this.geos.push(geo)
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.set(x, y, z)
    mesh.castShadow = !(Array.isArray(m) ? m : [m]).some(q => q.transparent)
    mesh.receiveShadow = true
    into.add(mesh)
    return mesh
  }
  /** 상자: 가운데 x · z, 바닥 y0 에서 높이 h. round 는 모서리를 굴리는 반지름 */
  box(w: number, h: number, d: number, x: number, y0: number, z: number, m: Mat, round = 0, into?: THREE.Object3D): THREE.Mesh {
    w = Math.max(w, 1e-4); h = Math.max(h, 1e-4); d = Math.max(d, 1e-4)
    const soft = round > 0.002 && Math.min(w, h, d) > round * 2.4
    const mesh = this.put(soft ? new RoundedBoxGeometry(w, h, d, 3, round) : new THREE.BoxGeometry(w, h, d), m, x, y0 + h / 2, z, into)
    if (soft) mesh.userData.edge = [w, h, d]
    return mesh
  }
  /** 원기둥 · 원뿔대: 바닥 y0 에서 높이 h. sx · sz 로 타원으로 늘인다 */
  cyl(rTop: number, rBot: number, h: number, x: number, y0: number, z: number, m: Mat, o: { sx?: number; sz?: number; seg?: number; open?: boolean; into?: THREE.Object3D } = {}): THREE.Mesh {
    h = Math.max(h, 1e-4)
    const mesh = this.put(new THREE.CylinderGeometry(Math.max(rTop, 1e-4), Math.max(rBot, 1e-4), h, o.seg ?? 24, 1, !!o.open), m, x, y0 + h / 2, z, o.into)
    mesh.scale.set(o.sx ?? 1, 1, o.sz ?? 1)
    return mesh
  }
  ball(r: number, x: number, y: number, z: number, m: Mat, o: { sx?: number; sy?: number; sz?: number; detail?: number; into?: THREE.Object3D } = {}): THREE.Mesh {
    const mesh = this.put(o.detail != null ? new THREE.IcosahedronGeometry(Math.max(r, 1e-4), o.detail) : new THREE.SphereGeometry(Math.max(r, 1e-4), 20, 14), m, x, y, z, o.into)
    mesh.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1)
    return mesh
  }
  free() {
    for (const g of this.geos) g.dispose()
    for (const m of this.mats.values()) m.dispose()
    this.geos = []
    this.mats.clear()
  }
}

/** 부품의 바탕 색 · 질감 (마감이 적혀 있으면 그 재료, 없으면 모양별 기본 색) */
export interface Tone { c: string; rough: number; metal: number; opacity: number }
export interface BuildCtx { name: string; /** 바닥에서 띄운 것 (상부장 · 벽걸이) */ floating: boolean; /** 천장까지 남은 길이 m (펜던트 줄) */ drop: number }
type Size = [number, number, number]
type Builder = (k: Kit, w: number, d: number, h: number, t: Tone, x: BuildCtx) => Size | void

/** 위쪽 한계가 아래쪽보다 작아지는 아주 작은 부품에서는 위쪽 한계를 따른다 (상자 밖으로 나가지 않게) */
const cl = (v: number, lo: number, hi: number) => (hi < lo ? hi : Math.min(hi, Math.max(lo, v)))
/** 어둡게 — 검정이 아니라 짙은 갈회색 쪽으로 */
const shade = (c: string, t: number) => mix(c, '#4a4038', t)
const tint = (c: string, t: number) => mix(c, '#ffffff', t)
const STEEL = '#b4b8bc'
const main = (k: Kit, t: Tone, o: MatOpts = {}) => k.mat(t.c, { rough: t.rough, metal: t.metal, opacity: t.opacity, ...o })
const steel = (k: Kit) => k.mat(STEEL, { rough: 0.3, metal: 0.85 })

const box: Builder = (k, w, d, h, t) => { k.box(w, h, d, 0, 0, 0, main(k, t)) }

const table: Builder = (k, w, d, h, t) => {
  const tt = cl(h * 0.06, 0.018, Math.min(0.05, h * 0.5)), ls = cl(Math.min(w, d) * 0.07, 0.025, 0.07), ins = Math.min(0.04, Math.min(w, d) * 0.05)
  const leg = k.mat(shade(t.c, 0.22), { rough: 0.7, metal: t.metal })
  k.box(w, tt, d, 0, h - tt, 0, main(k, t))
  const lx = Math.max(0, w / 2 - ins - ls / 2), lz = Math.max(0, d / 2 - ins - ls / 2), lh = h - tt
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(ls, lh, ls, sx * lx, 0, sz * lz, leg)
  if (lh > 0.25) {
    const ah = Math.min(0.07, lh * 0.2)
    for (const s of [-1, 1]) { k.box(Math.max(0.01, 2 * lx - ls), ah, 0.02, 0, lh - ah, s * lz, leg); k.box(0.02, ah, Math.max(0.01, 2 * lz - ls), s * lx, lh - ah, 0, leg) }
  }
}

const round: Builder = (k, w, d, h, t) => {
  const tt = cl(h * 0.06, 0.018, Math.min(0.05, h * 0.5)), m = Math.min(w, d), leg = k.mat(shade(t.c, 0.22), { rough: 0.7, metal: t.metal })
  const pr = cl(m * 0.07, 0.025, 0.07), bh = Math.min(0.03, (h - tt) * 0.2)
  k.cyl(0.5, 0.5, tt, 0, h - tt, 0, main(k, t), { sx: w, sz: d, seg: 48 })
  k.cyl(pr, pr * 1.15, h - tt - bh, 0, bh, 0, leg, { seg: 20 })
  k.cyl(0.5, 0.5, bh, 0, 0, 0, leg, { sx: w * 0.55, sz: d * 0.55, seg: 32 })
}

const chair: Builder = (k, w, d, h, t, x) => {
  const seat = main(k, t), leg = k.mat(shade(t.c, 0.3), { rough: 0.6 }), ls = cl(Math.min(w, d) * 0.08, 0.02, 0.04)
  if (h <= 0.56 || /스툴|stool/i.test(x.name)) {
    // 스툴: 둥근 앉는 판과 다리 넷
    const st = cl(h * 0.1, 0.03, 0.06)
    k.cyl(0.5, 0.5, st, 0, h - st, 0, seat, { sx: w, sz: d, seg: 32 })
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(ls, h - st, ls, sx * w * 0.26, 0, sz * d * 0.26, leg)
    return
  }
  const sh = cl(h * 0.56, 0.2, 0.48), st = Math.min(0.05, sh * 0.3), bt = Math.min(0.035, d * 0.2)
  k.box(w, st, d, 0, sh - st, 0, seat, 0.012)
  const lx = w / 2 - ls / 2, lz = d / 2 - ls / 2
  for (const s of [-1, 1]) { k.box(ls, sh - st, ls, s * lx, 0, lz, leg); k.box(ls, h, ls, s * lx, 0, -lz, leg) }
  const bh = Math.max(0.05, (h - sh) * 0.55)
  k.box(Math.max(0.02, w - 2 * ls), bh, bt, 0, h - bh, -d / 2 + bt / 2, seat, 0.01)
}

const bench: Builder = (k, w, d, h, t) => {
  const st = cl(h * 0.12, 0.03, 0.08), lt = cl(w * 0.04, 0.03, 0.06), ins = Math.min(0.1, w * 0.08), leg = k.mat(shade(t.c, 0.25), { rough: 0.7 })
  k.box(w, st, d, 0, h - st, 0, main(k, t), 0.01)
  for (const s of [-1, 1]) k.box(lt, h - st, d * 0.86, s * (w / 2 - ins - lt / 2), 0, 0, leg)
  if (w > 0.9) k.box(w - 2 * ins - 2 * lt, Math.min(0.06, h * 0.15), 0.03, 0, (h - st) * 0.35, 0, leg)
}

const sofa: Builder = (k, w, d, h, t) => {
  const fab = k.mat(t.c, { rough: Math.max(t.rough, 0.9) }), cush = k.mat(tint(t.c, 0.14), { rough: 1 }), foot = k.mat('#5b5148', { rough: 0.6 })
  const fh = cl(h * 0.07, 0.02, 0.07)
  const aw = w < 1.1 ? cl(w * 0.14, 0.06, 0.16) : cl(w * 0.1, 0.12, 0.22)
  const bt = cl(d * 0.24, 0.1, 0.26), ah = cl(h * 0.72, fh + 0.1, Math.max(fh + 0.1, h - 0.08))
  const sh = cl(h * 0.52, fh + 0.08, 0.46), ct = cl(h * 0.17, 0.06, 0.15), r = Math.min(0.045, aw * 0.3)
  k.box(w, h - fh, bt, 0, fh, -d / 2 + bt / 2, fab, r)
  for (const s of [-1, 1]) k.box(aw, ah - fh, d, s * (w / 2 - aw / 2), fh, 0, fab, r)
  const iw = Math.max(0.05, w - 2 * aw), sd = Math.max(0.05, d - bt), zc = -d / 2 + bt + sd / 2
  k.box(iw, Math.max(0.01, sh - ct - fh), sd, 0, fh, zc, fab)
  const n = Math.max(1, Math.round(iw / 0.7)), cw = iw / n
  const bct = Math.min(0.16, sd * 0.25), bch = Math.max(0.08, h - sh - 0.04)
  for (let i = 0; i < n; i++) {
    const cx = -iw / 2 + cw * (i + 0.5)
    k.box(cw - 0.012, ct, sd - 0.01, cx, sh - ct, zc, cush, Math.min(0.04, ct * 0.35))
    k.box(cw - 0.02, bch, bct, cx, sh - 0.01, -d / 2 + bt + bct / 2 - 0.01, cush, Math.min(0.05, bct * 0.4))
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.02, 0.016, fh, sx * (w / 2 - Math.min(0.07, w * 0.2)), 0, sz * (d / 2 - Math.min(0.07, d * 0.2)), foot, { seg: 12 })
}

const bed: Builder = (k, w, d, h, t) => {
  const frame = k.mat(mix(t.c, '#a98a63', 0.55), { rough: 0.7 }), mat = k.mat(tint(t.c, 0.4), { rough: 1 }), pil = k.mat('#f7f5f0', { rough: 1 }), duv = k.mat(t.c, { rough: 1 })
  const head = h >= 0.7, ht = head ? cl(d * 0.04, 0.04, 0.1) : 0
  const mt = head ? cl(h * 0.55, 0.3, 0.6) : Math.max(h * 0.5, h - 0.09), bh = mt * 0.5, L = d - ht, zc = -d / 2 + ht + L / 2
  if (head) k.box(w, h, ht, 0, 0, -d / 2 + ht / 2, frame, 0.01)
  k.box(w, bh, L, 0, 0, zc, frame)
  k.box(w - 0.03, mt - bh, L - 0.03, 0, bh, zc, mat, Math.min(0.05, (mt - bh) * 0.3))
  const n = w >= 1.3 ? 2 : 1, pw = Math.min(0.62, w / n - 0.12), pd = Math.min(0.4, L * 0.22), ph = head ? 0.11 : h - mt + 0.02
  for (let i = 0; i < n; i++) k.box(pw, ph, pd, (i - (n - 1) / 2) * (w / n), mt - 0.02, -d / 2 + ht + 0.06 + pd / 2, pil, Math.min(0.04, ph * 0.35))
  const dl = L * 0.6, dh = Math.max(0.02, Math.min(0.12, mt - bh))
  k.box(w - 0.012, dh, dl, 0, mt + 0.02 - dh, d / 2 - dl / 2 - 0.006, duv, Math.min(0.03, dh * 0.3))
}

const shelf: Builder = (k, w, d, h, t, x) => {
  const pt = cl(w * 0.02, 0.015, 0.03), panel = main(k, t), back = k.mat(shade(t.c, 0.12), { rough: 0.9 })
  for (const s of [-1, 1]) k.box(pt, h, d, s * (w / 2 - pt / 2), 0, 0, panel)
  const toe = x.floating ? 0 : Math.min(0.06, h * 0.08), iw = Math.max(0.01, w - 2 * pt)
  const n = Math.max(2, Math.round((h - toe) / 0.38) + 1)
  for (let i = 0; i < n; i++) k.box(iw, pt, Math.max(0.01, d - 0.01), 0, toe + ((h - toe - pt) * i) / (n - 1), 0.005, panel)
  if (d >= 0.12) k.box(iw, h - toe, 0.006, 0, toe, -d / 2 + 0.003, back)
  if (toe > 0) k.box(iw, toe, 0.012, 0, 0, d / 2 - 0.03, back)
}

const counter: Builder = (k, w, d, h, t) => {
  const top = k.mat(mix(t.c, '#8f8779', 0.28), { rough: 0.45, metal: t.metal }), plinth = k.mat(shade(t.c, 0.35), { rough: 0.9 })
  const tt = Math.min(0.04, h * 0.2), toe = Math.min(0.08, h * 0.12), ov = Math.min(0.03, d * 0.1, w * 0.1)
  k.box(w, tt, d, 0, h - tt, 0, top)
  k.box(w - 2 * ov, h - tt - toe, d - 2 * ov, 0, toe, 0, main(k, t))
  k.box(Math.max(0.01, w - 2 * ov - 0.06), toe, Math.max(0.01, d - 2 * ov - 0.06), 0, 0, 0, plinth)
  const n = Math.max(1, Math.round(w / 0.9))
  for (let i = 1; i < n; i++) k.box(0.004, h - tt - toe - 0.02, 0.004, -w / 2 + ov + ((w - 2 * ov) * i) / n, toe + 0.01, d / 2 - ov, plinth)
}

/** 장 앞면: 문짝(또는 서랍)과 손잡이. zf = 몸통 앞면, ft = 앞으로 나오는 두께(문 + 손잡이) */
function fronts(k: Kit, w: number, y0: number, bh: number, zf: number, ft: number, door: Mat, pull: Mat, o: { drawers?: boolean; pullY?: number } = {}) {
  const dtk = ft * 0.6, hdl = ft * 0.4, gap = Math.min(0.004, w * 0.02)
  if (o.drawers) {
    const rows = Math.max(2, Math.round(bh / 0.22)), rh = bh / rows
    for (let i = 0; i < rows; i++) {
      k.box(w - gap, rh - gap, dtk, 0, y0 + rh * i + gap / 2, zf + dtk / 2, door)
      k.box(Math.min(0.14, w * 0.3), 0.012, hdl, 0, y0 + rh * (i + 0.5) - 0.006, zf + dtk + hdl / 2, pull)
    }
    return
  }
  const n = Math.max(1, Math.round(w / 0.5)), dw = w / n, pl = Math.min(0.1, bh * 0.3)
  const py = o.pullY != null ? cl(o.pullY, y0 + 0.02, y0 + bh - pl - 0.02) : y0 + bh / 2 - pl / 2
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + dw * (i + 0.5)
    k.box(dw - gap, bh - gap, dtk, cx, y0 + gap / 2, zf + dtk / 2, door)
    // 마주 보는 문끼리 손잡이가 가운데로 모이게
    const hx = cx + (n === 1 ? 1 : i % 2 === 0 ? 1 : -1) * (dw / 2 - Math.min(0.04, dw * 0.2))
    k.box(0.012, pl, hdl, hx, py, zf + dtk + hdl / 2, pull)
  }
}

const cabinet: Builder = (k, w, d, h, t, x) => {
  const carc = k.mat(shade(t.c, 0.3), { rough: 0.9 })
  const toe = x.floating ? 0 : Math.min(0.08, h * 0.1), ft = Math.min(0.03, d * 0.3), bh = h - toe
  k.box(w, bh, d - ft, 0, toe, -ft / 2, carc)
  if (toe > 0) k.box(Math.max(0.01, w - 0.04), toe, Math.max(0.01, d - ft - 0.05), 0, 0, -ft / 2 - 0.01, carc)
  // 손잡이 자리: 키 큰 장은 손 높이, 낮은 장은 위쪽, 띄운 장(상부장)은 아래쪽
  const pullY = x.floating ? 0.04 : h > 1.4 ? 0.95 : h - 0.16
  fronts(k, w, toe, bh, d / 2 - ft, ft, main(k, t), steel(k), { drawers: /서랍|drawer/i.test(x.name), pullY })
}

const plant: Builder = (k, w, d, h, t, x) => {
  const m = Math.min(w, d), ph = cl(h * 0.28, Math.min(0.1, h * 0.5), 0.5), pr = Math.min(m * 0.32, 0.3)
  const rnd = seeded(hashText(`${x.name}|${w}|${d}|${h}`))
  k.cyl(pr, pr * 0.72, ph, 0, 0, 0, k.mat('#d8cfc0', { rough: 0.85 }), { seg: 24 })
  k.cyl(pr * 0.9, pr * 0.9, 0.004, 0, ph, 0, k.mat('#6b5a48', { rough: 1 }), { seg: 24 })
  const fh = h - ph
  if (fh > 0.25) k.cyl(Math.max(0.008, pr * 0.1), Math.max(0.012, pr * 0.14), fh * 0.5, 0, ph, 0, k.mat('#7c644a', { rough: 0.9 }), { seg: 8 })
  const leaf = [k.mat(t.c, { rough: 1, flat: true }), k.mat(mix(t.c, '#3f5f3a', 0.35), { rough: 1, flat: true }), k.mat(mix(t.c, '#b7d08f', 0.3), { rough: 1, flat: true })]
  // 네 옆면과 꼭대기에 닿는 덩어리를 먼저 두어 적힌 크기를 채운다
  const r0 = Math.max(0.01, Math.min(w, d, fh) * 0.3), y0 = ph + Math.max(r0, fh * 0.45)
  const blobs: [number, number, number, number][] = [[w / 2 - r0, y0, 0, r0], [-(w / 2 - r0), y0 + r0 * 0.3, 0, r0], [0, y0 - r0 * 0.1, d / 2 - r0, r0], [0, y0 + r0 * 0.2, -(d / 2 - r0), r0], [0, h - r0 * 1.15, 0, r0 * 1.15]]
  for (let i = 0; i < 4; i++) blobs.push([(rnd() - 0.5) * Math.max(0, w - 2.2 * r0), ph + r0 + rnd() * Math.max(0, fh - 2.2 * r0), (rnd() - 0.5) * Math.max(0, d - 2.2 * r0), r0 * (0.8 + rnd() * 0.3)])
  blobs.forEach(([bx, by, bz, r], i) => { k.ball(r, bx, by, bz, leaf[i % 3], { detail: 1 }).userData.noEdge = true })
}

const rug: Builder = (k, w, d, h, t) => {
  // 러그는 얇다: 높이가 크게 적혀 있어도 4cm 까지만
  const th = cl(h, 0.004, 0.04), b = Math.min(0.08, Math.min(w, d) * 0.08)
  k.box(w, th * 0.7, d, 0, 0, 0, k.mat(shade(t.c, 0.14), { rough: 1 }))
  k.box(w - 2 * b, th, d - 2 * b, 0, 0, 0, k.mat(t.c, { rough: 1 }))
  return [w, th, d]
}

const lamp: Builder = (k, w, d, h, t) => {
  const metal = k.mat('#8d8478', { rough: 0.4, metal: 0.6 }), sh = cl(h * 0.2, Math.min(0.08, h * 0.5), 0.36), bh = Math.min(0.03, h * 0.05)
  k.cyl(0.5, 0.5, bh, 0, 0, 0, metal, { sx: w * 0.6, sz: d * 0.6, seg: 32 })
  k.cyl(0.012, 0.012, Math.max(0.01, h - sh - bh), 0, bh, 0, metal, { seg: 10 })
  k.cyl(0.36, 0.5, sh, 0, h - sh, 0, k.mat(t.c, { rough: 0.9, glow: 0.55 }), { sx: w, sz: d, seg: 32 })
}

const pendant: Builder = (k, w, d, h, t, x) => {
  const cord = k.mat('#6b655d', { rough: 0.8 }), r = Math.min(w, d, h) * 0.16
  k.cyl(0.14, 0.5, h, 0, 0, 0, k.mat(t.c, { rough: 0.7, glow: 0.3, both: true }), { sx: w, sz: d, seg: 36, open: true })
  k.cyl(0.14, 0.14, 0.004, 0, h - 0.004, 0, k.mat(t.c, { rough: 0.7 }), { sx: w, sz: d, seg: 24 })
  k.ball(r, 0, h * 0.45, 0, k.mat('#fff3cf', { glow: 1.6 }))
  if (x.drop > 0.005) {
    k.cyl(0.005, 0.005, x.drop, 0, h, 0, cord, { seg: 6, into: k.extra })
    k.cyl(0.05, 0.05, Math.min(0.02, x.drop), 0, h + x.drop - Math.min(0.02, x.drop), 0, cord, { seg: 16, into: k.extra })
  }
}

const downlight: Builder = (k, w, d, h, t) => {
  // 천장에 붙는 얇은 등: 테두리와 볼록한 렌즈
  const th = cl(h, 0.006, 0.05)
  k.cyl(0.5, 0.5, th * 0.6, 0, th * 0.4, 0, k.mat('#f4f2ec', { rough: 0.6 }), { sx: w, sz: d, seg: 32 })
  k.cyl(0.38, 0.34, th * 0.6, 0, 0, 0, k.mat(t.c, { rough: 0.4, glow: 1.4 }), { sx: w, sz: d, seg: 32 })
  return [w, th, d]
}

const screen: Builder = (k, w, d, h, t) => {
  const frame = k.mat(shade(t.c, 0.2), { rough: 0.8, metal: t.metal }), face = main(k, t), wide = w >= d
  const tk = wide ? d : w, f = Math.min(0.004, tk * 0.2), b = Math.min(0.03, Math.min(wide ? w : d, h) * 0.06)
  if (wide) { k.box(w, h, d - 2 * f, 0, 0, 0, frame); for (const s of [-1, 1]) k.box(w - 2 * b, h - 2 * b, f, 0, b, s * (d / 2 - f / 2), face) }
  else { k.box(w - 2 * f, h, d, 0, 0, 0, frame); for (const s of [-1, 1]) k.box(f, h - 2 * b, d - 2 * b, s * (w / 2 - f / 2), b, 0, face) }
}

const tv: Builder = (k, w, d, h, t) => {
  // 화면은 짙은 청회색 유리 (검정 아님)
  const glass = k.mat(mix(t.c, '#27303a', 0.55), { rough: 0.12, metal: 0.2 }), body = k.mat(t.c, { rough: 0.5, metal: t.metal }), wide = w >= d
  const tk = wide ? d : w, f = Math.min(0.004, tk * 0.2), b = Math.min(0.015, Math.min(wide ? w : d, h) * 0.04)
  if (wide) { k.box(w, h, d - f, 0, 0, -f / 2, body); k.box(w - 2 * b, h - 2 * b, f, 0, b, d / 2 - f / 2, glass) }
  else { k.box(w - f, h, d, -f / 2, 0, 0, body); k.box(f, h - 2 * b, d - 2 * b, w / 2 - f / 2, b, 0, glass) }
}

const platform: Builder = (k, w, d, h, t) => {
  const tt = Math.min(0.018, h * 0.3)
  k.box(w, h - tt, d, 0, 0, 0, k.mat(shade(t.c, 0.14), { rough: 0.85 }))
  k.box(w, tt, d, 0, h - tt, 0, main(k, t))
}

const toilet: Builder = (k, w, d, h, t) => {
  const cer = k.mat(t.c, { rough: 0.25 }), lid = k.mat(shade(t.c, 0.07), { rough: 0.35 })
  const td = d * 0.27, sh = cl(h * 0.54, 0.15, 0.43), bd = d - td * 0.75, zc = d / 2 - bd / 2
  k.box(w, h - sh * 0.9, td, 0, sh * 0.9, -d / 2 + td / 2, cer, Math.min(0.03, td * 0.2))
  k.box(w * 0.7, sh * 0.9, td, 0, 0, -d / 2 + td / 2, cer)
  k.cyl(0.5, 0.32, Math.max(0.01, sh - 0.03), 0, 0, zc, cer, { sx: w * 0.92, sz: bd, seg: 32 })
  k.cyl(0.5, 0.5, Math.min(0.03, sh * 0.5), 0, sh - Math.min(0.03, sh * 0.5), zc, lid, { sx: w * 0.94, sz: bd, seg: 32 })
}

/** 안이 파인 그릇 (세면대): 바깥을 올라갔다가 안쪽으로 내려오는 옆모습을 돌려 만든다 */
function bowl(k: Kit, w: number, d: number, bh: number, y0: number, m: Mat) {
  const pts = [[0.001, 0], [0.34, 0], [0.5, 0.86], [0.5, 1], [0.465, 1], [0.43, 0.9], [0.3, 0.32], [0.001, 0.26]].map(([r, y]) => new THREE.Vector2(r, y * bh))
  const mesh = k.put(new THREE.LatheGeometry(pts, 32), m, 0, y0, 0)
  mesh.scale.set(w, 1, d)
  return mesh
}

const basin: Builder = (k, w, d, h, t, x) => {
  // 벽에 건 세면대는 그릇이 전부, 바닥에 선 것은 위쪽이 그릇이고 아래는 받침
  const cer = k.mat(t.c, { rough: 0.25 }), bh = x.floating ? h : cl(h * 0.2, Math.min(0.08, h), 0.18)
  bowl(k, w, d, bh, h - bh, cer)
  if (!x.floating && h - bh > 0.05) k.cyl(0.1, 0.13, h - bh, 0, 0, -d * 0.1, cer, { sx: Math.min(1, w / 0.45), sz: Math.min(1, d / 0.45), seg: 20 })
  // 수전은 적힌 높이 위로 올라온다
  const zt = -d / 2 + Math.min(0.05, d * 0.15)
  k.cyl(0.012, 0.014, 0.12, 0, h, zt, steel(k), { seg: 10, into: k.extra })
  k.box(0.02, 0.015, Math.min(0.1, d * 0.3), 0, h + 0.1, zt + Math.min(0.05, d * 0.15), steel(k), 0, k.extra)
}

const bathtub: Builder = (k, w, d, h, t) => {
  const cer = k.mat(t.c, { rough: 0.22 }), wt = cl(Math.min(w, d) * 0.09, 0.02, 0.08), bot = Math.min(h * 0.28, 0.16)
  for (const s of [-1, 1]) { k.box(w, h, wt, 0, 0, s * (d / 2 - wt / 2), cer); k.box(wt, h, Math.max(0.01, d - 2 * wt), s * (w / 2 - wt / 2), 0, 0, cer) }
  k.box(Math.max(0.01, w - 2 * wt), bot, Math.max(0.01, d - 2 * wt), 0, 0, 0, cer)
  const end = w >= d ? [-(w / 2 - wt / 2), 0] : [0, -(d / 2 - wt / 2)]
  k.cyl(0.014, 0.016, 0.14, end[0], h, end[1], steel(k), { seg: 10, into: k.extra })
}

const sink: Builder = (k, w, d, h, t, x) => {
  const carc = k.mat(shade(t.c, 0.3), { rough: 0.9 }), top = k.mat(mix(t.c, '#8f8779', 0.2), { rough: 0.4 }), st = k.mat('#c5c9cc', { rough: 0.3, metal: 0.85 })
  const tt = Math.min(0.03, h * 0.2), toe = x.floating ? 0 : Math.min(0.08, h * 0.1), ft = Math.min(0.03, d * 0.2), bh = h - tt - toe
  k.box(w, bh, d - ft, 0, toe, -ft / 2, carc)
  if (toe > 0) k.box(Math.max(0.01, w - 0.04), toe, Math.max(0.01, d - ft - 0.05), 0, 0, -ft / 2 - 0.01, carc)
  fronts(k, w, toe, bh, d / 2 - ft, ft, main(k, t), steel(k), { pullY: toe + bh - 0.14 })
  // 상판은 개수대 자리를 비우고 네 조각으로, 그 아래에 스테인리스 바닥
  const bw = Math.min(w * 0.55, 0.75), bd = d * 0.6, bx = w > 1.2 ? -w / 2 + 0.15 + bw / 2 : 0, bz = d * 0.03
  const x0 = bx - bw / 2, x1 = bx + bw / 2, z0 = bz - bd / 2, z1 = bz + bd / 2, y = h - tt
  k.box(x0 + w / 2, tt, d, (x0 - w / 2) / 2, y, 0, top)
  k.box(w / 2 - x1, tt, d, (x1 + w / 2) / 2, y, 0, top)
  k.box(bw, tt, z0 + d / 2, bx, y, (z0 - d / 2) / 2, top)
  k.box(bw, tt, d / 2 - z1, bx, y, (z1 + d / 2) / 2, top)
  k.box(bw, tt * 0.3, bd, bx, y, bz, st)
  k.cyl(0.03, 0.03, 0.003, bx, y + tt * 0.3, bz, carc, { seg: 16 })
  k.cyl(0.013, 0.015, 0.2, bx, h, z0 - Math.min(0.04, (z0 + d / 2) * 0.5), st, { seg: 10, into: k.extra })
  k.box(0.02, 0.016, Math.min(0.16, bd * 0.5), bx, h + 0.19, z0 + Math.min(0.05, bd * 0.2), st, 0, k.extra)
}

const appliance: Builder = (k, w, d, h, t, x) => {
  const body = k.mat(t.c, { rough: 0.45, metal: Math.max(t.metal, 0.15) }), dark = k.mat(shade(t.c, 0.45), { rough: 0.3 }), pull = steel(k)
  const ft = Math.min(0.03, d * 0.2), dtk = ft * 0.6, hdl = ft * 0.4, zf = d / 2 - ft, g = 0.004
  k.box(w, h, d - ft, 0, 0, -ft / 2, body)
  if (/세탁|건조|washer|dryer/i.test(x.name)) {
    // 세탁기 · 건조기: 둥근 문과 조작부
    k.box(w - g, h - g, dtk, 0, g / 2, zf + dtk / 2, body)
    const r = Math.min(w, h) * 0.3
    const ring = k.cyl(r, r, hdl * 0.9, 0, h * 0.45 - hdl * 0.45, zf + dtk + hdl * 0.45, pull, { seg: 36 })
    ring.rotation.x = Math.PI / 2
    const glass = k.cyl(r * 0.72, r * 0.72, hdl, 0, h * 0.45 - hdl / 2, zf + dtk + hdl / 2, dark, { seg: 36 })
    glass.rotation.x = Math.PI / 2
    k.box(w * 0.8, Math.min(0.05, h * 0.08), hdl * 0.5, 0, h - Math.min(0.1, h * 0.14), zf + dtk + hdl * 0.25, dark)
  } else if (/냉장|refrigerator|쇼케이스/i.test(x.name) || h >= 1.5) {
    // 냉장고: 넓으면 양문, 좁으면 위아래 두 칸
    if (w >= 0.75) for (const s of [-1, 1]) { k.box(w / 2 - g, h - g, dtk, (s * w) / 4, g / 2, zf + dtk / 2, body); k.box(0.016, h * 0.4, hdl, s * 0.035, h * 0.35, zf + dtk + hdl / 2, pull) }
    else { const cut = h * 0.62; k.box(w - g, cut - g, dtk, 0, g / 2, zf + dtk / 2, body); k.box(w - g, h - cut - g, dtk, 0, cut + g / 2, zf + dtk / 2, body); for (const [y0, len] of [[cut - h * 0.26, h * 0.22], [cut + 0.04, Math.min(h * 0.2, h - cut - 0.08)]]) k.box(0.016, len, hdl, -w / 2 + 0.05, y0, zf + dtk + hdl / 2, pull) }
  } else {
    k.box(w - g, h - g, dtk, 0, g / 2, zf + dtk / 2, body)
    k.box(w * 0.7, 0.014, hdl, 0, h - Math.min(0.12, h * 0.2), zf + dtk + hdl / 2, pull)
    k.box(w * 0.5, Math.min(0.03, h * 0.05), hdl * 0.4, 0, h - Math.min(0.06, h * 0.1), zf + dtk + hdl * 0.2, dark)
  }
}

const BUILDERS: Record<ItemShape, Builder> = { box, table, round, chair, bench, sofa, bed, shelf, counter, cabinet, plant, rug, light: lamp, pendant, downlight, screen, tv, platform, toilet, basin, bathtub, sink, appliance }

/** 몸통이 적힌 크기를 정확히 채우게 맞춘다 (모양을 만든 뒤의 마지막 안전장치) */
function fitBody(body: THREE.Object3D, [w, h, d]: Size) {
  body.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(body, true)
  if (b.isEmpty()) return
  const s = b.getSize(new THREE.Vector3()), e = 5e-4
  if (Math.abs(s.x - w) < e && Math.abs(s.y - h) < e && Math.abs(s.z - d) < e && Math.abs(b.min.x + w / 2) < e && Math.abs(b.min.y) < e && Math.abs(b.min.z + d / 2) < e) return
  const sx = s.x > 1e-6 ? w / s.x : 1, sy = s.y > 1e-6 ? h / s.y : 1, sz = s.z > 1e-6 ? d / s.z : 1
  body.scale.set(sx, sy, sz)
  body.position.set(-w / 2 - b.min.x * sx, -b.min.y * sy, -d / 2 - b.min.z * sz)
  body.updateMatrixWorld(true)
}

/** 부품 하나를 세운다. size 는 실제로 차지하는 [가로, 높이, 세로] (러그 · 매입등은 높이가 얇게 잡힌다) */
export function buildItem(shape: ItemShape, w: number, d: number, h: number, tone: Tone, ctx: BuildCtx): { kit: Kit; size: Size } {
  const k = new Kit()
  w = Math.max(w, 0.005); d = Math.max(d, 0.005); h = Math.max(h, 0.003)
  const size = (BUILDERS[shape] ?? box)(k, w, d, h, tone, ctx) ?? [w, h, d]
  fitBody(k.body, size)
  return { kit: k, size }
}

/** 크기 가늠용 사람 (키 1.7m). 얼굴 없는 단순한 모양 */
export function buildPerson(): Kit {
  const k = new Kit(), m = k.mat('#a59f95', { rough: 1 })
  for (const s of [-1, 1]) k.cyl(0.062, 0.05, 0.84, s * 0.085, 0, 0, m, { seg: 12 })
  const torso = k.put(new THREE.CapsuleGeometry(0.15, 0.36, 6, 16), m, 0, 1.14, 0)
  torso.scale.set(1.2, 1, 0.72)
  for (const s of [-1, 1]) { const arm = k.put(new THREE.CapsuleGeometry(0.042, 0.5, 4, 10), m, s * 0.225, 1.1, 0); arm.rotation.z = s * 0.07 }
  k.cyl(0.045, 0.05, 0.1, 0, 1.42, 0, m, { seg: 12 })
  k.ball(0.1, 0, 1.585, 0, m, { sy: 1.15 })
  k.body.traverse(o => { o.userData.noEdge = true })
  return k
}
