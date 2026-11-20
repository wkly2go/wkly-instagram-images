import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanNodeIds, framesOf, isWide, parseFigmaUrl, textOf } from '../supabase/functions/figma/parse.ts'
import { figmaEmbedUrl, isWide as isWideUi } from '../src/lib/figma.ts'

test('피그마 주소 읽기: 피그잼 · 디자인 · 슬라이드 · 가지 · 노드', () => {
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/board/AbCdEf1234567890/WKLY-회의?node-id=12-34&t=x'), { key: 'AbCdEf1234567890', kind: 'board', nodeId: '12:34' })
  assert.equal(parseFigmaUrl('https://www.figma.com/design/AbCdEf1234567890/x')?.kind, 'design')
  assert.equal(parseFigmaUrl('https://figma.com/file/AbCdEf1234567890/x')?.kind, 'design')
  assert.equal(parseFigmaUrl('https://www.figma.com/slides/AbCdEf1234567890/x')?.kind, 'slides')
  assert.equal(parseFigmaUrl('https://www.figma.com/design/AbCdEf1234567890/branch/ZyXw9876543210/x')?.key, 'ZyXw9876543210')
  assert.equal(parseFigmaUrl('https://evil.com/board/AbCdEf1234567890/x'), null)
  assert.equal(parseFigmaUrl('https://www.figma.com/community/file/123'), null)
  assert.equal(parseFigmaUrl('아무 글'), null)
})

test('프레임 목록: 페이지마다 맨 위 프레임 · 섹션만, 슬라이드 줄 안까지', () => {
  const doc = { children: [
    { name: '페이지 1', children: [
      { id: '1:2', name: '표지', type: 'FRAME', absoluteBoundingBox: { width: 1920, height: 1080 } },
      { id: '1:3', name: '포스트잇', type: 'STICKY' },
      { id: '1:4', name: '아이디어', type: 'SECTION', absoluteBoundingBox: { width: 3000, height: 2000 } },
    ] },
    { name: '슬라이드', children: [{ id: '2:1', type: 'SLIDE_GRID', children: [{ id: '2:2', type: 'SLIDE_ROW', children: [{ id: '2:3', name: '1', type: 'SLIDE', absoluteBoundingBox: { width: 1920, height: 1080 } }] }] }] },
  ] }
  const f = framesOf(doc)
  assert.deepEqual(f.map(x => x.id), ['1:2', '1:4', '2:3'])
  assert.equal(f[0].page, '페이지 1')
  assert.deepEqual(framesOf(null), [])
})

test('보드 글 모으기 · 한도', () => {
  const doc = { children: [{ characters: ' 첫 메모 ', children: [{ characters: '둘째' }, { characters: '' }] }] }
  assert.equal(textOf(doc), '첫 메모\n둘째')
  assert.equal(textOf(doc, 3).length, 3)
})

test('16:9 판정 · 화면과 서버가 같음', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [1000, 1000], [0, 0], [1920, 1100]] as const) assert.equal(isWide(w, h), isWideUi(w, h))
  assert.equal(isWide(1920, 1080), true)
  assert.equal(isWide(1080, 1920), false)
})

test('노드 id 정리 · 보기 주소', () => {
  assert.deepEqual(cleanNodeIds(['1:2', '1-2', '3:4', 'x', 5, '1:2;3:4']), ['1:2', '3:4', '1:2;3:4'])
  assert.deepEqual(cleanNodeIds('1:2'), [])
  assert.match(figmaEmbedUrl('https://www.figma.com/board/Ab/x'), /^https:\/\/www\.figma\.com\/embed\?embed_host=wkly-erp&url=https%3A%2F%2Fwww\.figma\.com%2Fboard%2FAb%2Fx$/)
})
