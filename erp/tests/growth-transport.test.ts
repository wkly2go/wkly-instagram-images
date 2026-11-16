import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'
import { newGrowth } from '../src/lib/growth.ts'

const temp = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '.growth-transport-'))
await build({ entryPoints: [fileURLToPath(new URL('../src/lib/growthApi.ts', import.meta.url))], outdir: temp, bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: { '.js': '.mjs' }, logLevel: 'silent' })
const { createSupabaseGrowthApi } = await import(pathToFileURL(join(temp, 'growthApi.mjs')).href)
after(async () => { await rm(temp, { recursive: true, force: true }) })
const id = '10000000-0000-4000-8000-000000000001'
const draft = { ...newGrowth('contact', id), title: '테스트 후보', document: { ...newGrowth('contact', id).document, email: 'qa@example.test' } }

function transport(respond: () => Response) {
  let calls = 0
  const sb = createClient('https://growth.example.test', 'mock-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async () => { calls++; return respond() } },
  })
  return { api: createSupabaseGrowthApi(sb), calls: () => calls }
}

test('growth transport distinguishes a lost response without automatically retrying writes', async () => {
  const s = transport(() => { throw new TypeError('Failed to fetch') })
  await assert.rejects(s.api.saveGrowth(id, draft, 0), (e: { uncertain?: boolean; status?: number }) => e.uncertain === true && e.status === 0)
  assert.equal(s.calls(), 1)
})
test('growth gateway failures retain the uncertainty marker and do not resend', async () => {
  for (const status of [502, 503, 504]) {
    const s = transport(() => new Response('Gateway unavailable', { status }))
    await assert.rejects(s.api.saveGrowth(id, draft, 0), (e: { uncertain?: boolean; status?: number }) => e.uncertain === true && e.status === status)
    assert.equal(s.calls(), 1)
  }
})
test('explicit duplicate, permission, revision and validation errors never become transport uncertainty', async () => {
  for (const [code, status] of [['23505', 409], ['42501', 403], ['40001', 409], ['P0001', 500], ['PGRST301', 401]] as const) {
    const s = transport(() => Response.json({ code, message: '명시적 거절' }, { status }))
    await assert.rejects(s.api.saveGrowth(id, draft, 0), (e: { code?: string; uncertain?: boolean }) => e.code === code && e.uncertain === false)
    assert.equal(s.calls(), 1)
  }
})
test('same-ID readback preserves missing-row code and does not retry a failed read', async () => {
  const missing = transport(() => Response.json({ code: 'PGRST116', message: 'No row' }, { status: 406 }))
  await assert.rejects(missing.api.getGrowth(id), (e: { code?: string }) => e.code === 'PGRST116')
  assert.equal(missing.calls(), 1)
  const lost = transport(() => { throw new TypeError('Failed to fetch') })
  await assert.rejects(lost.api.getGrowth(id), (e: { uncertain?: boolean }) => e.uncertain === true)
  assert.equal(lost.calls(), 1)
})
