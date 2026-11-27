import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawCardEnd, drawCardSlide } from '../src/lib/cardNews.ts'

// 캔버스 대신 그리기 호출만 적어 두는 가짜 (브라우저 없이 '로고를 그렸나'만 본다)
function fakeCanvas() {
  const calls: { fn: string; args: unknown[] }[] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (key in target) return target[key as string]
      if (key === 'measureText') return (s: string) => ({ width: s.length * 30 })
      return (...args: unknown[]) => { calls.push({ fn: String(key), args }) }
    },
    set(target, key, value) { target[key as string] = value; return true },
  })
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, calls }
}
const logo = { img: {} as CanvasImageSource, w: 320, h: 101 }

test('카드뉴스 본문 장: 로고가 있으면 회사 이름 글자 대신 로고 (비율 유지)', () => {
  const a = fakeCanvas()
  drawCardSlide(a.canvas, { title: '장소가 먼저입니다', body: '연말 일정은 빨리 찹니다' }, 2, 5, 'wkly', 'THE WKLY', logo)
  const img = a.calls.find(c => c.fn === 'drawImage')!
  assert.ok(img)
  const [, , , w, h] = img.args as number[]
  assert.equal(h, 34)
  assert.ok(Math.abs(w - (34 * 320) / 101) < 0.01)
  assert.ok(!a.calls.some(c => c.fn === 'fillText' && c.args[0] === 'THE WKLY'))
  const b = fakeCanvas()
  drawCardSlide(b.canvas, { title: '제목', body: '설명' }, 2, 5, 'arterior', 'ARTERIOR')
  assert.ok(b.calls.some(c => c.fn === 'fillText' && c.args[0] === 'ARTERIOR'))
  assert.ok(!b.calls.some(c => c.fn === 'drawImage'))
})

test('마지막 장: 로고는 가운데 · 없으면 예전처럼 글자', () => {
  const a = fakeCanvas()
  drawCardEnd(a.canvas, '대관 문의', 'https://www.thewklyn.com/', 'wkly', 'THE WKLY', logo)
  const img = a.calls.find(c => c.fn === 'drawImage')!
  const [, x, , w] = img.args as number[]
  assert.ok(Math.abs(x + w / 2 - 540) < 0.01) // 가운데
  const b = fakeCanvas()
  drawCardEnd(b.canvas, '대관 문의', 'https://www.thewklyn.com/', 'wkly', 'THE WKLY')
  assert.ok(b.calls.some(c => c.fn === 'fillText' && c.args[0] === 'THE WKLY'))
})
