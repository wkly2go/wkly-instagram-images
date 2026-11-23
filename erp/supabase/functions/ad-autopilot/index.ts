// 광고 자동 운영 서버 함수 (2026-11-20 · DB 20261120210000_ad_autopilot)
//  - 예약(x-sync-key = 금고 GDRIVE_SYNC_KEY): tick — 메타 수치 받기 → 규칙 판단 → (자동 모드면) 실행 → 대표에게 정리 알림
//  - 관리자(로그인): run(지금 받기 · 판단 · 알림 없음) · decide(제안 승인 → 실행 / 거절) · check(열쇠 · 계정 확인만)
//  - 규칙은 rules.ts (AI 없음 · 시험 tests/ad-autopilot.test.ts). 메타 쓰기는 캠페인 · 소재 '멈춤'과 캠페인 '하루 예산 변경'뿐.
//  - 실행 직전에 메타의 지금 예산 · 상태를 다시 읽어 제안 때와 다르면 실행하지 않음(다른 사람이 바꾼 것을 덮지 않음).
//  - 4단계: 네이버 검색광고(naver.ts) — 같은 규칙 · 한도(두 매체 합계) · 모드 · 기록. 네이버 쓰기는 캠페인 멈춤(userLock) · 하루 예산뿐.
//  - 2단계: 소재(광고) 피로 멈춤(마지막 소재는 안 멈춤) · 실행 7일 뒤 효과 확인(effect) → 화면 '규칙 성적표'.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'
import { canExecute, evaluate, fatigue, judge, KIND_LABEL, leadsOf, type AdDay, type AutopilotSettings, type InsightDay, type MetaAd, type MetaCampaign, type Proposal } from './rules.ts'
import { naverCampaign, naverClient, naverDays, NaverError } from './naver.ts'
import { buildMetaSpec, launchProblem, metaProblems, type CampaignDoc } from './metaCreate.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const GRAPH = 'https://graph.facebook.com/v21.0'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class Fail extends Error { constructor(msg: string, public status = 400) { super(msg) } }

type Settings = AutopilotSettings & { meta_account_id: string | null; naver_customer_id: string | null }
type Platform = 'meta' | 'naver'
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const addDays = (key: string, n: number) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

async function settings(): Promise<Settings> {
  const { data, error } = await sb.from('ad_autopilot_settings').select('*').eq('id', 1).single()
  if (error || !data) throw new Fail('자동 운영 설정을 읽지 못했습니다.', 500)
  return data as Settings
}
async function token(): Promise<string> {
  const { data } = await sb.rpc('ad_meta_token_get')
  if (typeof data !== 'string' || !data) throw new Fail('메타 광고 열쇠가 아직 없습니다. 광고·콘텐츠 › 광고 운영팀 › 자동 운영에서 넣어 주세요.', 409)
  return data
}

async function naverKeys(): Promise<{ key: string; secret: string } | null> {
  const { data } = await sb.rpc('ad_naver_keys_get')
  const d = data as { key?: string | null; secret?: string | null } | null
  return d?.key && d?.secret ? { key: d.key, secret: d.secret } : null
}
async function naver(s: Settings) {
  const k = await naverKeys()
  if (!k || !s.naver_customer_id) throw new Fail('네이버 검색광고 열쇠 · 고객 번호가 아직 없습니다.', 409)
  return naverClient(k.key, k.secret, s.naver_customer_id)
}

