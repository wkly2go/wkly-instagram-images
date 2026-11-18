import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toRow } from '../supabase/functions/design-price-refs/row.ts'
import { classRow, itemRow, limitedToday, parseList, runCatalog } from '../supabase/functions/design-price-refs/catalog.ts'
import { mallRow, nextMallDay, runMall } from '../supabase/functions/design-price-refs/mall.ts'

test('material price rows keep name, spec, unit, region and notice date', () => {
  const r = toRow({ prdctClsfcNoNm: '석고보드', krnPrdctNm: '일반 9.5mm 900*1800', unit: '매', prce: '3,250', splyJrsdctRgnNm: '서울', prdctIdntNo: '24123456', nticeDt: '20260701', bsnsDivNm: '건축' })
  assert.ok(r)
  assert.equal(r.item, '석고보드')
  assert.equal(r.price, 3250)
  assert.equal(r.notice_date, '2026-07-01')
  assert.equal(r.ref_key, '24123456|서울|매')
})

test('market construction rows add material, labour and expense when no total is given', () => {
  const r = toRow({ prdnm: '경량철골천장틀', spec: 'M-BAR', unit: 'm2', mtrlcstUprc: 8000, lbrcstUprc: '12,500', gnrexpnsUprc: 300, qtyCalcCtyclcd: 'A01', pblctDate: '2026-07-01' })
  assert.ok(r)
  assert.equal(r.price, 20800)
  assert.equal(r.labor, 12500)
})

test('rows without a name or price are dropped', () => {
  assert.equal(toRow({ prce: 100 }), null)
  assert.equal(toRow({ prdctClsfcNoNm: '타일' }), null)
})

test('migration keeps writes service-only and members read-only', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261117140000_design_price_refs.sql', import.meta.url), 'utf8')
  assert.match(sql, /grant execute on function public\.design_price_refs_save\([^)]*\) to service_role/)
  assert.match(sql, /grant select on design\.price_refs to authenticated/)
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*price_refs[^;]*authenticated/i)
})

test('rows whose identifier is empty or zero are keyed by name and spec', () => {
  const a = toRow({ prdctClsfcNoNm: '창대석', krnPrdctNm: 'T30', unit: 'M', prce: '100', prdctIdntNo: '0' })
  const b = toRow({ prdctClsfcNoNm: '재료분리대', krnPrdctNm: 'T20', unit: 'M', prce: '200', prdctIdntNo: '' })
  assert.ok(a && b)
  assert.equal(a.ref_key, '창대석|T30||M')
  assert.notEqual(a.ref_key, b.ref_key)
})

test('price reference codes are added without dropping anything and stay service-written', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261118173000_design_price_ref_codes.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /\bdrop\s/i)
  assert.match(sql, /add column if not exists code text/)
  assert.match(sql, /perform design\.price_refs_assign_codes\(p_source\)/)
  const reg = readFileSync(new URL('../supabase/migrations/20261118174500_design_price_ref_code_registry.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(reg, /\bdrop\s/i)
  assert.match(reg, /primary key \(source, item, spec, unit\)/)
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*price_ref[^;]*authenticated/i)
})

test('catalog rows: classes use the detail columns at level 10, deleted items are dropped', () => {
  assert.deepEqual(classRow({ prdctClsfcNo: '3016', prdctClsfcNoNm: '내장마감재', prdctClsfcNoEngNm: 'Interior finishing', useYn: 'Y' }, 4), { code: '3016', name: '내장마감재', name_en: 'Interior finishing', level: 4, use_yn: true })
  assert.equal(classRow({ dtilPrdctClsfcNo: '3016150901', dtilPrdctClsfcNoNm: '석고보드' }, 10)?.code, '3016150901')
  assert.equal(classRow({ prdctClsfcNo: '', prdctClsfcNoNm: 'x' }, 4), null)
  const it = { prdctIdntNo: '20153194', prdctClsfcNo: '30161509', dtilPrdctClsfcNo: '3016150901', krnPrdctNm: '석고보드, 평보드, 12.5×900×2400mm', mnfctCorpNm: '케이씨씨', prdlstDiv: '시설', chgDt: '2022-11-18 17:59:59', useYn: 'Y', dltYn: 'N' }
  assert.equal(itemRow(it)?.chg_date, '2022-11-18')
  assert.equal(itemRow({ ...it, dltYn: 'Y' }), null)
  assert.equal(parseList('{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR"}}}').err, 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR')
})

test('catalog run saves classes then items and remembers where it stopped', async () => {
  const saves: { kind: string; n: number; state: Record<string, unknown>; done: boolean }[] = []
  const db = { rpc: async (fn: string, a: Record<string, unknown> = {}) => {
    if (fn === 'design_g2b_plan') return { data: [], error: null }
    if (fn === 'design_g2b_item_classes') return { data: a.p_after ? [] : ['30161509|석고보드'], error: null }
    saves.push({ kind: String(a.p_kind), n: (a.p_rows as unknown[]).length, state: a.p_state as Record<string, unknown>, done: !!a.p_done })
    return { data: (a.p_rows as unknown[]).length, error: null }
  } }
  const call = async (op: string) => ({ status: 200, text: JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 1, items: op.includes('PrdlstSearch')
    ? [{ prdctIdntNo: '20153194', prdctClsfcNo: '30161509', krnPrdctNm: '석고보드' }, { prdctIdntNo: '26568521', prdctClsfcNo: '43211596', krnPrdctNm: '다른 분류 품목' }]
    : [{ prdctClsfcNo: '30161509', prdctClsfcNoNm: '석고보드', dtilPrdctClsfcNo: '3016150901', dtilPrdctClsfcNoNm: '석고보드' }] } } }) })
  await runCatalog(db, call, Date.now() + 5000)
  assert.deepEqual(saves.filter(x => x.kind.startsWith('class')).map(x => x.kind), ['class2', 'class4', 'class6', 'class8', 'class10'])
  const items = saves.filter(x => x.kind === 'items')
  assert.deepEqual(items[0], { kind: 'items', n: 1, state: { after: '30161509' }, done: false })
  assert.equal(items.at(-1)?.done, true)
})

