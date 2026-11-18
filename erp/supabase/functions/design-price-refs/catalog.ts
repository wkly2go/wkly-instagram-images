// 나라장터 자재목록: 조달청 물품목록정보서비스 → design.g2b_classes(분류 전체) · design.g2b_items(건자재 등 품목)
// 테스트: tests/design-price-refs.test.ts
export type Item = Record<string, unknown>
type Db = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> }
type Call = (op: string, page: number, rows: number, extra?: Record<string, string>) => Promise<{ status: number; text: string }>
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const T = '../ThngListInfoService02/'
const DAY = 86400_000
const LEVELS = [2, 4, 6, 8, 10].map(level => ({ level, kind: `class${level}`, op: `getPrdctClsfcNoUnit${level}Info02` }))

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

/** 분류 → 품목 순서로 시간 안에서 받을 만큼 받는다. 남은 것은 다음 실행이 이어서. 다 받으면 30일 뒤 다시 */
export async function runCatalog(db: Db, call: Call, deadline: number, force = false) {
  const plan = (((await db.rpc('design_g2b_plan')).data ?? []) as { kind: string; state: { page?: number; after?: string }; done_at: string | null; last_error: string | null; updated_at: string }[])
  const report: Record<string, unknown>[] = []
  const fresh = (st?: { done_at: string | null }) => !force && !!st?.done_at && Date.now() - Date.parse(st.done_at) < 30 * DAY
  const keyBlocked = plan.some(p => p.last_error?.includes('SERVICE_KEY') && Date.now() - Date.parse(p.updated_at) < 3600_000)
  if (keyBlocked && !force) return [{ catalog: 'skipped', reason: 'key' }]
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
  if (fresh(st) && !st?.state?.after) return report
  let after = String(st?.state?.after ?? ''), saved = 0, classes = 0
  while (Date.now() < deadline) {
    const codes = ((await db.rpc('design_g2b_item_classes', { p_after: after, p_limit: 6 })).data ?? []) as string[]
    if (!codes.length) { await save('items', [], {}, true, null); report.push({ kind: 'items', done: true }); break }
    const results = await Promise.all(codes.map(async code => {
      const rows: NonNullable<ReturnType<typeof itemRow>>[] = []
      for (let pg = 1; pg <= 40; pg++) {
        const res = await call(T + 'getThngPrdnmLocplcAccotListInfoInfoPrdlstSearch02', pg, 500, { prdctClsfcNo: code }).catch(e => ({ status: 0, text: String(e) }))
        const p = parseList(res.text)
        if (p.err || res.status !== 200) return { code, rows, err: (p.err || `HTTP ${res.status}`).slice(0, 300) }
        for (const x of p.list) { const r = itemRow(x); if (r) rows.push(r) }
        if (pg * 500 >= p.total || p.list.length === 0) break
      }
      return { code, rows, err: '' }
    }))
    for (const r of results) {
      if (r.err) { await save('items', [], { after }, false, r.err); report.push({ kind: 'items', error: r.err, at: r.code, saved, classes }); return report }
      for (let i = 0; i < Math.max(r.rows.length, 1); i += 1000) {
        const last = i + 1000 >= r.rows.length
        const w = await save('items', r.rows.slice(i, i + 1000), { after: last ? r.code : after }, false, null)
        if (w.error) { report.push({ kind: 'items', error: w.error.message, at: r.code }); return report }
        if (Number(w.data) === -1) { report.push({ kind: 'items', capped: true, saved, classes }); return report }
      }
      after = r.code; saved += r.rows.length; classes++
    }
  }
  report.push({ kind: 'items', saved, classes, after })
  return report
}
