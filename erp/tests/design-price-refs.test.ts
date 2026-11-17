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
