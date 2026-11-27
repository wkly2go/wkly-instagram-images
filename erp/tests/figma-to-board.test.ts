import test from 'node:test'
import assert from 'node:assert/strict'
import { flattenFrame, type FNode } from '../supabase/functions/figma/parse.ts'
import { figmaToSkeleton } from '../src/lib/figmaToBoard.ts'

const bb = (x: number, y: number, width: number, height: number) => ({ absoluteBoundingBox: { x, y, width, height } })
const red = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]

const frame: FNode = {
  id: '1:1', type: 'FRAME', name: '제안서 01', ...bb(100, 100, 1920, 1080), fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
  children: [
    { id: '1:2', type: 'TEXT', characters: '포켓몬 화석박물관', style: { fontSize: 48, textAlignHorizontal: 'CENTER' }, fills: red, ...bb(200, 150, 600, 60) } as FNode,
    { id: '1:3', type: 'RECTANGLE', fills: red, cornerRadius: 12, ...bb(200, 300, 400, 200) } as FNode,
    { id: '1:4', type: 'GROUP', ...bb(700, 300, 100, 100), children: [{ id: '1:5', type: 'VECTOR', ...bb(700, 300, 100, 100) }] } as FNode,
    { id: '1:6', type: 'TEXT', characters: '숨김', visible: false, ...bb(0, 0, 10, 10) } as FNode,
    { id: '1:7', type: 'STICKY', characters: '메모', ...bb(900, 300, 200, 200) } as FNode,
    { id: '1:8', type: 'CONNECTOR', connectorStart: { endpointNodeId: '1:3' }, connectorEnd: { endpointNodeId: '1:7' }, ...bb(400, 400, 600, 0) } as FNode,
  ],
}

test('프레임 → 평평한 요소 (글 · 사각형 · 아이콘 그림 · 포스트잇 · 연결선 · 숨김 제외)', () => {
  const { els, truncated } = flattenFrame(frame)
  assert.equal(truncated, false)
  const kinds = els.map(e => `${e.id}:${e.kind}`)
  assert.deepEqual(kinds, ['1:1:frame', '1:2:text', '1:3:rect', '1:4:raster', '1:7:rect', '1:7:t:text', '1:8:arrow'])
  const t = els.find(e => e.id === '1:2')!
  assert.equal(t.fontSize, 48); assert.equal(t.align, 'center'); assert.equal(t.color, '#ff0000')
  const a = els.find(e => e.kind === 'arrow')!
  assert.deepEqual([a.x, a.y], [400, 400]) // 사각형 가운데
  assert.deepEqual(a.points, [[0, 0], [600, 0]]) // 포스트잇 가운데까지
})

test('요소 한도를 넘으면 truncated', () => {
  assert.equal(flattenFrame(frame, 3).truncated, true)
})

test('뼈대: 위치를 옮기고 프레임이 자식을 묶음 · 그림 없으면 점선 자리', () => {
  const { els } = flattenFrame(frame)
  const out = figmaToSkeleton({ frames: [{ id: '1:1', els, truncated: false }], images: {}, skipped: 0 }, { x: 0, y: 0 }, 's')
  const fr = out.skeleton.find(s => s.type === 'frame')!
  assert.equal(fr.x, 0); assert.equal(fr.y, 0)
  assert.equal((fr.children as string[]).length, out.skeleton.length - 1)
  const txt = out.skeleton.find(s => s.type === 'text' && s.text === '포켓몬 화석박물관')!
  assert.deepEqual([txt.x, txt.y], [100, 50])
  assert.equal(out.rasterMissing, 1)
  const withImg = figmaToSkeleton({ frames: [{ id: '1:1', els, truncated: false }], images: { '1:4': { mime: 'image/png', data: 'AAAA' } }, skipped: 0 }, { x: 0, y: 0 }, 's')
  assert.equal(withImg.files.length, 1)
  assert.ok(withImg.skeleton.some(s => s.type === 'image' && s.fileId === withImg.files[0].id))
})

test('얇은 벡터는 선 · 화살 끝이 있으면 화살표 (피그마 Arrow)', () => {
  const f: FNode = { id: '2:1', type: 'FRAME', ...bb(0, 0, 500, 500), children: [
    { id: '2:2', type: 'VECTOR', strokeCap: 'LINE_ARROW', strokes: red, strokeWeight: 2, ...bb(10, 10, 300, 0) } as FNode,
    { id: '2:3', type: 'VECTOR', strokes: red, strokeWeight: 2, ...bb(10, 10, 0.00002, 200) } as FNode,
  ] }
  const els = flattenFrame(f).els
  const a = els.find(e => e.id === '2:2')!, l = els.find(e => e.id === '2:3')!
  assert.equal(a.kind, 'arrow'); assert.deepEqual(a.points, [[0, 0], [300, 0]]); assert.equal(a.stroke, '#ff0000')
  assert.equal(l.kind, 'line'); assert.deepEqual(l.points, [[0, 0], [0, 200]])
})

