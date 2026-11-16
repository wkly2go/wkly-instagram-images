import test from 'node:test'
import assert from 'node:assert/strict'
import { improveInstruction, remeasureInstructions, type SeoTarget } from '../src/lib/seoInstructions.ts'

const many: SeoTarget[] = Array.from({ length: 92 }, (_, i) => ({ kind: i % 3 === 0 ? 'SEO' : i % 3 === 1 ? 'AEO' : 'GEO', item: `측정 항목 ${i} · 핵심 키워드 순위 (팝업 제작 · 전시 부스 · 공간 디자인)`, status: i % 2 ? '미측정' : '미흡' }))

test('92 weak items are split into instructions that each fit the 2000 character limit', () => {
  const texts = remeasureInstructions(many)
  assert.ok(texts.length > 1)
  for (const t of texts) assert.ok(t.trim().length >= 1 && t.length <= 2000, `length ${t.length}`)
  // 모든 항목이 빠짐없이 한 번씩 들어간다
  for (const m of many) assert.equal(texts.filter(t => t.includes(`${m.item} (`)).length, 1)
  assert.match(texts[0], /1\/\d+/)
})

test('a few items stay in a single unnumbered instruction', () => {
  const texts = remeasureInstructions(many.slice(0, 3))
  assert.equal(texts.length, 1)
  assert.doesNotMatch(texts[0], /\d\/\d/)
})

test('very long item names and notes never push an instruction over the limit', () => {
  const long = 'https://www.example.com/' + 'a'.repeat(3000)
  for (const t of remeasureInstructions([{ kind: 'SEO', item: long, status: '미흡' }])) assert.ok(t.length <= 2000)
  const text = improveInstruction({ kind: 'GEO', item: long, status: '미흡', value: long, note: long, source: long }, long)
  assert.ok(text.length <= 2000)
  assert.match(text, /^\[검색 노출 개선\] \[GEO\]/)
})

test('improve instruction keeps the draft-only rule', () => {
  assert.match(improveInstruction({ kind: 'AEO', item: '첫 문단 요약', status: '주의' }, '요약 보강'), /직접 수정하거나 게시하지 말고/)
})
