import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { findGuides, GUIDES, GUIDE_TOKEN_RE } from '../src/lib/guides.ts'

test('agent-chat copy of guides is identical to the web copy', () => {
  const web = readFileSync(new URL('../src/lib/guides.ts', import.meta.url), 'utf8')
  const fn = readFileSync(new URL('../supabase/functions/agent-chat/guides.ts', import.meta.url), 'utf8')
  assert.equal(fn, web)
})

test('guides cover common questions and never point at admin-only screens', () => {
  assert.equal(findGuides('할 일 다음날로 미루는 법')[0].id, 'tasks')
  assert.equal(findGuides('주간 보고 어떻게 내?')[0].id, 'weekly')
  assert.equal(findGuides('채팅에 캡처 사진 붙여넣기')[0].id, 'chat')
  for (const g of GUIDES) assert.ok(!/^\/(ledger|gov|admin|agents|interview-questions|design-orders)/.test(g.path), g.id)
  assert.equal(new Set(GUIDES.map(g => g.id)).size, GUIDES.length)
})

test('media files exist for every guide that claims them', () => {
  for (const g of GUIDES) {
    if (g.image) assert.ok(readFileSync(new URL(`../public/manual/guide/${g.id}.jpg`, import.meta.url)).length > 1000, g.id)
    if (g.video) assert.ok(readFileSync(new URL(`../public/manual/guide/${g.id}.webm`, import.meta.url)).length > 1000, g.id)
  }
  assert.deepEqual([...'안내 [[안내:tasks]] 끝'.matchAll(GUIDE_TOKEN_RE)].map(m => m[1]), ['tasks'])
})