test('가운데 정렬 글은 잰 폭으로 피그마 상자 가운데에', async () => {
  const { placeTexts } = await import('../src/lib/figmaToBoard.ts')
  const out = placeTexts([{ id: 'a', type: 'text', x: 0, width: 40 }, { id: 'b', type: 'text', x: 0, width: 40 }, { id: 'c', type: 'rectangle', x: 5, width: 40 }],
    { a: { x: 100, w: 200, align: 'center' }, b: { x: 100, w: 200, align: 'right' } })
  assert.deepEqual(out.map(e => e.x), [180, 260, 5])
})

test('모두 고르기: 섹션 · 작은 조각은 빼고 최대 30개 · 여러 번 받은 것 합치기', async () => {
  const { pickAllFrames, mergeContents } = await import('../src/lib/figmaToBoard.ts')
  const frames = [
    { id: 's', type: 'SECTION', w: 9000, h: 3000 }, { id: 'a', type: 'FRAME', w: 1920, h: 1080 },
    { id: 'b', type: 'INSTANCE', w: 197, h: 71 }, { id: 'c', type: 'FRAME', w: 1191, h: 842 },
  ]
  assert.deepEqual(pickAllFrames(frames).map(f => f.id), ['a', 'c'])
  assert.equal(pickAllFrames(Array.from({ length: 40 }, (_, i) => ({ id: String(i), type: 'FRAME', w: 500, h: 500 }))).length, 30)
  const m = mergeContents([
    { frames: [{ id: '1', els: [], truncated: false }], images: { x: { mime: 'image/png', data: 'A' } }, skipped: 1 },
    { frames: [{ id: '2', els: [], truncated: true }], images: { y: { mime: 'image/png', data: 'B' } }, skipped: 2 },
  ])
  assert.deepEqual(m.frames.map(f => f.id), ['1', '2']); assert.deepEqual(Object.keys(m.images), ['x', 'y']); assert.equal(m.skipped, 3)
})

test('글꼴 고르기 · 피그마로 내보낼 때 글꼴 이름', async () => {
  const { figmaFontId, svgFontsForFigma, BOARD_FONT } = await import('../src/lib/boardFonts.ts')
  assert.equal(figmaFontId('Pretendard', 400), BOARD_FONT.regular)
  assert.equal(figmaFontId('Noto Sans KR', 900), BOARD_FONT.bold)
  assert.equal(figmaFontId('Gmarket Sans', 500), BOARD_FONT.display)
  assert.equal(figmaFontId(undefined, undefined), BOARD_FONT.regular)
  const svg = svgFontsForFigma('<text font-family="Helvetica, Segoe UI Emoji">a</text><text font-family="Liberation Sans, Segoe UI Emoji">b</text>')
  assert.match(svg, /font-family="Pretendard, Noto Sans KR, sans-serif">a/)
  assert.match(svg, /font-weight="700">b/)
})

test('글 폭이 피그마 상자보다 넓으면 줄여 맞춤 · 줄 간격 전달', async () => {
  const { placeTexts } = await import('../src/lib/figmaToBoard.ts')
  const [t] = placeTexts([{ id: 't', type: 'text', x: 0, width: 220, height: 40, fontSize: 20 }], { t: { x: 100, w: 200, align: 'center' } })
  assert.equal(t.width, 200); assert.equal(t.x, 100); assert.ok(Math.abs(t.fontSize - 18.2) < 0.01)
  const f: FNode = { id: '9:1', type: 'FRAME', ...bb(0, 0, 100, 100), children: [{ id: '9:2', type: 'TEXT', characters: '가', style: { fontSize: 20, lineHeightPx: 30, fontFamily: 'Pretendard', fontWeight: 700 }, ...bb(0, 0, 50, 30) } as FNode] }
  const e = flattenFrame(f).els.find(x => x.kind === 'text')!
  assert.equal(e.lineHeight, 1.5); assert.equal(e.font, 'Pretendard'); assert.equal(e.weight, 700)
})

test('저장: 하루 지난 지운 요소는 버림 · 요소가 많으면 저장 간격을 늘림', async () => {
  const { sceneForSave, saveDelay, TOMBSTONE_MS } = await import('../src/lib/board.ts')
  const now = 10 * TOMBSTONE_MS
  const s = sceneForSave([
    { id: 'a', isDeleted: false, updated: 0 }, { id: 'b', isDeleted: true, updated: now - TOMBSTONE_MS - 1 }, { id: 'c', isDeleted: true, updated: now - 1000 },
  ] as never, {}, undefined, now)
  assert.deepEqual(s.elements.map(e => e.id), ['a', 'c'])
  assert.deepEqual([saveDelay(10), saveDelay(1000), saveDelay(5000)], [2000, 5000, 9000])
})
