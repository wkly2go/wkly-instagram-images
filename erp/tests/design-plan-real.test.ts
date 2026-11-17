import test from 'node:test'
import assert from 'node:assert/strict'
import { floorOutline, mergeNotes, planQuantities, type PlanGeometry, type PlanWall } from '../src/lib/designPlan.ts'
import { doorSymbol, dimLine, moveCorner, outwardSides, scaleBarLength, setWallLength, wallPieces, wallSolids } from '../src/lib/designPlanDraw.ts'
import { finishLook, itemShape, resolveFinish } from '../src/lib/designPlanLook.ts'
import { dxfScale, dxfToWalls, parseDxf, planToDxf } from '../src/lib/designDxf.ts'
import { planToSketchupRuby } from '../src/lib/designSketchup.ts'

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, kind: 'existing' | 'new' = 'existing', t = 100): PlanWall => ({ id, x1, y1, x2, y2, t, kind })
const room = [wall('a', 0, 0, 6000, 0), wall('b', 6000, 0, 6000, 4000), wall('c', 6000, 4000, 0, 4000), wall('d', 0, 4000, 0, 0)]
const plan: PlanGeometry = { unit: 'mm', height: 2700, walls: room, openings: [{ id: 'o1', wall: 'a', pos: 1500, width: 900, kind: 'door' }, { id: 'o2', wall: 'c', pos: 3000, width: 1200, kind: 'window' }],
  items: [{ id: 'i1', x: 1000, y: 1000, w: 1800, d: 800, h: 750, rot: 0, name: "3인 소파 'A'", trade_code: 'T15', spec: '', unit: 'EA', measure: 'count', section: null }] }

test('마감 글에서 재료 종류와 색을 알아보고, 모르면 중립 값을 쓴다', () => {
  assert.deepEqual([finishLook('PT-01 수성 페인트 백색').kind, finishLook('PT-01 수성 페인트 백색').color], ['paint', '#f4f2ec'])
  assert.equal(finishLook('WF-02 오크 원목 마루').kind, 'wood')
  assert.equal(finishLook('TL-03 포세린 타일 600각 그레이').color, '#b9bbb6')
  assert.equal(finishLook('MT-01 스테인리스 헤어라인').metalness, 0.85)
  assert.deepEqual([finishLook('', 'wood').kind, finishLook('', 'wood').label], ['wood', ''])
  assert.equal(finishLook('알 수 없는 마감').kind, 'plain')
  assert.equal(resolveFinish('PT-01', [{ code: 'PT-01', name: '수성 페인트', spec: '다크 그레이' }]), 'PT-01 수성 페인트 다크 그레이')
  assert.equal(finishLook(resolveFinish('PT-01', [{ code: 'PT-01', name: '수성 페인트', spec: '다크 그레이' }])).color, '#6f716e')
})

test('부품 이름에서 모양을 알아본다', () => {
  assert.deepEqual(['3인 소파', '원형 테이블 Φ900', '진열 선반', '안내 데스크', '포토월', '화분', '시스템 박스'].map(n => itemShape(n)), ['sofa', 'round', 'shelf', 'counter', 'screen', 'plant', 'box'])
  assert.equal(itemShape('무엇', 'bed'), 'bed')
})

test('문은 벽을 끊고 90도 열린 문짝과 호를, 치수선은 닫힌 평면의 바깥쪽에 그린다', () => {
  const d = doorSymbol(room[0], plan.openings[0])
  assert.deepEqual([d.a.x, d.b.x, d.leaves.length, d.leaves[0].r], [1050, 1950, 1, 900])
  assert.deepEqual([d.leaves[0].tip.x, d.leaves[0].tip.y], [1050, -900]) // 기본은 진행 방향 왼쪽(화면 위)
  assert.equal(doorSymbol(room[0], { ...plan.openings[0], side: -1, hinge: 'end' }).leaves[0].tip.y, 900)
  assert.equal(doorSymbol(room[0], { ...plan.openings[0], type: '양개 여닫이 도어' }).leaves.length, 2)
  assert.equal(doorSymbol(room[0], { ...plan.openings[0], type: '미닫이 도어' }).leaves.length, 0)
  const out = outwardSides(plan)
  assert.deepEqual(room.map(w => out.get(w.id)), [1, 1, 1, 1]) // 시계 방향으로 그린 방은 왼쪽이 바깥
  const dim = dimLine(room[0], 400, 1, 100)
  assert.deepEqual([dim.a.y, dim.text, dim.angle], [-450, '6,000', 0])
  assert.equal(scaleBarLength(12000), 2000)
})

