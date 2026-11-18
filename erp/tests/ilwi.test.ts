import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fromMarketRef, ilwiTotals, laborLine, materialLine, nextIlwiCode } from '../src/lib/ilwi.ts'

test('totals: material + labor + expense, a percent expense is a share of labor', () => {
  const t = ilwiTotals([
    { kind: 'material', qty: 1.05, price: 4183, pct: null },
    { kind: 'labor', qty: 0.04, price: 258904, pct: null },
    { kind: 'labor', qty: 0.01, price: 172698, pct: null },
    { kind: 'expense', qty: 0, price: null, pct: 3 },
    { kind: 'expense', qty: 1, price: 500, pct: null },
  ])
  assert.equal(t.material, 4392)
  assert.equal(t.labor, 10356 + 1727)
  assert.equal(t.expense, 500 + Math.round(0.03 * (10356 + 1727)))
  assert.equal(t.total, t.material + t.labor + t.expense)
  assert.equal(t.missing, 0)
})

test('a line without a price is counted as missing, not as zero cost silently', () => {
  assert.equal(ilwiTotals([{ kind: 'material', qty: 2, price: null, pct: null }]).missing, 1)
})

test('codes continue from the highest number', () => {
  assert.equal(nextIlwiCode([]), 'IW-001')
  assert.equal(nextIlwiCode(['IW-001', 'IW-014', 'X-99']), 'IW-015')
})

test('material and labor lines keep a reference instead of a frozen price', () => {
  const ref = { id: 1, source_name: '조달청 시설자재(건축)', category: '', item: '석고보드', spec: '평보드 12.5T', unit: '㎡', price: 4183, material: null, labor: null, expense: null, region: '', notice_date: '2026-10-01', code: 'BM077-010' }
  assert.deepEqual(materialLine('i1', ref, 1.05), { item_id: 'i1', kind: 'material', ref_code: 'BM077-010', name: '석고보드', spec: '평보드 12.5T', unit: '㎡', qty: 1.05, unit_price: null, pct: null })
  assert.equal(laborLine('i1', { code: '1030', name: '내장공', wage: 258904, as_of: '2026-09-01', low_sample: false, source: '' }, 0.04).ref_code, '1030')
})

test('a market construction price becomes an item with its material, labor and expense parts', () => {
  const r = fromMarketRef({ id: 2, source_name: '조달청 시장시공가격(건축)', category: '', item: '경량철골천장틀', spec: 'TH-BAR(AL)', unit: 'M2', price: 28511, material: 17016, labor: 11495, expense: 0, region: '', notice_date: '2026-10-01', code: 'BC012-005' }, 'IW-001')
  assert.equal(r.item.basis, '조달청 시장시공가격(건축) BC012-005 · 2026-10-01')
  assert.deepEqual(r.lines.map(l => [l.kind, l.unit_price]), [['material', 17016], ['labor', 11495]])
})

test('migration: separate tables, admin-only writes, nothing dropped', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261118233000_design_ilwi.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /\bdrop\s/i)
  assert.match(sql, /for all to authenticated using \(\(select public\.is_admin\(\)\)\)/)
  assert.doesNotMatch(sql, /unit_prices|estimate/)
})
