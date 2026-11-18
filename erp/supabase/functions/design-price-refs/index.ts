// 물가 기준 단가 학습 (2026-11-17 대표 지시 '설계에서 단가정보는 물가 정보지를 학습해')
// 조달청 나라장터 가격정보현황서비스(무료 공공데이터)의 시설공통자재 · 시장시공가격을 design.price_refs 에 쌓는다.
// - 인증키는 Edge Function 비밀값 DATA_GO_KR_SERVICE_KEY (g2b-vendors 와 같은 키) · 저장소 · DB · 응답에 남기지 않는다.
//   이 키로 '조달청_나라장터 가격정보현황서비스'(data.go.kr 15129415) 활용신청이 되어 있어야 한다.
// - 호출은 DB 안 private.design_run_price_refs() 만: 1회용 토큰(x-run-token)을 design_run_token_use 로 확인.
// - 한 번에 약 100초까지 쪽을 받고, 남은 쪽은 다음 실행(15분마다)이 이어서. 다 받으면 30일 뒤 다시 받음.
// - 우리 판매 단가(design.unit_prices)는 바꾸지 않는다. 화면이 옆에 '물가 기준'으로 보여 준다.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { toRow, type Item } from './row.ts'

const BASE = 'https://apis.data.go.kr/1230000/ao/PriceInfoService/'
const SOURCES = [
  { source: 'pps_mtril_bildng', name: '조달청 시설자재(건축)', op: 'getPriceInfoListFcltyCmmnMtrilBildng' },
  { source: 'pps_mrkt_bildng', name: '조달청 시장시공가격(건축)', op: 'getPriceInfoListMrktCnstrctPcBildng' },
  { source: 'pps_mtril_elcty', name: '조달청 시설자재(전기·통신)', op: 'getPriceInfoListFcltyCmmnMtrilElctyIrmc' },
  { source: 'pps_mrkt_mchn', name: '조달청 시장시공가격(기계설비)', op: 'getPriceInfoListMrktCnstrctPcMchnEqp' },
  // 2026-11-18 대표 지시 '모든 물가정보를 인트라넷에 저장': 가격정보현황서비스의 나머지 세 묶음
  { source: 'pps_mtril_mchn', name: '조달청 시설자재(기계설비)', op: 'getPriceInfoListFcltyCmmnMtrilMchnEqp' },
  { source: 'pps_mtril_engrk', name: '조달청 시설자재(토목)', op: 'getPriceInfoListFcltyCmmnMtrilEngrk' },
  { source: 'pps_mrkt_engrk', name: '조달청 시장시공가격(토목)', op: 'getPriceInfoListMrktCnstrctPcEngrk' },
]
const ROWS = 500
const BUDGET_MS = 100_000
const REFRESH_DAYS = 30
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST만 됩니다' }, 405)
  const started = Date.now()
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = req.headers.get('x-run-token') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: '권한 없음' }, 401)
  const used = await db.rpc('design_run_token_use', { p_token: token })
  if (used.error || used.data !== true) return json({ error: '권한 없음' }, 401)
  const key = Deno.env.get('DATA_GO_KR_SERVICE_KEY')?.trim()
  if (!key) return json({ error: 'DATA_GO_KR_SERVICE_KEY 비밀값이 없습니다' }, 503)
  const body = (await req.json().catch(() => ({}))) as { mode?: string; ops?: string[]; params?: Record<string, string>; force?: boolean }
  const call = async (op: string, page: number, rows: number, extra: Record<string, string> = {}) => {
    const u = new URL(BASE + op)
    u.search = new URLSearchParams({ serviceKey: key, type: 'json', pageNo: String(page), numOfRows: String(rows), ...extra }).toString()
    const r = await fetch(u, { signal: AbortSignal.timeout(30_000) })
    const text = await r.text()
    return { status: r.status, text }
  }
  if (body.mode === 'probe') {
    const out = []
    for (const op of (body.ops ?? SOURCES.map(x => x.op)).slice(0, 12)) {
      const r = await call(op, 1, 3, body.params).catch(e => ({ status: 0, text: String(e) }))
      out.push({ op, status: r.status, text: r.text.slice(0, 1500) })
    }
    return json({ out })
  }
  if (body.mode !== 'sync') return json({ error: 'mode 를 확인해 주세요' }, 400)

  const plan = ((await db.rpc('design_price_refs_plan')).data ?? []) as { source: string; next_page: number; total: number | null; done_at: string | null; last_error: string | null; updated_at: string }[]
  const report: Record<string, unknown>[] = []
  for (const src of SOURCES) {
    const st = plan.find(p => p.source === src.source)
    if (!body.force && st?.done_at && Date.now() - Date.parse(st.done_at) < REFRESH_DAYS * 86400_000 && st.next_page === 1) continue
    // 키가 이 서비스에 등록되지 않았으면 1시간에 한 번만 다시 확인
    if (!body.force && st?.last_error?.includes('SERVICE_KEY') && Date.now() - Date.parse(st.updated_at) < 3600_000) { report.push({ source: src.source, skipped: 'key' }); continue }
    let page = st?.next_page ?? 1
    let saved = 0
    while (Date.now() - started < BUDGET_MS) {
      let res: { status: number; text: string }
      try { res = await call(src.op, page, ROWS) } catch (e) { await db.rpc('design_price_refs_save', { p_source: src.source, p_name: src.name, p_rows: [], p_next_page: page, p_total: null, p_done: false, p_error: `요청 실패: ${String(e).slice(0, 200)}` }); break }
      let data: { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: unknown; totalCount?: number } }; OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: string } } } = {}
      try { data = JSON.parse(res.text) } catch { /* XML error body */ }
      const err = data.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? (res.text.match(/<errMsg>([^<]+)/)?.[1]) ?? (data.response?.header?.resultCode && data.response.header.resultCode !== '00' ? `${data.response.header.resultCode} ${data.response.header.resultMsg ?? ''}` : '')
      if (err || res.status >= 400) {
        await db.rpc('design_price_refs_save', { p_source: src.source, p_name: src.name, p_rows: [], p_next_page: page, p_total: null, p_done: false, p_error: (err || `HTTP ${res.status}`).slice(0, 300) })
        report.push({ source: src.source, error: err || res.status })
        break
      }
      const raw = data.response?.body?.items as unknown
      const list: Item[] = Array.isArray(raw) ? raw as Item[] : Array.isArray((raw as { item?: unknown })?.item) ? (raw as { item: Item[] }).item : (raw as { item?: Item })?.item ? [(raw as { item: Item }).item] : []
      const total = Number(data.response?.body?.totalCount ?? 0)
      const rows = list.map(toRow).filter(Boolean)
      const done = page * ROWS >= total || list.length === 0
      const r = await db.rpc('design_price_refs_save', { p_source: src.source, p_name: src.name, p_rows: rows, p_next_page: page + 1, p_total: total, p_done: done, p_error: null })
      if (r.error) { report.push({ source: src.source, error: r.error.message }); break }
      saved += Number(r.data ?? 0)
      if (done) break
      page++
    }
    report.push({ source: src.source, saved, page })
    if (Date.now() - started >= BUDGET_MS) break
  }
  return json({ ok: true, report, ms: Date.now() - started })
})