test('벽 조각: 문 위와 창 위아래는 채우고, 평면에서는 문 · 창 자리를 비운다', () => {
  assert.deepEqual(wallPieces(room[0], plan.openings, 2700), [{ from: 0, to: 1050, z0: 0, z1: 2700 }, { from: 1050, to: 1950, z0: 2100, z1: 2700 }, { from: 1950, to: 6000, z0: 0, z1: 2700 }])
  assert.equal(wallPieces(room[2], plan.openings, 2700).length, 4)
  assert.deepEqual(wallSolids(room[0], plan.openings), [{ from: 0, to: 1050 }, { from: 1950, to: 6000 }])
})

test('모서리를 옮기면 닿은 벽이 함께 움직이고, 길이를 적으면 방이 닫힌 채로 늘어난다', () => {
  const moved = moveCorner(room, { x: 6000, y: 0 }, { x: 7000, y: 0 })
  assert.deepEqual([moved[0].x2, moved[1].x1, moved[2].x1], [7000, 7000, 6000])
  const longer = setWallLength(room, 'a', 8000)
  assert.deepEqual([longer[0].x2, longer[1].x1], [8000, 8000])
  assert.equal(floorOutline(room)?.length, 4)
})

test('댓글 핀은 서버의 최신 것과 합치고, 내가 지운 것은 되살리지 않는다', () => {
  const mine = [{ id: 'n1', x: 0, y: 0, text: '고침', by: '가', at: '2026-11-17T01:00:00Z' }]
  const latest = [{ id: 'n1', x: 0, y: 0, text: '원래', by: '가', at: '2026-11-17T01:00:00Z' }, { id: 'n2', x: 1, y: 1, text: '남의 것', by: '나', at: '2026-11-17T02:00:00Z' }, { id: 'n3', x: 2, y: 2, text: '지운 것', by: '가', at: '2026-11-17T03:00:00Z' }]
  assert.deepEqual(mergeNotes(mine, latest, ['n3']).map(n => [n.id, n.text]), [['n1', '고침'], ['n2', '남의 것']])
})

test('평면을 DXF 로 내보내고, 그 DXF 를 다시 읽으면 벽의 두 면이 한 벽으로 묶인다', () => {
  const dxf = planToDxf(plan)
  assert.match(dxf, /AC1009/); assert.match(dxf, /A-WALL/); assert.match(dxf, /ARC/); assert.ok(dxf.includes('\\U+C18C\\U+D30C')) // '소파' 는 유니코드 표기
  const d = parseDxf(dxf)
  assert.ok(d.layers.some(l => l.name === 'A-WALL' && l.count >= 16))
  assert.equal(d.skipped.ARC, 1)
  assert.deepEqual(dxfScale(d), { scale: 1, guessed: false }) // 내보낸 파일은 mm 표시 글을 넣는다
  assert.deepEqual(dxfScale({ units: 6, bounds: { x0: 0, y0: 0, x1: 6.2, y1: 4.2 } }), { scale: 1000, guessed: false })
  assert.equal(dxfScale({ units: 6, bounds: d.bounds }).guessed, true) // m 라고 적혔는데 6km 면 짐작으로
  const r = dxfToWalls(d, { layers: ['A-WALL'], scale: 1 })
  // 문 · 창 자리를 건너 이어 붙여 원래 네 벽 · 닫힌 방, 빈칸은 문 · 창으로
  assert.equal(r.walls.length, 4)
  assert.ok(r.walls.every(w => w.t === 100))
  assert.equal(floorOutline(r.walls)?.length, 4)
  assert.deepEqual(r.openings.map(o => [o.kind, o.width, o.pos]).sort(), [['door', 900, 1500], ['window', 1200, 3000]])
  assert.equal(Math.max(...r.walls.flatMap(w => [w.x1, w.x2])) - Math.min(...r.walls.flatMap(w => [w.x1, w.x2])), 6000)
})

