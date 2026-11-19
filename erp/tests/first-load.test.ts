// 첫 화면 묶음이 다시 무거워지지 않게 지키는 시험 (2026-11-19 성능)
// 첫 화면에 꼭 필요한 것만 한 덩어리에 두고, 뒤에서 불러오는 칸은 정적으로 끌어오지 않는다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const staticImports = (src: string) => [...src.matchAll(/^import\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])

test('libraries that rarely change are built as their own long-cached files', () => {
  const cfg = read('../vite.config.ts')
  assert.match(cfg, /manualChunks/)
  assert.match(cfg, /return 'vendor-supabase'/)
  assert.match(cfg, /return 'vendor-react'/)
})

test('panels that can come after the first screen are not pulled in statically', () => {
  const banned: [string, RegExp[]][] = [
    ['../src/App.tsx', [/pages\/Quick$/, /components\/CommandPalette$/]],
    ['../src/components/Shell.tsx', [/pages\/Quick$/, /\/AssistantFloat$/, /\/CommandPalette$/]],
    ['../src/components/WebSearch.tsx', [/\/RightSchedule$/, /\/WeekPanel$/]],
    ['../src/components/RightSchedule.tsx', [/pages\/Clients$/]],
    ['../src/pages/Home.tsx', [/\/Approvals$/]],
  ]
  for (const [file, rules] of banned) {
    const imports = staticImports(read(file))
    for (const rule of rules) assert.equal(imports.find(i => rule.test(i)), undefined, `${file} 가 ${rule} 를 정적으로 불러옴`)
  }
})

test('the search window opener works before the window itself is loaded', () => {
  const host = read('../src/components/CommandPaletteHost.tsx')
  assert.match(host, /lazy\(\(\) =>\s*load\(\)/)
  assert.match(host, /e\.key\.toLowerCase\(\) === 'k'/)
  assert.match(read('../src/components/Shell.tsx'), /from '\.\/CommandPaletteHost'/)
})

test('a room asked for before the chat column loads is not lost', () => {
  const chat = read('../src/lib/chat.ts')
  assert.match(chat, /export function askQuickRoom/)
  assert.match(chat, /export function takeQuickRoom/)
  assert.match(read('../src/pages/Quick.tsx'), /open\(takeQuickRoom\(\)\)/)
})

test('web fonts do not block the first paint and Noto Sans KR is no longer downloaded', () => {
  const html = read('../index.html')
  assert.doesNotMatch(html, /Noto\+Sans\+KR/)
  const sheets = [...html.matchAll(/<link rel="stylesheet"[^>]*>/g)].map(m => m[0]).filter(l => /fonts\.googleapis|jsdelivr/.test(l) && !/noscript/.test(l))
  const head = html.split('<noscript>')[0]
  for (const l of [...head.matchAll(/<link rel="stylesheet"[^>]*>/g)].map(m => m[0])) assert.match(l, /media="print" onload="this\.media='all'"/, l)
  assert.ok(sheets.length >= 2)
})
