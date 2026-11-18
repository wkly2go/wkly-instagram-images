import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isStaleChunkError } from '../src/lib/staleChunk.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('a page that cannot load after a new deploy is told apart from other errors', () => {
  for (const m of ['Failed to fetch dynamically imported module: https://wkly-erp.pages.dev/assets/Admin-AbC.js', 'Importing a module script failed.', 'error loading dynamically imported module', 'Unable to preload CSS for /assets/Design-x.css'])
    assert.equal(isStaleChunkError(new TypeError(m)), true, m)
  const chunk = new Error('Loading chunk 12 failed.'); chunk.name = 'ChunkLoadError'
  assert.equal(isStaleChunkError(chunk), true)
  assert.equal(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'map')")), false)
  assert.equal(isStaleChunkError('네트워크 오류'), false)
})

test('every page, the quick window, the app root and both public pages sit inside the error guard', () => {
  const app = read('../src/App.tsx')
  assert.match(app, /<ErrorBoundary key=\{path\}[\s\S]*?>\s*<Suspense[\s\S]*?<Page \/>[\s\S]*?<\/Suspense>\s*<\/ErrorBoundary>/)
  assert.match(app, /<ErrorBoundary area="빠른 창">\s*<Quick \/>/)
  assert.match(read('../src/main.tsx'), /<ErrorBoundary area="인트라넷" full>\s*<RouterProvider>/)
  assert.match(read('../src/pages/InterviewFormPage.tsx'), /<ErrorBoundary area="인터뷰지" full><InterviewFormPage/)
  assert.match(read('../src/pages/GuestRoom.tsx'), /<ErrorBoundary area="협업방" full><GuestApp/)
})

test('the guard never reloads by itself (updates only when the person presses the button)', () => {
  const src = read('../src/components/ErrorBoundary.tsx')
  const reloads = [...src.matchAll(/window\.location\.reload\(\)/g)].length
  const inClick = [...src.matchAll(/onClick=\{\(\) => window\.location\.reload\(\)\}/g)].length
  assert.equal(reloads, inClick)
})