test('내보낸 DXF 를 바꾸기로 다시 읽으면 같은 크기의 닫힌 방, 가벽 레이어는 새 가벽 · 나눠 가져와도 같은 자리', () => {
  const g: PlanGeometry = { ...plan, walls: [...room, wall('p', 3800, 0, 3800, 2400, 'new')] }
  const d = parseDxf(planToDxf(g))
  const r = dxfToWalls(d, { layers: ['A-WALL', 'A-WALL-NEW'], scale: dxfScale(d).scale })
  const ex = r.walls.filter(w => w.kind === 'existing')
  assert.equal(ex.length, 4)
  assert.deepEqual(floorOutline(ex)?.map(p => [p.x, p.y]).sort(), [[0, 0], [0, 4000], [6000, 0], [6000, 4000]])
  assert.deepEqual(r.walls.filter(w => w.kind === 'new').map(w => [w.x1, w.y1, w.x2, w.y2]), [[3800, 0, 3800, 2400]])
  const second = dxfToWalls(d, { layers: ['A-WALL-NEW'], scale: 1 })
  assert.deepEqual(second.walls.map(w => [w.x1, w.y1, w.x2, w.y2, w.kind]), [[3800, 0, 3800, 2400, 'new']])
})

const dxfOf = (lines: number[][], layer = 'WALL') => ['0', 'SECTION', '2', 'ENTITIES', ...lines.flatMap(([a, b, c, e]) => ['0', 'LINE', '8', layer, '10', a, '20', b, '11', c, '21', e].map(String)), '0', 'ENDSEC', '0', 'EOF'].join('\n')
test('겹친 벽을 만들지 않는다: 보드 네 줄 벽 · 12mm 유리 · 가운데 선 · 사각 기둥 · 한 줄 더 있는 벽', () => {
  const walls = (lines: number[][]) => dxfToWalls(parseDxf(dxfOf(lines)), { layers: ['WALL'], scale: 1, kind: 'new' }).walls
  const stud = walls([[0, 0, 4000, 0], [0, 12.5, 4000, 12.5], [0, 87.5, 4000, 87.5], [0, 100, 4000, 100]])
  assert.deepEqual(stud.map(w => w.t), [100])
  assert.equal(walls([[0, 0, 4000, 0], [0, 12, 4000, 12]]).map(w => w.t).join(), '12')
  assert.deepEqual(walls([[0, 0, 4000, 0], [0, 75, 4000, 75], [0, 150, 4000, 150]]).map(w => w.t), [150])
  assert.equal(walls([[0, 0, 400, 0], [400, 0, 400, 400], [400, 400, 0, 400], [0, 400, 0, 0]]).length, 1)
  const extra = walls([[0, 0, 4000, 0], [0, 200, 4000, 200], [0, 500, 4000, 500]])
  assert.ok(extra.some(w => w.t === 200) && !extra.some(w => w.t === 300))
  const q = planQuantities({ unit: 'mm', height: 2700, walls: stud, openings: [], items: [] })
  assert.equal(q[0].qty, 10.8)
})

test('T 자 벽은 가운데 선에 붙고, 6,000 줄 넘는 선은 짧은 것부터 빼고 알린다', () => {
  // 두 방: 바깥 6200 × 4200 (두께 100), 가운데 칸막이 x 3100~3200
  const lines = [[0, 0, 6200, 0], [0, 4200, 6200, 4200], [0, 0, 0, 4200], [6200, 0, 6200, 4200], [100, 100, 3100, 100], [3200, 100, 6100, 100], [100, 4100, 3100, 4100], [3200, 4100, 6100, 4100], [100, 100, 100, 4100], [6100, 100, 6100, 4100], [3100, 100, 3100, 4100], [3200, 100, 3200, 4100]]
  const r = dxfToWalls(parseDxf(dxfOf(lines)), { layers: ['WALL'], scale: 1 })
  const mid = r.walls.find(w => w.x1 === w.x2 && w.x1 === 3150)
  assert.ok(mid, '칸막이')
  // 캐드는 y 가 위쪽이라 화면에서는 음수 — 칸막이 끝이 위 · 아래 벽의 가운데 선(-50 · -4150)에 붙는다
  assert.deepEqual([Math.min(mid!.y1, mid!.y2), Math.max(mid!.y1, mid!.y2)], [-4150, -50])
  assert.equal(r.walls.filter(w => w.y1 === w.y2 && w.y1 === -50).length, 1) // 칸막이 자리에서 끊긴 벽도 한 벽으로
  assert.equal(r.walls.length, 5)
  const many = Array.from({ length: 6100 }, (_, i) => [0, i * 1000, 500 + (i % 7) * 100, i * 1000])
  const m = dxfToWalls(parseDxf(dxfOf(many)), { layers: ['WALL'], scale: 1, pair: false })
  assert.equal(m.truncated, 100)
})

