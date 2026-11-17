// 스케치업 활용 (2026-11-17 대표 지시 '캐드와 스케치업을 활용 가능하게')
// 평면을 스케치업에서 그대로 세우는 루비 스크립트를 만든다 — 스케치업 › 확장 프로그램 › 개발자 › Ruby 콘솔에서 load '파일 경로'.
// 벽(문 · 창 자리 비움) · 바닥 · 집기를 태그별 그룹으로 만들고, 마감 색을 재질로 넣는다. 정밀 모델 · 렌더는 그 위에서 이어 간다.
import { floorOutline, type PlanGeometry } from './designPlan.ts'
import { pieceCorners, wallPieces } from './designPlanDraw.ts'
import { finishLook, itemShape, SHAPE_COLOR, type FinishLook } from './designPlanLook.ts'

const rb = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' ')}'`
const rgb = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(', ')
const n = (v: number) => (Math.round(v * 10) / 10).toString()
const ok = (...v: number[]) => v.every(Number.isFinite)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** 부품의 바닥 · 윗면 높이 mm (3D 화면과 같은 규칙): 적힌 띄운 높이(z) — 벽걸이 TV 는 없으면 900,
 *  매입등은 천장에 붙이고, 펜던트는 띄운 높이가 있으면 그 높이 · 없으면 머리 위까지 천장에서 내려온다 */
export function itemLift(it: { z?: number; h: number }, shape: string, H: number): [number, number] {
  const h = Math.max(Number.isFinite(it.h) ? it.h : 0, 20), z = it.z != null && it.z > 0 ? it.z : 0
  let z0 = z
  if (shape === 'downlight') z0 = H - h
  else if (shape === 'pendant') z0 = z > 0 ? Math.min(z, H - h) : H - h - clamp(H - 2000 - h, 150, 900)
  else if (shape === 'tv') z0 = Math.max(0, it.z ?? 900)
  z0 = Math.max(0, z0)
  return [z0, z0 + h]
}

