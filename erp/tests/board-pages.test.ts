import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextPagePlace, pageLabel, pageList, PAGE_GAP, PAGE_ROW, PAGE_SIZES } from '../src/lib/boardPages.ts'
import { pptFit, pptSlideSize, pptTexts } from '../src/lib/pptxExport.ts'
import { parseXml, pptxToContent, resolvePath, wrapText } from '../src/lib/pptxImport.ts'

const frame = (id: string, x: number, y: number, w = 1920, h = 1080) => ({ id, type: 'frame', x, y, width: w, height: h, name: id })

test('첫 페이지는 0,0 · 다음은 오른쪽 · 한 줄이 차면 아래', () => {
  assert.deepEqual(nextPagePlace([], 'slide'), { x: 0, y: 0, width: 1920, height: 1080, name: '슬라이드 1' })
  const one = [frame('a', 0, 0)]
  assert.equal(nextPagePlace(one, 'slide').x, 1920 + PAGE_GAP)
  const row = Array.from({ length: PAGE_ROW }, (_, i) => frame(`f${i}`, i * 2040, 0))
  const next = nextPagePlace(row, 'a4p')
  assert.deepEqual([next.x, next.y, next.width, next.name], [0, 1080 + PAGE_GAP, PAGE_SIZES.a4p.w, `A4 ${PAGE_ROW + 1}`])
  // 페이지 없이 그림만 있으면 그 오른쪽
  assert.equal(nextPagePlace([{ id: 'r', type: 'rectangle', x: 100, y: 50, width: 200, height: 80 }], 'slide').x, 300 + PAGE_GAP)
})

test('페이지 순서 = 위 → 아래, 왼쪽 → 오른쪽 · 지운 것 제외', () => {
  const list = pageList([frame('c', 0, 1200), frame('b', 2040, 0), frame('a', 0, 0), { ...frame('x', 0, 0), isDeleted: true }, { id: 't', type: 'text', x: 0, y: 0, width: 1, height: 1 }])
  assert.deepEqual(list.map(p => p.id), ['a', 'b', 'c'])
  assert.equal(pageLabel({ ...frame('a', 0, 0), name: ' ' }, 2), '페이지 3')
})

test('PPT 내보내기 자리 계산', () => {
  const f = { x: 100, y: 200, width: 1920, height: 1080 }
  const size = pptSlideSize(f)
  assert.equal(size.h, 7.5)
  const fit = pptFit(f, size.w, size.h)
  const [t] = pptTexts(f, [{ x: 100 + 960, y: 200 + 540, width: 192, height: 54, text: '제목', fontSize: 48, fontFamily: 9, textAlign: 'left', strokeColor: '#1f6b4a' }, { x: 0, y: 0, width: 10, height: 10, text: ' ', fontSize: 10 }], fit)
  assert.ok(Math.abs(t.x - size.w / 2) < 0.01 && Math.abs(t.y - 3.75) < 0.01)
  assert.equal(t.fontSize, 24) // 48px × (13.333in ÷ 1920px) × 72
  assert.deepEqual([t.color, t.bold, t.align], ['1F6B4A', true, 'left'])
  // 세로 페이지는 가운데에 맞춤
  const tall = pptFit({ x: 0, y: 0, width: 794, height: 1123 }, size.w, size.h)
  assert.ok(tall.ox > 3 && Math.abs(tall.oy) < 1e-9)
})

test('XML · 경로 · 줄 바꿈', () => {
  const x = parseXml('<?xml version="1.0"?><a:p xmlns:a="x"><a:r><a:t>A &amp; B</a:t></a:r><a:br/></a:p>')
  assert.equal(x.kids[0].kids[0].kids[0].text, 'A & B')
  assert.equal(x.kids[0].kids[1].tag, 'a:br')
  assert.equal(resolvePath('ppt/slides/slide1.xml', '../media/image1.png'), 'ppt/media/image1.png')
  assert.equal(wrapText('가나다라마바사아자차', 50, 10).split('\n').length, 2)
  assert.equal(wrapText('hello world again', 60, 10), 'hello world\nagain')
})

const enc = (s: string) => new TextEncoder().encode(s)
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
test('pptx → 보드 요소 (도형 · 글 · 묶음 · 사진 · 표는 건너뜀)', () => {
  const files: Record<string, Uint8Array> = {
    'ppt/presentation.xml': enc(`<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': enc('<Relationships><Relationship Id="rId1" Type="http://x/slide" Target="slides/slide1.xml"/></Relationships>'),
    'ppt/slides/_rels/slide1.xml.rels': enc('<Relationships><Relationship Id="rId2" Type="http://x/image" Target="../media/image1.png"/></Relationships>'),
    'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
    'ppt/slides/slide1.xml': enc(`<p:sld ${NS}><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="r"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="6096000" y="0"/><a:ext cx="6096000" cy="3429000"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="1F6B4A"/></a:solidFill></p:spPr>
        <p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2400" b="1"/><a:t>원 안 글</a:t></a:r></a:p></p:txBody></p:sp>
      <p:grpSp><p:grpSpPr><a:xfrm><a:off x="0" y="3429000"/><a:ext cx="6096000" cy="3429000"/><a:chOff x="0" y="0"/><a:chExt cx="12192000" cy="6858000"/></a:xfrm></p:grpSpPr>
        <p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="6096000" y="0"/><a:ext cx="6096000" cy="6858000"/></a:xfrm></p:spPr></p:pic></p:grpSp>
      <p:graphicFrame/>
    </p:spTree></p:cSld></p:sld>`),
  }
  const r = pptxToContent(files)
  assert.deepEqual([r.slides, r.width, r.height, r.skipped, r.missingImages], [1, 1920, 1080, 1, 0])
  const [f, circle, text, img] = r.frames[0].els
  assert.deepEqual([f.kind, f.w, f.h, f.name], ['frame', 1920, 1080, '슬라이드 1'])
  assert.deepEqual([circle.kind, circle.x, circle.w, circle.h, circle.fill], ['ellipse', 960, 960, 540, '#1f6b4a'])
  assert.deepEqual([text.kind, text.text, text.fontSize, text.align, text.weight], ['text', '원 안 글', 48, 'center', 700])
  assert.ok(text.y > 200 && text.y < 280)
  // 묶음 안 사진: 절반 크기로 왼쪽 아래 칸의 오른쪽 절반
  assert.deepEqual([img.kind, img.x, img.y, img.w, img.h], ['raster', 480, 540, 480, 540])
  assert.equal(r.images[img.id].mime, 'image/png')
  assert.throws(() => pptxToContent({}), /pptx/)
})