/** 네이버 받기: 캠페인 · 지난 14일 일별 수치 · 이번 달 비용 → ad_naver_campaigns · ad_daily(Naver) */
async function syncNaver(s: Settings, today: string) {
  const nv = await naver(s)
  const raw = await nv.campaigns()
  const campaigns = (raw ?? []).map(naverCampaign)
  if (raw?.length) {
    const up = await sb.from('ad_naver_campaigns').upsert(raw.map(c => ({ id: c.nccCampaignId, name: c.name.slice(0, 300), status: c.status ?? '', user_lock: !!c.userLock, daily_budget: c.dailyBudget ? Math.round(c.dailyBudget) : null, use_daily_budget: !!c.useDailyBudget, campaign_type: c.campaignTp ?? null, synced_at: new Date().toISOString() })))
    if (up.error) throw new Fail(`네이버 캠페인 저장 실패: ${up.error.message}`, 500)
  }
  const ids = campaigns.map(c => c.id)
  const names = new Map(campaigns.map(c => [c.id, c.name]))
  const days = ids.length ? naverDays(await nv.stats(ids, addDays(today, -14), addDays(today, -1)), names) : []
  const rows = new Map<string, { date: string; platform: string; campaign: string; impressions: number; clicks: number; cost: number; conversions: number; note: string; updated_at: string }>()
  for (const d of days) {
    const k = `${d.date}|${d.campaign_name}`
    const x = rows.get(k) ?? { date: d.date, platform: 'Naver', campaign: d.campaign_name.slice(0, 300), impressions: 0, clicks: 0, cost: 0, conversions: 0, note: `naver:${d.campaign_id} · 자동 받기`, updated_at: new Date().toISOString() }
    x.impressions += d.impressions; x.clicks += d.clicks; x.cost += d.spend; x.conversions += d.leads
    rows.set(k, x)
  }
  if (rows.size) {
    const up = await sb.from('ad_daily').upsert([...rows.values()], { onConflict: 'date,platform,campaign' })
    if (up.error) throw new Fail(`네이버 수치 저장 실패: ${up.error.message}`, 500)
  }
  const mtd = ids.length ? await nv.spend(ids, `${today.slice(0, 8)}01`, today) : 0
  return { campaigns, days, mtd, saved: rows.size }
}

/** 메타 그래프 API (읽기 GET · 쓰기 POST) — 오류는 메타가 준 문장 그대로 */
async function meta<T>(tk: string, path: string, params: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const qs = new URLSearchParams(params)
  const url = path.startsWith('http') ? path : `${GRAPH}/${path}`
  const r = method === 'GET'
    ? await fetch(`${url}${url.includes('?') ? '&' : '?'}${qs}`, { headers: { Authorization: `Bearer ${tk}` } })
    : await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs })
  const j = await r.json().catch(() => ({})) as { error?: { message?: string; code?: number } }
  if (!r.ok || j.error) {
    const m = j.error?.message ?? `HTTP ${r.status}`
    if (j.error?.code === 190) throw new Fail(`메타 열쇠가 만료됐거나 맞지 않습니다: ${m}`, 401)
    if (j.error?.code === 17 || j.error?.code === 4 || r.status === 429) throw new Fail(`메타 요청 한도에 걸렸습니다. 잠시 뒤 다시 해 주세요: ${m}`, 429)
    throw new Fail(`메타 응답 오류: ${m}`, 502)
  }
  return j as T
}
/** 쪽 넘김을 따라 모두 받기 (최대 10쪽) */
async function metaAll<T>(tk: string, path: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = []
  let page = await meta<{ data?: T[]; paging?: { next?: string } }>(tk, path, params)
  for (let i = 0; i < 10; i++) {
    out.push(...(page.data ?? []))
    if (!page.paging?.next) break
    page = await meta(tk, page.paging.next)
  }
  return out
}

interface RawCampaign { id: string; name: string; status: string; effective_status?: string; objective?: string; daily_budget?: string; lifetime_budget?: string }
interface RawInsight { date_start: string; campaign_id: string; campaign_name: string; impressions?: string; clicks?: string; spend?: string; actions?: { action_type?: string; value?: string }[] }
interface RawAd { id: string; name: string; campaign_id: string; status: string; effective_status?: string; creative?: { thumbnail_url?: string } }
interface RawAdInsight { date_start: string; ad_id: string; impressions?: string; clicks?: string; spend?: string; frequency?: string; actions?: { action_type?: string; value?: string }[] }
const intOrNull = (v: string | undefined) => (v == null || v === '' ? null : Math.round(Number(v)))