test('catalog migration: members read only, nothing dropped, row cap in place', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261118190000_design_g2b_catalog.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /\bdrop\s/i)
  assert.match(sql, />= 300000/)
  const mall = readFileSync(new URL('../supabase/migrations/20261118223000_design_g2b_mall_prices.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(mall, /\bdrop\s/i)
  assert.match(mall, /when 'g2b_mall' then 'SM'/)
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*g2b_[a-z]+[^;]*authenticated/i)
})

test('catalog stops for the day once the portal says the daily limit is reached', async () => {
  const now = new Date().toISOString()
  assert.equal(limitedToday({ kind: 'items', state: {}, done_at: null, last_error: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', updated_at: now }), true)
  assert.equal(limitedToday({ kind: 'items', state: {}, done_at: null, last_error: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', updated_at: '2026-01-01T00:00:00Z' }), false)
  let calls = 0
  const db = { rpc: async (fn: string) => ({ data: fn === 'design_g2b_plan' ? [{ kind: 'items', state: { after: '30103103' }, done_at: null, last_error: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', updated_at: now }] : [], error: null }) }
  const r = await runCatalog(db, async () => { calls++; return { status: 200, text: '{}' } }, Date.now() + 2000)
  assert.equal(calls, 0)
  assert.deepEqual(r, [{ catalog: 'skipped', reason: 'daily limit' }])
})

test('a large class is saved page by page so the next run continues instead of starting over', async () => {
  const done = new Date().toISOString()
  const plan = [2, 4, 6, 8, 10].map(l => ({ kind: `class${l}`, state: {}, done_at: done, last_error: null, updated_at: done }))
  const states: Record<string, unknown>[] = []
  const db = { rpc: async (fn: string, a: Record<string, unknown> = {}) => {
    if (fn === 'design_g2b_plan') return { data: plan, error: null }
    if (fn === 'design_g2b_item_classes') return { data: ['30103201|스틸그레이팅'], error: null }
    states.push(a.p_state as Record<string, unknown>); return { data: 1, error: null }
  } }
  let n = 0
  const call = async () => { n++; return { status: 200, text: JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 50000, items: [{ prdctIdntNo: String(20000000 + n), prdctClsfcNo: '30103201', krnPrdctNm: '스틸그레이팅' }] } } }) } }
  await runCatalog(db, call, Date.now() + 60)
  assert.deepEqual(states[0], { after: '', cur: '30103201|스틸그레이팅', page: 4 })
})

test('contract price rows: only building materials and lighting with a price are kept', () => {
  const it = { prdctClsfcNo: '30161598', prdctClsfcNoNm: '흡음패널', prdctIdntNo: '24123456', prdctSpecNm: '흡음패널, 가나, GN-100, 600×1200×25mm', prdctUnit: '㎡', cntrctPrceAmt: '35,000', cntrctDate: '20261110', cntrctEndDate: '20291109', cntrctCorpNm: '가나', prdctLrgclsfcNm: '토목/건축/자재', prdctMidclsfcNm: '패널' }
  const r = mallRow(it)
  assert.ok(r)
  assert.equal(r.price, 35000)
  assert.equal(r.ref_key, '24123456||㎡')
  assert.equal(r.notice_date, '2026-11-10')
  assert.equal(r.raw.end, '2029-11-09')
  assert.equal(mallRow({ ...it, prdctClsfcNo: '43211596' }), null)
  assert.equal(mallRow({ ...it, cntrctPrceAmt: '' }), null)
  assert.ok(mallRow({ ...it, prdctClsfcNo: '39112102' }))
})

test('contract prices are fetched newest day first, then older days, one day at a time', async () => {
  const now = Date.parse('2026-11-18T13:00:00Z')
  assert.deepEqual(nextMallDay({}, now), { day: '20261117', page: 1, kind: 'front' })
  assert.equal(nextMallDay({ front: '20261117', back: '20261116' }, now)?.day, '20261116')
  assert.equal(nextMallDay({ front: '20261115', back: '20261101' }, now)?.day, '20261116')
  assert.deepEqual(nextMallDay({ front: '20261117', back: '20261116', day: '20261116', page: 3 }, now)?.page, 3)
  assert.equal(nextMallDay({ front: '20261117', back: '20241101' }, now), null)
  const states: Record<string, unknown>[] = []; let saved = 0
  const db = { rpc: async (fn: string, a: Record<string, unknown> = {}) => {
    if (fn === 'design_g2b_plan') return { data: [], error: null }
    if (fn === 'design_price_refs_save') { saved += (a.p_rows as unknown[]).length; return { data: 1, error: null } }
    states.push(a.p_state as Record<string, unknown>); return { data: 0, error: null }
  } }
  const call = async (_op: string, page: number) => ({ status: 200, text: JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 1500, items: [{ prdctClsfcNo: '30161598', prdctClsfcNoNm: '흡음패널', prdctIdntNo: String(24000000 + page), prdctUnit: '㎡', cntrctPrceAmt: '1000' }] } } }) })
  await runMall(db, call, Date.now() + 40)
  assert.equal(states[0].page, 2)
  assert.ok(String(states[1].front).length === 8 && !states[1].day)
  assert.ok(saved >= 2)
})