export function planToSketchupRuby(g: PlanGeometry, name: string, look: (finish?: string | null, fallback?: FinishLook['kind']) => FinishLook = finishLook): string {
  const L: string[] = []
  // 스케치업은 y 가 위쪽(북)이라 화면 y 를 뒤집는다
  const pts = (p: { x: number; y: number }[]) => `[${p.map(q => `[${n(q.x)}, ${n(-q.y)}]`).join(', ')}]`
  L.push('# encoding: UTF-8', `# 더위클리 인트라넷 평면 → 스케치업 (자동으로 만든 파일 · ${new Date().toISOString().slice(0, 10)})`, '# 쓰는 법: 스케치업 › 확장 프로그램 › 개발자 › Ruby 콘솔 › load \'이 파일의 경로\'', '# 단위 mm · 모델 원점 기준 · 한 번에 되돌리기(Ctrl+Z) 가능', '')
  L.push('model = Sketchup.active_model', "model.start_operation('WKLY 평면 가져오기', true)", 'begin', `  root = model.active_entities.add_group`, `  root.name = ${rb(`WKLY 평면 · ${name}`)}`, '  ents = root.entities')
  L.push("  tags = {}", "  %w[WKLY-벽 WKLY-가벽 WKLY-바닥 WKLY-집기].each { |t| tags[t] = model.layers[t] || model.layers.add(t) }")
  L.push('  mats = {}', '  mat = lambda do |key, r, g, b|', '    mats[key] ||= begin', "      m = model.materials[key] || model.materials.add(key)", '      m.color = Sketchup::Color.new(r, g, b)', '      m', '    end', '  end')
  // 한 조각이 잘못되어도(겹친 점 등) 그 조각만 건너뛰고 나머지는 만든다
  L.push('  made = 0', '  skipped = 0', '  box = lambda do |points, z0, z1, label, tag, material|', '    grp = nil', '    begin', '      grp = ents.add_group', '      grp.name = label', '      face = grp.entities.add_face(points.map { |x, y| Geom::Point3d.new(x.mm, y.mm, z0.mm) })', '      if face', '        face.reverse! if face.normal.z < 0', '        face.pushpull((z1 - z0).mm)', '      end', '      grp.layer = tags[tag]', '      grp.material = material if material', '      made += 1', '      grp', '    rescue StandardError', '      grp.erase! if grp && grp.valid?', '      skipped += 1', '      nil', '    end', '  end', '')
  // 천장 높이가 비어 있으면(0) 2,700 으로 — 벽이 하나도 안 생기는 일을 막는다
  const H = g.height > 0 ? g.height : 2700
  const floor = floorOutline(g.walls.filter(w => w.kind === 'existing'))
  if (floor) {
    const fl = look(g.rooms?.[0]?.floor.mat, 'wood')
    L.push(`  fg = ents.add_group`, `  fg.name = '바닥'`, `  ff = fg.entities.add_face(${pts(floor)}.map { |x, y| Geom::Point3d.new(x.mm, y.mm, 0) })`, '  ff.reverse! if ff && ff.normal.z < 0', "  fg.layer = tags['WKLY-바닥']", `  fg.material = mat.call(${rb(`WKLY 바닥 ${g.rooms?.[0]?.floor.mat?.trim() || '기본'}`)}, ${rgb(fl.color)})`, '')
  }
  g.walls.forEach((w, i) => {
    const lk = look(w.finish, 'paint')
    const tag = w.kind === 'new' ? 'WKLY-가벽' : 'WKLY-벽'
    const label = `${w.kind === 'new' ? '가벽' : '벽'} ${i + 1}${w.type ? ` ${w.type}` : ''}`
    if (!ok(w.x1, w.y1, w.x2, w.y2) || Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 1) { L.push(`  # ${label.replace(/[\r\n]+/g, ' ')}: 길이가 없어 건너뜀`); return }
    // 두께가 비어 있으면(0) 3D 화면처럼 10mm 로 세운다
    const wt = { ...w, t: Number.isFinite(w.t) && w.t >= 10 ? w.t : 10 }
    for (const p of wallPieces(wt, g.openings, H)) if (p.to - p.from >= 1 && p.z1 - p.z0 >= 1) L.push(`  box.call(${pts(pieceCorners(wt, p.from, p.to, 10))}, ${n(p.z0)}, ${n(p.z1)}, ${rb(label)}, ${rb(tag)}, mat.call(${rb(`WKLY 벽 ${w.finish?.trim() || '기본'}`)}, ${rgb(lk.color)}))`)
  })
  if (g.items.length) L.push('')
  for (const it of g.items) {
    const label = it.name.trim() || '집기'
    if (!ok(it.x, it.y, it.w, it.d, it.h)) { L.push(`  # ${label.replace(/[\r\n]+/g, ' ')}: 크기가 비어 있어 건너뜀`); continue }
    // 가로 · 세로 0 은 3D 화면처럼 5mm, 높이는 20mm 부터
    const iw = Math.max(it.w, 5), id = Math.max(it.d, 5), w = it.rot === 90 ? id : iw, d = it.rot === 90 ? iw : id
    const shape = itemShape(it.name, it.shape)
    const [z0, z1] = itemLift(it, shape, H)
    L.push(`  box.call(${pts([{ x: it.x, y: it.y }, { x: it.x + w, y: it.y }, { x: it.x + w, y: it.y + d }, { x: it.x, y: it.y + d }])}, ${n(z0)}, ${n(z1)}, ${rb(label)}, 'WKLY-집기', mat.call(${rb(`WKLY 집기 ${shape}`)}, ${rgb(SHAPE_COLOR[shape])}))`)
  }
  L.push('  model.commit_operation', '  model.active_view.zoom_extents', `  note = ${rb('WKLY 평면을 가져왔습니다: 만든 것 ')} + made.to_s + '개'`, `  note += ${rb(' · 만들지 못해 건너뛴 것 ')} + skipped.to_s + '개' if skipped > 0`, '  puts note', "  UI.messagebox(note) if skipped > 0", 'rescue => e', '  model.abort_operation', "  UI.messagebox('WKLY 평면을 가져오지 못했습니다: ' + e.message)", 'end', '')
  return L.join('\n')
}