/** 받기: 캠페인 목록 · 지난 14일 일별 수치(어제까지) · 이번 달 광고비 → ad_meta_campaigns · ad_daily(Meta) */
async function sync(tk: string, acct: string, today: string) {
  const raw = await metaAll<RawCampaign>(tk, `act_${acct}/campaigns`, { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget', limit: '200' })
  const campaigns: MetaCampaign[] = raw.map(c => ({ id: c.id, name: c.name, status: c.status, daily_budget: intOrNull(c.daily_budget) }))
  if (raw.length) {
    const up = await sb.from('ad_meta_campaigns').upsert(raw.map(c => ({ id: c.id, name: c.name.slice(0, 300), status: c.status, effective_status: c.effective_status ?? null, objective: c.objective ?? null, daily_budget: intOrNull(c.daily_budget), lifetime_budget: intOrNull(c.lifetime_budget), synced_at: new Date().toISOString() })))
    if (up.error) throw new Fail(`캠페인 저장 실패: ${up.error.message}`, 500)
  }
  const since = addDays(today, -14), until = addDays(today, -1)
  const ins = await metaAll<RawInsight>(tk, `act_${acct}/insights`, {
    level: 'campaign', time_increment: '1', limit: '500',
    time_range: JSON.stringify({ since, until }),
    fields: 'campaign_id,campaign_name,impressions,clicks,spend,actions',
  })
  const days: InsightDay[] = ins.map(r => ({
    date: r.date_start, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
    impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend: Math.round(Number(r.spend ?? 0)), leads: leadsOf(r.actions),
  }))
  // ad_daily 는 (날짜 · 매체 · 캠페인 이름) 이 열쇠 — 같은 이름 캠페인이 둘이면 합침
  const rows = new Map<string, { date: string; platform: string; campaign: string; impressions: number; clicks: number; cost: number; conversions: number; note: string; updated_at: string }>()
  for (const d of days) {
    const k = `${d.date}|${d.campaign_name}`
    const x = rows.get(k) ?? { date: d.date, platform: 'Meta', campaign: d.campaign_name.slice(0, 300), impressions: 0, clicks: 0, cost: 0, conversions: 0, note: `meta:${d.campaign_id} · 자동 받기`, updated_at: new Date().toISOString() }
    x.impressions += d.impressions; x.clicks += d.clicks; x.cost += d.spend; x.conversions += d.leads
    rows.set(k, x)
  }
  if (rows.size) {
    const up = await sb.from('ad_daily').upsert([...rows.values()], { onConflict: 'date,platform,campaign' })
    if (up.error) throw new Fail(`수치 저장 실패: ${up.error.message}`, 500)
  }
  // 이번 달 쓴 돈 (오늘 포함 · 메타 기준)
  const month = await meta<{ data?: { spend?: string }[] }>(tk, `act_${acct}/insights`, { fields: 'spend', date_preset: 'this_month' })
  const mtd = Math.round(Number(month.data?.[0]?.spend ?? 0))
  // 소재(광고) 목록 · 일별 수치 · 지난 7일 빈도 (소재 피로 판단용 · 실패해도 캠페인 판단은 이어감)
  let ads: MetaAd[] = [], adDays: AdDay[] = [], freq: Record<string, number> = {}, adError: string | null = null
  try {
    const rawAds = await metaAll<RawAd>(tk, `act_${acct}/ads`, { fields: 'id,name,campaign_id,status,effective_status,creative{thumbnail_url}', limit: '300' })
    ads = rawAds.map(a => ({ id: a.id, name: a.name, campaign_id: a.campaign_id, status: a.status }))
    if (rawAds.length) await sb.from('ad_meta_ads').upsert(rawAds.map(a => ({ id: a.id, campaign_id: a.campaign_id, name: a.name.slice(0, 300), status: a.status, effective_status: a.effective_status ?? null, thumbnail_url: a.creative?.thumbnail_url ?? null, synced_at: new Date().toISOString() })))
    const adIns = await metaAll<RawAdInsight>(tk, `act_${acct}/insights`, { level: 'ad', time_increment: '1', limit: '500', time_range: JSON.stringify({ since, until }), fields: 'ad_id,impressions,clicks,spend,actions' })
    adDays = adIns.map(r => ({ date: r.date_start, ad_id: r.ad_id, impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), spend: Math.round(Number(r.spend ?? 0)), leads: leadsOf(r.actions) }))
    const week = await metaAll<RawAdInsight>(tk, `act_${acct}/insights`, { level: 'ad', limit: '500', time_range: JSON.stringify({ since: addDays(today, -7), until }), fields: 'ad_id,frequency' })
    for (const r of week) if (r.frequency) freq[r.ad_id] = Number(r.frequency)
  } catch (e) { adError = e instanceof Error ? e.message.slice(0, 200) : '소재 수치 실패' }
  return { campaigns, days, mtd, saved: rows.size, ads, adDays, freq, adError }
}

/** 한 건 실행: 메타의 지금 값을 다시 읽어 제안 때와 같을 때만 */
async function execute(tk: string, a: { id: string; campaign_id: string; kind: string; from_budget: number | null; to_budget: number | null; ad_id?: string | null }): Promise<{ ok: boolean; result: string }> {
  if (a.ad_id) {
    // 소재 멈춤: 그 소재가 켜져 있고, 같은 캠페인에 켜진 소재가 하나 더 있을 때만 (마지막 소재는 멈추지 않음)
    const ad = await meta<{ status?: string }>(tk, a.ad_id, { fields: 'status' })
    if (ad.status !== 'ACTIVE') return { ok: false, result: `소재가 이미 '${ad.status}' 상태라 실행하지 않았습니다.` }
    const sib = await metaAll<{ id: string; status: string }>(tk, `${a.campaign_id}/ads`, { fields: 'id,status', limit: '200' })
    if (sib.filter(x => x.status === 'ACTIVE' && x.id !== a.ad_id).length < 1) return { ok: false, result: '캠페인에 켜진 소재가 이것 하나뿐이라 멈추지 않았습니다. 새 소재를 먼저 넣어 주세요.' }
    await meta(tk, a.ad_id, { status: 'PAUSED' }, 'POST')
    return { ok: true, result: '메타에서 이 소재를 멈췄습니다. 캠페인의 다른 소재는 그대로 돕니다.' }
  }
  const now = await meta<{ status?: string; daily_budget?: string }>(tk, a.campaign_id, { fields: 'status,daily_budget' })
  if (now.status !== 'ACTIVE') return { ok: false, result: `캠페인이 이미 '${now.status}' 상태라 실행하지 않았습니다.` }
  if (a.kind === 'pause') {
    await meta(tk, a.campaign_id, { status: 'PAUSED' }, 'POST')
    return { ok: true, result: '메타에서 캠페인을 멈췄습니다.' }
  }
  const cur = intOrNull(now.daily_budget)
  if (cur == null || cur !== a.from_budget) return { ok: false, result: `제안 뒤 하루 예산이 바뀌어(${cur ?? '없음'}) 실행하지 않았습니다. 내일 다시 판단합니다.` }
  if (!a.to_budget || a.to_budget <= 0) return { ok: false, result: '바꿀 예산이 없습니다.' }
  await meta(tk, a.campaign_id, { daily_budget: String(a.to_budget) }, 'POST')
  return { ok: true, result: `메타에서 하루 예산을 ${a.from_budget!.toLocaleString('ko-KR')}원 → ${a.to_budget.toLocaleString('ko-KR')}원으로 바꿨습니다.` }
}

/** 네이버 한 건 실행: 지금 상태 · 예산을 다시 읽어 제안 때와 같을 때만 */
async function executeNaver(s: Settings, a: { campaign_id: string; kind: string; from_budget: number | null; to_budget: number | null }): Promise<{ ok: boolean; result: string }> {
  const nv = await naver(s)
  const now = naverCampaign(await nv.campaign(a.campaign_id))
  if (now.status !== 'ACTIVE') return { ok: false, result: '네이버 캠페인이 이미 꺼져 있어 실행하지 않았습니다.' }
  if (a.kind === 'pause') { await nv.pause(a.campaign_id); return { ok: true, result: '네이버에서 캠페인을 멈췄습니다 (사용자 OFF).' } }
  if (now.daily_budget == null || now.daily_budget !== a.from_budget) return { ok: false, result: `제안 뒤 하루 예산이 바뀌어(${now.daily_budget ?? '없음'}) 실행하지 않았습니다. 내일 다시 판단합니다.` }
  if (!a.to_budget || a.to_budget <= 0) return { ok: false, result: '바꿀 예산이 없습니다.' }
  await nv.setBudget(a.campaign_id, a.to_budget)
  return { ok: true, result: `네이버에서 하루 예산을 ${a.from_budget!.toLocaleString('ko-KR')}원 → ${a.to_budget.toLocaleString('ko-KR')}원으로 바꿨습니다.` }
}
async function executeAny(s: Settings, a: { id: string; platform?: string | null; campaign_id: string; kind: string; from_budget: number | null; to_budget: number | null; ad_id?: string | null }) {
  return a.platform === 'naver' ? executeNaver(s, a) : execute(await token(), a)
}

async function record(status: string, a: { id: string }, r: { ok: boolean; result: string }, by: string | null) {
  await sb.from('ad_autopilot_actions').update({
    status: r.ok ? '실행' : status, result: r.result.slice(0, 500), executed_at: r.ok ? new Date().toISOString() : null,
    decided_by: by, decided_at: by ? new Date().toISOString() : null,
  }).eq('id', a.id)
}

/** 받기 → 판단 → 기록 → (자동이면) 실행 */
async function run(auto: boolean) {
  const s = await settings()
  if (s.mode === 'off') return { skipped: '자동 운영이 꺼져 있습니다.' }
  const today = kstToday()
  const metaOn = !!s.meta_account_id && !!(await sb.rpc('ad_meta_token_get')).data
  const naverOn = !!s.naver_customer_id && !!(await naverKeys())
  if (!metaOn && !naverOn) throw new Fail('메타 광고 계정 번호 · 열쇠 또는 네이버 고객 번호 · 열쇠를 먼저 넣어 주세요.', 409)
  // 지난 제안은 만료 (어제 이전 · 아직 결정 안 된 것)
  await sb.from('ad_autopilot_actions').update({ status: '만료', result: '하루가 지나 다시 판단합니다.' }).eq('status', '제안').lt('day', today)
  // 매체마다 따로 받음 — 한쪽이 실패해도 다른 쪽은 판단 (오류는 기록)
  const platformOf = new Map<string, Platform>()
  let campaigns: MetaCampaign[] = [], days: InsightDay[] = [], mtd = 0, saved = 0, ads: MetaAd[] = [], adDays: AdDay[] = [], freq: Record<string, number> = {}, adError: string | null = null
  const errors: string[] = []
  if (metaOn) {
    try {
      const m = await sync(await token(), s.meta_account_id!, today)
      campaigns.push(...m.campaigns); days.push(...m.days); mtd += m.mtd; saved += m.saved; ads = m.ads; adDays = m.adDays; freq = m.freq; adError = m.adError
      for (const c of m.campaigns) platformOf.set(c.id, 'meta')
    } catch (e) { errors.push(`메타: ${e instanceof Error ? e.message : '실패'}`) }
  }
  if (naverOn) {
    try {
      const n = await syncNaver(s, today)
      campaigns.push(...n.campaigns); days.push(...n.days); mtd += n.mtd; saved += n.saved
      for (const c of n.campaigns) platformOf.set(c.id, 'naver')
    } catch (e) { errors.push(`네이버: ${e instanceof Error ? e.message : '실패'}`) }
  }
  if (!platformOf.size && errors.length) throw new Fail(errors.join(' · '), 502)
  const proposals: (Proposal & { ad_id?: string; ad_name?: string })[] = judge(today, campaigns, days, s, mtd)
  // 오늘 이미 판단한 캠페인은 건너뜀 (한 캠페인 하루 한 가지 · 캠페인 판단이 소재 판단보다 먼저)
  const { data: done } = await sb.from('ad_autopilot_actions').select('campaign_id').eq('day', today)
  const seen = new Set((done ?? []).map(r => r.campaign_id as string))
  const busy = new Set([...seen, ...proposals.map(p => p.campaign_id)])
  if (!(s.monthly_cap > 0 && mtd >= s.monthly_cap)) proposals.push(...fatigue(today, campaigns, ads, adDays, freq, busy))
  const fresh = proposals.filter(p => !seen.has(p.campaign_id))
  // 실행 7일 뒤 효과 확인 (받은 14일 안에 뒤 7일이 다 들어오는 것만)
  let evaluated = 0
  const { data: toCheck } = await sb.from('ad_autopilot_actions').select('id,kind,day,campaign_id,ad_id,metrics').eq('status', '실행').is('effect', null).gte('day', addDays(today, -15)).lte('day', addDays(today, -8))
  const effects: string[] = []
  for (const a of toCheck ?? []) {
    const r = evaluate(today, a as Parameters<typeof evaluate>[1], days)
    if (!r) continue
    await sb.from('ad_autopilot_actions').update({ effect: r.verdict, effect_note: r.note.slice(0, 500), effect_at: new Date().toISOString() }).eq('id', a.id)
    evaluated++
    effects.push(`· [효과 ${r.verdict}] ${KIND_LABEL[a.kind as keyof typeof KIND_LABEL]}: ${r.note}`)
  }
  let executed = 0, failed = 0
  const lines: string[] = []
  for (const p of fresh) {
    const ins = await sb.from('ad_autopilot_actions').insert({
      day: today, campaign_id: p.campaign_id, campaign_name: p.campaign_name.slice(0, 300), kind: p.kind,
      from_budget: p.from_budget, to_budget: p.to_budget, reason: p.reason.slice(0, 1000), metrics: p.metrics, auto: s.mode === 'auto',
      ad_id: p.ad_id ?? null, ad_name: p.ad_name ? p.ad_name.slice(0, 300) : null, platform: platformOf.get(p.campaign_id) ?? 'meta',
    }).select('id').single()
    if (ins.error) continue
    let tag = '제안'
    if (auto && canExecute(s, false)) {
      try {
        const r = await executeAny(s, { id: ins.data.id, platform: platformOf.get(p.campaign_id) ?? 'meta', ...p })
        await record('실패', ins.data, r, null)
        if (r.ok) { executed++; tag = '실행' } else { failed++; tag = '실행 안 함' }
      } catch (e) {
        failed++; tag = '실패'
        await record('실패', ins.data, { ok: false, result: e instanceof Error ? e.message : '실행 실패' }, null)
      }
    }
    lines.push(`· [${tag}] ${platformOf.get(p.campaign_id) === 'naver' ? '네이버 ' : ''}${p.ad_id ? '소재 ' : ''}${KIND_LABEL[p.kind]} — ${p.campaign_name}${p.ad_name ? ` › ${p.ad_name}` : ''}: ${p.reason}`)
  }
  const info = { ran_at: new Date().toISOString(), ok: true, error: null, saved_rows: saved, campaigns: campaigns.length, active: campaigns.filter(c => c.status === 'ACTIVE').length, proposals: fresh.length, executed, failed, mtd_spend: mtd, ads: ads.length, evaluated, ad_error: adError, platform_errors: errors.length ? errors.join(' · ').slice(0, 400) : null, meta: metaOn, naver: naverOn }
  await sb.from('app_settings').upsert({ key: 'ad_autopilot_info', value: info, updated_at: new Date().toISOString() })
  return { ...info, lines: [...lines, ...effects], mode: s.mode, kill: s.kill_switch }
}

/** 대표에게 하루 한 번 정리 (제목에 금액 없음) */
async function notifyCeo(title: string, body: string) {
  const { data: ceo } = await sb.from('profiles').select('id').eq('active', true).eq('is_agent', false).eq('role', 'admin').eq('title', '대표')
  const since = new Date(Date.now() - 20 * 3600_000).toISOString()
  for (const p of ceo ?? []) {
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', p.id).eq('title', title).gt('created_at', since)
    if (count) continue
    await sb.from('notifications').insert({ user_id: p.id, kind: '시스템', title, body: body.slice(0, 3000), link: '/ads?tab=autopilot' })
  }
}

async function admin(authorization: string | null): Promise<string> {
  if (!authorization) throw new Fail('로그인이 필요합니다.', 401)
  const c: SupabaseClient = createClient(URL_, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user } } = await c.auth.getUser()
  if (!user) throw new Fail('로그인이 필요합니다.', 401)
  const p = await sb.from('profiles').select('active,role,is_agent').eq('id', user.id).single()
  if (!p.data?.active || p.data.is_agent || p.data.role !== 'admin') throw new Fail('관리자만 쓸 수 있습니다.', 403)
  return user.id
}

