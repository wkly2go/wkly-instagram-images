import test from 'node:test'
import assert from 'node:assert/strict'
import { imagesToPdf } from '../src/lib/imagePdf.ts'

test('그림 두 장 → 두 쪽 PDF · xref 위치가 맞다', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  const pdf = imagesToPdf([{ jpeg, width: 1600, height: 900 }, { jpeg, width: 900, height: 1600 }], '보드 1')
  const text = new TextDecoder('latin1').decode(pdf)
  assert.match(text, /^%PDF-1\.4/)
  assert.match(text, /\/Count 2/)
  assert.match(text, /\/MediaBox \[0 0 842 474\]/)
  assert.match(text, /\/MediaBox \[0 0 474 842\]/)
  const start = Number(/startxref\n(\d+)/.exec(text)![1])
  assert.equal(text.slice(start, start + 4), 'xref')
  // 각 객체 위치가 'n 0 obj' 를 가리킴
  const rows = text.slice(start).split('\n').slice(3, 6)
  rows.forEach((r, i) => assert.equal(text.slice(Number(r.slice(0, 10)), Number(r.slice(0, 10)) + 7), `${i + 1} 0 obj`))
})

test('빈 목록은 거절', () => {
  assert.throws(() => imagesToPdf([]))
})
