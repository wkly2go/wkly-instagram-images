// 나라장터 쇼핑몰 계약 단가: 조달청 쇼핑몰 품목정보(품목 등록 내역) → design.price_refs (source 'g2b_mall' · 기호 SM)
// 이 서비스는 등록일 기간으로만 넓게 받을 수 있어(하루 6~7천 건) 하루씩 훑고, 건자재(30 · 마감자재 포함)와 조명(3911)만 남긴다.
// 테스트: tests/design-price-refs.test.ts
import { limitedToday, parseList, type Call, type Db, type Item, type SyncRow } from './catalog.ts'
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const OP = '../../at/ShoppingMallPrdctInfoService/getShoppingMallPrdctInfoList'
export const MALL_SOURCE = 'g2b_mall'
export const MALL_NAME = '나라장터 쇼핑몰 계약 단가'
/** 남길 물품 분류: 건자재 전체(외장 · 내장 마감재 포함) · 조명 */
export const MALL_KEEP = /^(30|3911)/
/** 지난 등록분은 2년 치까지 */
const BACK_DAYS = 730
const ymd = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '')
const shift = (d: string, n: number) => ymd(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + n) - 9 * 3600_000)
const iso = (d: string) => (/^\d{8}/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '')

/** 쇼핑몰 품목 한 줄 → price_refs 한 줄. 등록 취소 · 가격 없는 줄 · 대상 아닌 분류는 뺀다 */
export function mallRow(it: Item) {
  const clsfc = s(it.prdctClsfcNo), id = s(it.prdctIdntNo), item = s(it.prdctClsfcNoNm), unit = s(it.prdctUnit)
  const price = Number(s(it.cntrctPrceAmt).replace(/,/g, ''))
  if (!MALL_KEEP.test(clsfc) || !/^\d{6,12}$/.test(id) || !item || !(price > 0) || s(it.regtCncelYn) === 'Y') return null
  return {
    ref_key: `${id}||${unit}`.slice(0, 300),
    category: [s(it.prdctLrgclsfcNm), s(it.prdctMidclsfcNm)].filter(Boolean).join(' > ').slice(0, 200),
    item, spec: s(it.prdctSpecNm).slice(0, 500), unit, price, material: null, labor: null, expense: null, region: '',
    notice_date: iso(s(it.cntrctDate).replace(/\D/g, '')) || iso(s(it.rgstDt).replace(/\D/g, '')),
    raw: { clsfc, corp: s(it.cntrctCorpNm).slice(0, 80), maker: s(it.prdctMakrNm).slice(0, 80), end: iso(s(it.cntrctEndDate).replace(/\D/g, '')), cert: s(it.prodctCertList).slice(0, 200), no: s(it.shopngCntrctNo), mas: s(it.masYn) },
  }
}

/** 받을 날 고르기: 받던 날 → 어제까지 새로 등록된 날 → 지난 날(2년 전까지) */
export function nextMallDay(state: Record<string, unknown>, now: number): { day: string; page: number; kind: 'resume' | 'front' | 'back' } | null {
  const yesterday = shift(ymd(now), -1), front = s(state.front), back = s(state.back)
  if (s(state.day)) return { day: s(state.day), page: Number(state.page ?? 1), kind: s(state.day) > front && front ? 'front' : !front ? 'front' : 'back' }
  if (!front) return { day: yesterday, page: 1, kind: 'front' }
  if (front < yesterday) return { day: shift(front, 1), page: 1, kind: 'front' }
  const b = back || shift(front, -1)
  return b >= shift(yesterday, -BACK_DAYS) ? { day: b, page: 1, kind: 'back' } : null
}

export async function runMall(db: Db, call: Call, deadline: number, force = false) {
  const st = (((await db.rpc('design_g2b_plan')).data ?? []) as SyncRow[]).find(p => p.kind === 'mall')
  if (!force && limitedToday(st)) return [{ mall: 'skipped', reason: 'daily limit' }]
  if (!force && st?.last_error?.includes('SERVICE_KEY') && Date.now() - Date.parse(st.updated_at) < 3600_000) return [{ mall: 'skipped', reason: 'key' }]
  let state = { ...(st?.state ?? {}) } as Record<string, unknown>
  const keep = (next: Record<string, unknown>, done: boolean, error: string | null) => db.rpc('design_g2b_save', { p_kind: 'mall', p_rows: [], p_state: next, p_done: done, p_error: error })
  let saved = 0, days = 0
  while (Date.now() < deadline) {
    const pick = nextMallDay(state, Date.now())
    if (!pick) { await keep(state, true, null); return [{ mall: 'up to date', saved, days }] }
    const res = await call(OP, pick.page, 999, { inqryDiv: '1', inqryBgnDate: pick.day, inqryEndDate: pick.day }).catch(e => ({ status: 0, text: String(e) }))
    const p = parseList(res.text)
    if (p.err || res.status !== 200) { await keep({ ...state, day: pick.day, page: pick.page }, false, (p.err || `HTTP ${res.status}`).slice(0, 300)); return [{ mall: 'error', error: p.err || res.status, day: pick.day, saved, days }] }
    const rows = p.list.map(mallRow).filter(Boolean)
    if (rows.length) {
      const w = await db.rpc('design_price_refs_save', { p_source: MALL_SOURCE, p_name: MALL_NAME, p_rows: rows, p_next_page: 1, p_total: null, p_done: false, p_error: null })
      if (w.error) { await keep({ ...state, day: pick.day, page: pick.page }, false, w.error.message.slice(0, 300)); return [{ mall: 'error', error: w.error.message, day: pick.day }] }
      saved += rows.length
    }
    const last = pick.page * 999 >= p.total || p.list.length === 0
    if (last) {
      const front = s(state.front), back = s(state.back)
      state = { front: !front || pick.day > front ? pick.day : front, back: !front ? shift(pick.day, -1) : pick.day > front ? back || shift(front, -1) : shift(pick.day, -1) }
      days++
    } else state = { ...state, day: pick.day, page: pick.page + 1 }
    const k = await keep(state, false, null)
    if (k.error) return [{ mall: 'error', error: k.error.message }]
  }
  return [{ mall: 'running', saved, days, state }]
}