// ── 메타 광고 만들기 (2026-11-21 · metaCreate.ts) ─────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function draftRow(id: string) {
  const { data } = await sb.from('ad_meta_drafts').select('*').eq('campaign_id', id).maybeSingle()
  return data as null | { status: string; meta_campaign_id: string | null; meta_adset_id: string | null; meta_ad_id: string | null; daily_budget: number | null; updated_at: string }
}
const saveDraft = (id: string, v: Record<string, unknown>) => sb.from('ad_meta_drafts').upsert({ campaign_id: id, ...v, updated_at: new Date().toISOString() })

/** 준비 완료 캠페인 → 메타에 모두 '멈춤'으로 만들기 */
async function metaCreate(id: string, me: string) {
  if (!UUID.test(id)) throw new Fail('캠페인을 찾지 못했습니다.', 404)
  const prev = await draftRow(id)
  if (prev && (prev.status === '멈춤' || prev.status === '켜짐')) throw new Fail('이미 메타에 만든 캠페인입니다. 켜기 · 끄기만 할 수 있습니다.', 409)
  if (prev?.status === '만드는 중' && Date.now() - Date.parse(prev.updated_at) < 5 * 60_000) throw new Fail('지금 만드는 중입니다. 잠시 뒤 확인해 주세요.', 409)
  const { data: c } = await sb.from('marketing_campaigns').select('document').eq('id', id).single()
  if (!c) throw new Fail('캠페인을 찾지 못했습니다.', 404)
  const doc = c.document as CampaignDoc
  const { data: assets } = await sb.from('marketing_assets').select('name,mime,path').eq('campaign_id', id).is('deleted_at', null).order('created_at')
  const imgs = (assets ?? []).filter(a => a.mime === 'image/jpeg' || a.mime === 'image/png').slice(0, 10)
  const s = await settings() as Settings & { meta_page_id: string | null; meta_ig_user_id: string | null }
  if (!s.meta_account_id) throw new Fail('메타 광고 계정 번호를 먼저 넣어 주세요.', 409)
  const problems = metaProblems(doc, { pageId: s.meta_page_id ?? undefined, igUserId: s.meta_ig_user_id }, imgs.length)
  if (problems.length) throw new Fail(problems.join(' / '), 409)
  const tk = await token()
  const acct = `act_${s.meta_account_id}`
  const spec = buildMetaSpec(doc, { pageId: s.meta_page_id!, igUserId: s.meta_ig_user_id })
  await saveDraft(id, { status: '만드는 중', error: null, created_by: me, meta_campaign_id: null, meta_adset_id: null, meta_creative_id: null, meta_ad_id: null, daily_budget: spec.dailyBudget, images: imgs.length })
  try {
    const hashes: string[] = []
    for (const a of imgs) {
      const f = await sb.storage.from('marketing-assets').download(a.path)
      if (f.error || !f.data) throw new Fail(`이미지를 읽지 못했습니다: ${a.name}`, 500)
      const buf = new Uint8Array(await f.data.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      const up = await meta<{ images?: Record<string, { hash?: string }> }>(tk, `${acct}/adimages`, { bytes: btoa(bin) }, 'POST')
      const h = Object.values(up.images ?? {})[0]?.hash
      if (!h) throw new Fail(`메타가 이미지를 받지 못했습니다: ${a.name}`, 502)
      hashes.push(h)
    }
    const camp = await meta<{ id: string }>(tk, `${acct}/campaigns`, spec.campaign, 'POST')
    await saveDraft(id, { meta_campaign_id: camp.id })
    const adset = await meta<{ id: string }>(tk, `${acct}/adsets`, { ...spec.adset, campaign_id: camp.id }, 'POST')
    await saveDraft(id, { meta_adset_id: adset.id })
    const cr = await meta<{ id: string }>(tk, `${acct}/adcreatives`, spec.creative(hashes), 'POST')
    await saveDraft(id, { meta_creative_id: cr.id })
    const ad = await meta<{ id: string }>(tk, `${acct}/ads`, spec.ad(adset.id, cr.id), 'POST')
    await saveDraft(id, { meta_ad_id: ad.id, status: '멈춤' })
    return { ok: true, status: '멈춤', campaign_id: camp.id, ad_id: ad.id, images: hashes.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '만들지 못했습니다.'
    await saveDraft(id, { status: '실패', error: msg.slice(0, 500) })
    throw e
  }
}

/** 켜기(대표 승인) · 끄기 — 켜기 전에 긴급 정지 · 하루 한도 확인 */
async function metaSwitch(id: string, on: boolean, me: string) {
  const d = await draftRow(id)
  if (!d?.meta_campaign_id || !d.meta_adset_id || !d.meta_ad_id) throw new Fail('메타에 만든 광고가 없습니다.', 404)
  const tk = await token()
  if (on) {
    if (d.status === '켜짐') throw new Fail('이미 켜져 있습니다.', 409)
    const s = await settings()
    const { data: act } = await sb.from('ad_meta_campaigns').select('id,daily_budget').eq('status', 'ACTIVE')
    const { data: live } = await sb.from('ad_meta_drafts').select('meta_campaign_id,daily_budget').eq('status', '켜짐')
    const liveIds = new Set((live ?? []).map(x => x.meta_campaign_id))
    const activeDaily = (act ?? []).filter(x => !liveIds.has(x.id)).reduce((n, x) => n + (x.daily_budget ?? 0), 0) + (live ?? []).reduce((n, x) => n + (x.daily_budget ?? 0), 0)
    const p = launchProblem(s.daily_cap, activeDaily, d.daily_budget, s.kill_switch)
    if (p) throw new Fail(p, 409)
    for (const obj of [d.meta_ad_id, d.meta_adset_id, d.meta_campaign_id]) await meta(tk, obj, { status: 'ACTIVE' }, 'POST')
    await saveDraft(id, { status: '켜짐', launched_by: me, launched_at: new Date().toISOString(), error: null })
    return { ok: true, status: '켜짐' }
  }
  await meta(tk, d.meta_campaign_id, { status: 'PAUSED' }, 'POST')
  await saveDraft(id, { status: '멈춤' })
  return { ok: true, status: '멈춤' }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405)
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action ?? '')
    if (action === 'tick') {
      const { data: want } = await sb.rpc('gdrive_secret_get', { p_name: 'GDRIVE_SYNC_KEY' })
      if (!want || req.headers.get('x-sync-key') !== want) return json({ error: '열쇠가 맞지 않습니다.' }, 403)
      try {
        const r = await run(true)
        if ('skipped' in r) return json(r)
        const modeLabel = r.kill ? '긴급 정지 중 — 실행 없음' : r.mode === 'auto' ? '자동 실행' : r.mode === 'approve' ? '승인 뒤 실행' : '제안만'
        if (r.proposals || r.failed || r.evaluated) {
          await notifyCeo(`[광고 자동 운영] 오늘 판단 ${r.proposals}건 · 실행 ${r.executed}건`,
            `모드: ${modeLabel}\n켜진 캠페인 ${r.active}개 · 받은 수치 ${r.saved_rows}줄\n\n${r.lines.join('\n')}\n\n${r.mode === 'approve' && !r.kill ? '광고·콘텐츠 › 광고 운영팀 › 자동 운영에서 승인하면 메타에 바로 반영됩니다.' : ''}`)
        }
        return json(r)
      } catch (e) {
        const msg = e instanceof Error ? e.message : '실패'
        await sb.from('app_settings').upsert({ key: 'ad_autopilot_info', value: { ran_at: new Date().toISOString(), ok: false, error: msg.slice(0, 300) }, updated_at: new Date().toISOString() })
        await notifyCeo('[광고 자동 운영] 오늘 수치를 받지 못했습니다', `사유: ${msg}\n광고·콘텐츠 › 광고 운영팀 › 자동 운영에서 열쇠 · 계정 번호를 확인해 주세요.`)
        return json({ error: msg }, 200)
      }
    }
    const me = await admin(req.headers.get('authorization'))
    if (action === 'check_naver') {
      const s = await settings()
      const list = await (await naver(s)).campaigns()
      return json({ ok: true, campaigns: list?.length ?? 0, active: (list ?? []).map(naverCampaign).filter(c => c.status === 'ACTIVE').length })
    }
    if (action === 'check') {
      const s = await settings()
      if (!s.meta_account_id) throw new Fail('메타 광고 계정 번호를 먼저 넣어 주세요.', 409)
      const a = await meta<{ name?: string; currency?: string; account_status?: number; timezone_name?: string }>(await token(), `act_${s.meta_account_id}`, { fields: 'name,currency,account_status,timezone_name' })
      return json({ ok: true, name: a.name ?? '', currency: a.currency ?? '', status: a.account_status ?? null, timezone: a.timezone_name ?? '' })
    }
    if (action === 'run') return json(await run(false))
    if (action === 'decide') {
      const id = String(body.id ?? '')
      const approve = body.approve === true
      const { data: a } = await sb.from('ad_autopilot_actions').select('id,campaign_id,ad_id,kind,from_budget,to_budget,status,day,platform').eq('id', id).single()
      if (!a) throw new Fail('제안을 찾지 못했습니다.', 404)
      if (a.status !== '제안') throw new Fail(`이미 '${a.status}' 처리된 제안입니다.`, 409)
      if (!approve) {
        await sb.from('ad_autopilot_actions').update({ status: '거절', decided_by: me, decided_at: new Date().toISOString() }).eq('id', id)
        return json({ ok: true, status: '거절' })
      }
      const s = await settings()
      if (s.kill_switch) throw new Fail('긴급 정지 중이라 실행하지 않습니다. 정지를 풀고 다시 승인해 주세요.', 409)
      if (s.mode === 'suggest' || s.mode === 'off') throw new Fail("지금 모드는 '제안만'이라 메타에 반영하지 않습니다. 모드를 '승인 뒤 실행'으로 바꿔 주세요.", 409)
      if (a.day !== kstToday()) throw new Fail('어제 이전 제안이라 실행하지 않습니다. 오늘 판단을 기다려 주세요.', 409)
      try {
        const r = await executeAny(s, a)
        await record('실패', a, r, me)
        return json({ ok: r.ok, status: r.ok ? '실행' : '실패', result: r.result })
      } catch (e) {
        const msg = e instanceof Error ? e.message : '실행 실패'
        await record('실패', a, { ok: false, result: msg }, me)
        throw e
      }
    }
    if (action === 'meta_create') return json(await metaCreate(String(body.campaign_id ?? ''), me))
    if (action === 'meta_launch') return json(await metaSwitch(String(body.campaign_id ?? ''), true, me))
    if (action === 'meta_pause') return json(await metaSwitch(String(body.campaign_id ?? ''), false, me))
    throw new Fail('알 수 없는 요청입니다.')
  } catch (e) {
    if (e instanceof Fail || e instanceof NaverError) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: '서버 오류가 났습니다.' }, 500)
  }
})

export type { Proposal }
