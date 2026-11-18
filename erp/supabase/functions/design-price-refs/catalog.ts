// 나라장터 자재목록: 조달청 물품목록정보서비스 → design.g2b_classes(분류 전체) · design.g2b_items(건자재 등 품목)
// 테스트: tests/design-price-refs.test.ts
export type Item = Record<string, unknown>
export type Db = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> }
export type Call = (op: string, page: number, rows: number, extra?: Record<string, string>) => Promise<{ status: number; text: string }>
export type SyncRow = { kind: string; state: Record<string, unknown>; done_at: string | null; last_error: string | null; updated_at: string }
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const T = '../ThngListInfoService02/'
const DAY = 86400_000
const LEVELS = [2, 4, 6, 8, 10].map(level => ({ level, kind: `class${level}`, op: `getPrdctClsfcNoUnit${level}Info02` }))
/** 분류 하나에서 받는 품목 쪽 수 한도 (500개씩 · 그레이팅처럼 규격마다 품목이 수만 개인 분류가 있다) */
const CLASS_PAGES = 20
const kstDay = (t: number | string) => new Date((typeof t === 'string' ? Date.parse(t) : t) + 9 * 3600_000).toISOString().slice(0, 10)
/** 공공데이터포털 하루 호출 한도에 걸린 날은 더 부르지 않는다 (자정에 풀림) */
export const limitedToday = (st?: SyncRow) => !!st?.last_error?.includes('LIMITED_NUMBER') && kstDay(st.updated_at) === kstDay(Date.now())

/** 물품 분류 한 줄 (10단위는 세부품명 칸을 쓴다) */
export function classRow(it: Item, level: number) {
  const ten = level === 10
  const code = s(ten ? it.dtilPrdctClsfcNo : it.prdctClsfcNo), name = s(ten ? it.dtilPrdctClsfcNoNm : it.prdctClsfcNoNm)
  if (!/^\d{2,10}$/.test(code) || !name) return null
  return { code, name, name_en: s(ten ? it.dtilPrdctClsfcNoEngNm : it.prdctClsfcNoEngNm).slice(0, 200), level, use_yn: s(it.useYn) !== 'N' }
}
/** 품목(물품식별번호) 한 줄 — 지웠거나 안 쓰는 품목은 뺀다 */
export function itemRow(it: Item) {
  const ident_no = s(it.prdctIdntNo), name = s(it.krnPrdctNm), class_no = s(it.prdctClsfcNo)
  if (!/^\d{6,12}$/.test(ident_no) || !/^\d{8}$/.test(class_no) || !name || s(it.dltYn) === 'Y' || s(it.useYn) === 'N') return null
  return { ident_no, class_no, dtil_class_no: s(it.dtilPrdctClsfcNo), name: name.slice(0, 400), maker: s(it.mnfctCorpNm).slice(0, 120), kind: s(it.prdlstDiv).slice(0, 20), chg_date: s(it.chgDt).slice(0, 10) }
}
export function parseList(text: string): { err: string; list: Item[]; total: number } {
  try {
    const j = JSON.parse(text)
    const head = j?.response?.header
    const err = j?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? j?.['nkoneps.com.response.ResponseError']?.header?.resultMsg ?? (head?.resultCode && head.resultCode !== '00' ? `${head.resultCode} ${head.resultMsg ?? ''}` : '')
    const it = j?.response?.body?.items
    const list = (Array.isArray(it) ? it : Array.isArray(it?.item) ? it.item : it?.item ? [it.item] : []) as Item[]
    return { err: String(err ?? ''), list, total: Number(j?.response?.body?.totalCount ?? 0) }
  } catch { return { err: text.match(/<errMsg>([^<]+)/)?.[1] ?? '응답을 읽지 못했습니다', list: [], total: 0 } }
}

