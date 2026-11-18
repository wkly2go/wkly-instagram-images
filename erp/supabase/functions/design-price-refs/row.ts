// 조달청 가격정보 응답 한 줄 → design.price_refs 한 줄 (테스트: tests/design-price-refs.test.ts)
export type Item = Record<string, unknown>
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const n = (v: unknown) => { const t = s(v).replace(/,/g, ''); if (!t) return null; const x = Number(t); return Number.isFinite(x) && x >= 0 ? x : null }
const day = (v: unknown) => { const d = s(v).replace(/[^0-9]/g, '').slice(0, 8); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : '' }

/** 조달청 응답 한 줄 → price_refs 한 줄 (자재 · 시장시공가격 모두) */
export function toRow(it: Item) {
  const item = s(it.prdctClsfcNoNm) || s(it.prdnm) || s(it.rsceNm)
  const spec = s(it.krnPrdctNm) || s(it.spec) || s(it.rsceSpecNm)
  const material = n(it.mtrlcstUprc) ?? n(it.mtrlcst)
  const labor = n(it.lbrcstUprc) ?? n(it.lbrcst)
  const expense = n(it.gnrexpnsUprc) ?? n(it.gnrlexpns)
  const parts = [material, labor, expense].filter((x): x is number => x !== null)
  const price = n(it.prce) ?? (parts.length ? parts.reduce((a, b) => a + b, 0) : null)
  const region = s(it.splyJrsdctRgnNm)
  // 시장시공가격은 식별번호가 비거나 '0' 이다 — 그대로 쓰면 단위가 같은 줄끼리 덮어쓰므로 품명 · 규격으로 구분한다
  const real = (v: unknown) => { const t = s(v); return /^0*$/.test(t) ? '' : t }
  const id = real(it.prdctIdntNo) || real(it.qtyCalcCtyclcd) || real(it.netRsceCd) || `${item}|${spec}`
  if (!item || price === null) return null
  return {
    ref_key: [id, region, s(it.unit)].join('|').slice(0, 300),
    category: s(it.bsnsDivNm) || s(it.cnstwkDivNm) || s(it.cnstwkDivCdNm) || s(it.prdctMngDivNm),
    item, spec, unit: s(it.unit), price, material, labor, expense, region,
    notice_date: day(it.nticeDt) || day(it.pblctDate),
    raw: { no: s(it.prceNticeNo), clsfc: s(it.prdctClsfcNo), dept: s(it.invstDeptNm), vat: s(it.vatYnNm), cond: s(it.uprcAplCndtnCntnts).slice(0, 300) },
  }
}
