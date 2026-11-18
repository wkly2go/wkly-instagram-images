import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toRow } from '../supabase/functions/design-price-refs/row.ts'
import { classRow, itemRow, parseList, runCatalog } from '../supabase/functions/design-price-refs/catalog.ts'

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
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*g2b_[a-z]+[^;]*authenticated/i)
})
