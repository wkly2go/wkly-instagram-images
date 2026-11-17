// 스케치업 활용 (2026-11-17 대표 지시 '캐드와 스케치업을 활용 가능하게')
// 평면을 스케치업에서 그대로 세우는 루비 스크립트를 만든다 — 스케치업 › 확장 프로그램 › 개발자 › Ruby 콘솔에서 load '파일 경로'.
// 벽(문 · 창 자리 비움) · 바닥 · 집기를 태그별 그룹으로 만들고, 마감 색을 재질로 넣는다. 정밀 모델 · 렌더는 그 위에서 이어 간다.
import { floorOutline, type PlanGeometry } from './designPlan.ts'
import { pieceCorners, wallPieces } from './designPlanDraw.ts'
import { finishLook, itemShape, SHAPE_COLOR, type FinishLook } from './designPlanLook.ts'

const rb = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]+/g, ' ')}'`
const rgb = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(', ')
const n = (v: number) => (Math.round(v * 10) / 10).toString()

export function planToSketchupRuby(g: PlanGeometry, name: string, look: (finish?: string | null, fallback?: FinishLook['kind']) => FinishLook = finishLook): string {
  const L: string[] = []
  // 스케치업은 y 가 위쪽(북)이라 화면 y 를 뒤집는다
  const pts = (p: { x: number; y: number }[]) => `[${p.map(q => `[${n(q.x)}, ${n(-q.y)}]`).join(', ')}]`
  L.push('# encoding: UTF-8', `# 더위클리 인트라넷 평면 → 스케치업 (자동으로 만든 파일 · ${new Date().toISOString().slice(0, 10)})`, '# 쓰는 법: 스케치업 › 확장 프로그램 › 개발자 › Ruby 콘솔 › load \'이 파일의 경로\'', '# 단위 mm · 모델 원점 기준 · 한 번에 되돌리기(Ctrl+Z) 가능', '')
  L.push('model = Sketchup.active_model', "model.start_operation('WKLY 평면 가져오기', true)", 'begin', `  root = model.active_entities.add_group`, `  root.name = ${rb(`WKLY 평면 · ${name}`)}`, '  ents = root.entities')
  L.push("  tags = {}", "  %w[WKLY-벽 WKLY-가벽 WKLY-바닥 WKLY-집기].each { |t| tags[t] = model.layers[t] || model.layers.add(t) }")
  L.push('  mats = {}', '  mat = lambda do |key, r, g, b|', '    mats[key] ||= begin', "      m = model.materials[key] || model.materials.add(key)", '      m.color = Sketchup::Color.new(r, g, b)', '      m', '    end', '  end')
  L.push('  box = lambda do |points, z0, z1, label, tag, material|', '    grp = ents.add_group', '    grp.name = label', '    face = grp.entities.add_face(points.map { |x, y| Geom::Point3d.new(x.mm, y.mm, z0.mm) })', '    if face', '      face.reverse! if face.normal.z < 0', '      face.pushpull((z1 - z0).mm)', '    end', '    grp.layer = tags[tag]', '    grp.material = material if material', '    grp', '  end', '')
  const H = g.height
  const floor = floorOutline(g.walls.filter(w => w.kind === 'existing'))
  if (floor) {
    const fl = look(g.rooms?.[0]?.floor.mat, 'wood')
    L.push(`  fg = ents.add_group`, `  fg.name = '바닥'`, `  ff = fg.entities.add_face(${pts(floor)}.map { |x, y| Geom::Point3d.new(x.mm, y.mm, 0) })`, '  ff.reverse! if ff && ff.normal.z < 0', "  fg.layer = tags['WKLY-바닥']", `  fg.material = mat.call(${rb(`WKLY 바닥 ${g.rooms?.[0]?.floor.mat?.trim() || '기본'}`)}, ${rgb(fl.color)})`, '')
  }
  g.walls.forEach((w, i) => {
    const lk = look(w.finish, 'paint')
    const tag = w.kind === 'new' ? 'WKLY-가벽' : 'WKLY-벽'
    const label = `${w.kind === 'new' ? '가벽' : '벽'} ${i + 1}${w.type ? ` ${w.type}` : ''}`
    for (const p of wallPieces(w, g.openings, H)) L.push(`  box.call(${pts(pieceCorners(w, p.from, p.to))}, ${n(p.z0)}, ${n(p.z1)}, ${rb(label)}, ${rb(tag)}, mat.call(${rb(`WKLY 벽 ${w.finish?.trim() || '기본'}`)}, ${rgb(lk.color)}))`)
  })
  if (g.items.length) L.push('')
  for (const it of g.items) {
    const w = it.rot === 90 ? it.d : it.w, d = it.rot === 90 ? it.w : it.d
    const shape = itemShape(it.name, it.shape)
    L.push(`  box.call(${pts([{ x: it.x, y: it.y }, { x: it.x + w, y: it.y }, { x: it.x + w, y: it.y + d }, { x: it.x, y: it.y + d }])}, 0, ${n(Math.max(it.h, 20))}, ${rb(it.name.trim() || '집기')}, 'WKLY-집기', mat.call(${rb(`WKLY 집기 ${shape}`)}, ${rgb(SHAPE_COLOR[shape])}))`)
  }
  L.push('  model.commit_operation', '  model.active_view.zoom_extents', `  puts ${rb(`WKLY 평면을 가져왔습니다: 벽 ${g.walls.length} · 집기 ${g.items.length}`)}`, 'rescue => e', '  model.abort_operation', "  UI.messagebox('WKLY 평면을 가져오지 못했습니다: ' + e.message)", 'end', '')
  return L.join('\n')
}