/** 분류 → 품목 순서로 시간 안에서 받을 만큼 받는다. 쪽마다 어디까지 받았는지 적어 두고 다음 실행이 이어서. 다 받으면 30일 뒤 다시 */
export async function runCatalog(db: Db, call: Call, deadline: number, force = false) {
  const plan = ((await db.rpc('design_g2b_plan')).data ?? []) as SyncRow[]
  const report: Record<string, unknown>[] = []
  const fresh = (st?: SyncRow) => !force && !!st?.done_at && Date.now() - Date.parse(st.done_at) < 30 * DAY
  const cat = plan.filter(p => p.kind !== 'mall')
  if (!force && cat.some(p => p.last_error?.includes('SERVICE_KEY') && Date.now() - Date.parse(p.updated_at) < 3600_000)) return [{ catalog: 'skipped', reason: 'key' }]
  if (!force && cat.some(p => limitedToday(p))) return [{ catalog: 'skipped', reason: 'daily limit' }]
  const save = (kind: string, rows: unknown[], state: Record<string, unknown>, done: boolean, error: string | null) => db.rpc('design_g2b_save', { p_kind: kind, p_rows: rows, p_state: state, p_done: done, p_error: error })
  for (const lv of LEVELS) {
    const st = plan.find(p => p.kind === lv.kind)
    if (fresh(st) && !st?.state?.page) continue
    let page = Number(st?.state?.page ?? 1), saved = 0
    while (Date.now() < deadline) {
      const res = await call(T + lv.op, page, 500).catch(e => ({ status: 0, text: String(e) }))
      const p = parseList(res.text)
      if (p.err || res.status !== 200) { await save(lv.kind, [], { page }, false, (p.err || `HTTP ${res.status}`).slice(0, 300)); report.push({ kind: lv.kind, error: p.err || res.status }); return report }
      const rows = p.list.map(x => classRow(x, lv.level)).filter(Boolean)
      const done = page * 500 >= p.total || p.list.length === 0
      const r = await save(lv.kind, rows, done ? {} : { page: page + 1 }, done, null)
      if (r.error) { report.push({ kind: lv.kind, error: r.error.message }); return report }
      saved += rows.length
      if (done) break
      page++
    }
    report.push({ kind: lv.kind, saved, page })
    if (Date.now() >= deadline) return report
  }
  const st = plan.find(p => p.kind === 'items')
  if (fresh(st) && !st?.state?.after && !st?.state?.cur) return report
  // 분류는 '번호|이름' — 이 서비스는 분류 번호로는 거르지 못하고 품명(prdctClsfcNoNm)으로만 거른다
  let after = s(st?.state?.after), cur = s(st?.state?.cur), page = Number(st?.state?.page ?? 1), saved = 0, classes = 0
  while (Date.now() < deadline) {
    if (!cur) {
      const next = ((await db.rpc('design_g2b_item_classes', { p_after: after, p_limit: 1 })).data ?? []) as string[]
      if (!next.length) { await save('items', [], {}, true, null); report.push({ kind: 'items', done: true }); break }
      cur = next[0]; page = 1
    }
    const code = cur.split('|')[0], name = cur.split('|').slice(1).join('|')
    const pages = await Promise.all([0, 1, 2].map(i => call(T + 'getThngPrdnmLocplcAccotListInfoInfoPrdlstSearch02', page + i, 500, { prdctClsfcNoNm: name }).catch(e => ({ status: 0, text: String(e) }))))
    const rows: NonNullable<ReturnType<typeof itemRow>>[] = []
    let finished = false, err = ''
    for (let i = 0; i < pages.length; i++) {
      const p = parseList(pages[i].text)
      if (p.err || pages[i].status !== 200) { err = (p.err || `HTTP ${pages[i].status}`).slice(0, 300); break }
      for (const x of p.list) { const r = itemRow(x); if (r && r.class_no === code) rows.push(r) }
      if ((page + i) * 500 >= p.total || p.list.length === 0 || page + i >= CLASS_PAGES) { finished = true; break }
    }
    if (err) { await save('items', [], { after, cur, page }, false, err); report.push({ kind: 'items', error: err, at: code, saved, classes }); return report }
    const w = await save('items', rows.slice(0, 2000), finished ? { after: code } : { after, cur, page: page + 3 }, false, null)
    if (w.error) { report.push({ kind: 'items', error: w.error.message, at: code }); return report }
    if (Number(w.data) === -1) { report.push({ kind: 'items', capped: true, saved, classes }); return report }
    saved += rows.length
    if (finished) { after = code; cur = ''; page = 1; classes++ } else page += 3
  }
  report.push({ kind: 'items', saved, classes, after })
  return report
}
