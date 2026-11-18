import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toRow } from '../supabase/functions/design-price-refs/row.ts'

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