test('DXF 읽기: 어긋난 줄 · 뒤집힌 폴리선 · \\U+ 레이어 이름 · 내보내기 글 줄바꿈', () => {
  const text = ['', '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '\\U+BCBD\\U+CCB4', '230', '-1', '70', '0', '10', '1000', '20', '0', '10', '5000', '20', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n')
  const d = parseDxf(text)
  assert.equal(d.layers[0].name, '벽체')
  assert.deepEqual([d.segments[0].x1, d.segments[0].x2], [-1000, -5000])
  const out = planToDxf({ ...plan, items: [{ ...plan.items[0], name: '소파\n둘' }] })
  assert.ok(!/\n[^\r]/.test(out.replace(/\r\n/g, '')))
  assert.ok(out.includes('\\U+C18C\\U+D30C \\U+B458'))
})

test('캐드에서 그린 겹선 벽(두 줄)을 가운데 선과 두께로 읽는다', () => {
  // 바깥 6200 × 4200, 안쪽 6000 × 4000 사각 (벽 두께 100, m 단위 도면)
  const rect = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]
  const lines = [...rect(0, 0, 6.2, 4.2), ...rect(0.1, 0.1, 6.1, 4.1)]
  const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...lines.flatMap(([a, b, c, e]) => ['0', 'LINE', '8', 'WALL', '10', a, '20', b, '11', c, '21', e].map(String)), '0', 'LWPOLYLINE', '8', 'FURN', '70', '1', '10', '1', '20', '1', '10', '2', '20', '1', '10', '2', '20', '2', '0', 'ENDSEC', '0', 'EOF'].join('\n')
  const d = parseDxf(dxf)
  assert.equal(d.units, 6)
  assert.deepEqual(d.layers.map(l => [l.name, l.count]), [['WALL', 8], ['FURN', 3]])
  const r = dxfToWalls(d, { layers: ['WALL'], scale: dxfScale(d).scale })
  assert.deepEqual([r.walls.length, r.paired, r.single], [4, 4, 0])
  assert.ok(r.walls.every(w => w.t === 100))
  assert.equal(floorOutline(r.walls)?.length, 4) // 모서리가 맞닿아 닫힌 방
})

test('스케치업 루비 스크립트: 벽 조각 · 바닥 · 집기를 만들고 따옴표를 막는다', () => {
  const s = planToSketchupRuby(plan, "테스트 '현장'")
  assert.match(s, /^# encoding: UTF-8/)
  assert.match(s, /model\.start_operation/); assert.match(s, /model\.commit_operation/); assert.match(s, /rescue => e/)
  assert.equal(s.split('\n').filter(l => l.includes("'WKLY-벽'") && l.includes('box.call')).length, 3 + 1 + 4 + 1)
  assert.match(s, /3인 소파 \\'A\\'/)
  assert.match(s, /WKLY 평면 · 테스트 \\'현장\\'/)
})

test('스케치업 스크립트: 두께 0 벽 · 크기 0 부품도 멈추지 않고, 상부장 · 벽걸이 TV · 매입등 · 펜던트는 높이에 놓는다', () => {
  const base = plan.items[0]
  const g: PlanGeometry = { ...plan, height: 0, walls: [...room.slice(0, 3), { ...room[3], t: 0 }, wall('z', 100, 100, 100, 100)],
    items: [{ ...base, id: 'u', name: '상부장', z: 1500, h: 700 }, { ...base, id: 't', name: '벽걸이 TV', shape: 'tv', h: 600 }, { ...base, id: 'l', name: '매입등', shape: 'downlight', w: 100, d: 100, h: 80 }, { ...base, id: 'p', name: '펜던트', shape: 'pendant', h: 300 }, { ...base, id: 'x', name: '빈 상자', w: 0, d: 0 }, { ...base, id: 'n', name: '잘못', w: NaN }] }
  const s = planToSketchupRuby(g, '시험')
  assert.match(s, /# 벽 5: 길이가 없어 건너뜀/)
  assert.match(s, /# 잘못: 크기가 비어 있어 건너뜀/)
  assert.ok(!/\[(\[[-\d.]+, [-\d.]+\]), \1/.test(s.replace(/\s/g, ' '))) // 같은 점이 이어지는 면 없음
  const z = (name: string) => s.split('\n').find(l => l.includes('box.call') && l.includes(`'${name}'`))!.match(/\]\], ([-\d.]+), ([-\d.]+), '/)!.slice(1).map(Number)
  assert.deepEqual(z('상부장'), [1500, 2200])
  assert.deepEqual(z('벽걸이 TV'), [900, 1500])
  assert.deepEqual(z('매입등'), [2620, 2700])
  assert.equal(z('펜던트')[1] <= 2700 && z('펜던트')[0] > 1500, true)
  assert.match(s, /skipped \+= 1/); assert.match(s, /made\.to_s/)
})
