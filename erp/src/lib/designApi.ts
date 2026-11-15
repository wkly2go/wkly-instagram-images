import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type {
  DesignApi, DesignCard, DesignJob, DesignMaterial, DesignProject, DesignTrade, DesignVendor, Estimate, EstimateLine,
  Knowledge, Placement, ScheduleTask, UnitCost, UnitPrice,
} from './design'

const fail = (e: { message: string; code?: string } | null) => {
  if (!e) return
  if (['PGRST202', 'PGRST205', '42P01'].includes(e.code ?? '')) throw new ApiError('설계·견적 서버를 준비 중입니다. 잠시 뒤 다시 열어 주세요.')
  if (e.code === '42501') throw new ApiError('이 작업은 권한이 필요합니다. 관리자에게 문의하세요.')
  throw new ApiError(e.message)
}
const like = (s: string) => `%${s.trim().replace(/[%_,()]/g, ' ')}%`

export function createSupabaseDesignApi(sb: SupabaseClient): DesignApi {
  const count = async (table: string, filter?: (q: any) => any) => {
    let q: any = sb.from(table).select('*', { count: 'exact', head: true })
    if (filter) q = filter(q)
    const r = await q
    fail(r.error)
    return r.count ?? 0
  }
  return {
    async getDesignOverview() {
      const [projects, prices, vendors, candidates, materials, knowledge, pending] = await Promise.all([
        count('design_projects'), count('design_unit_prices'),
        count('design_vendors', q => q.eq('status', 'partner')), count('design_vendors', q => q.eq('status', 'candidate')),
        count('design_materials'), count('design_knowledge'), count('design_approvals', q => q.eq('status', 'pending')),
      ])
      return { projects, prices, vendors, candidates, materials, knowledge, pending }
    },
    async getDesignBase() {
      const [t, u] = await Promise.all([
        sb.from('design_trades').select('code,name,group_name,sort').order('sort'),
        sb.from('design_units').select('standard').order('standard'),
      ])
      fail(t.error); fail(u.error)
      return { trades: (t.data ?? []) as DesignTrade[], units: (u.data ?? []).map(x => x.standard as string) }
    },
    async listDesignProjects() {
      const r = await sb.from('design_project_info').select('*').order('created_at', { ascending: false })
      fail(r.error)
      return (r.data ?? []) as DesignProject[]
    },
    async listDesignCandidates() {
      const [p, d] = await Promise.all([
        sb.from('projects').select('id,code,name,status').eq('division', 'AR').order('created_at', { ascending: false }).limit(300),
        sb.from('design_projects').select('id'),
      ])
      fail(p.error); fail(d.error)
      const started = new Set((d.data ?? []).map(x => x.id))
      return (p.data ?? []).filter(x => !started.has(x.id))
    },
    async startDesign(projectId, spaceType, areaM2) {
      fail((await sb.from('design_projects').insert({ id: projectId, space_type: spaceType, area_m2: areaM2 })).error)
    },
    async updateDesignProject(projectId, patch) {
      fail((await sb.from('design_projects').update(patch).eq('id', projectId)).error)
    },
    async listPlacements(projectId, modelVersion) {
      const r = await sb.from('design_placements').select('id,project_id,model_version,trade_code,item,spec,unit,qty,location,source,sort')
        .eq('project_id', projectId).eq('model_version', modelVersion).order('sort').order('created_at')
      fail(r.error)
      return (r.data ?? []) as Placement[]
    },
    async addPlacement(row) {
      fail((await sb.from('design_placements').insert({ ...row, source: 'manual', sort: 900000 + Math.floor(Date.now() / 1000) % 90000 })).error)
    },
    async updatePlacementQty(id, qty) {
      fail((await sb.from('design_placements').update({ qty }).eq('id', id)).error)
    },
    async deletePlacement(id) {
      fail((await sb.from('design_placements').delete().eq('id', id).eq('source', 'manual')).error)
    },
    async listEstimates(projectId) {
      const r = await sb.from('design_estimates').select('id,project_id,revision,variant,model_version,totals,warnings,created_at')
        .eq('project_id', projectId).order('revision', { ascending: false })
      fail(r.error)
      return (r.data ?? []) as Estimate[]
    },
    async listEstimateLines(estimateId) {
      const r = await sb.from('design_estimate_lines').select('id,estimate_id,trade_code,item,spec,unit,qty,unit_price,amount,source,sort')
        .eq('estimate_id', estimateId).order('sort')
      fail(r.error)
      return (r.data ?? []) as EstimateLine[]
    },
    async requestDesignJob(projectId, kind) {
      fail((await sb.rpc('design_request_job', { p_project: projectId, p_kind: kind })).error)
    },
    async listDesignJobs(projectId) {
      const r = await sb.from('design_jobs').select('id,kind,status,error,created_at,finished_at').eq('project_id', projectId)
        .order('created_at', { ascending: false }).limit(5)
      fail(r.error)
      return (r.data ?? []) as DesignJob[]
    },
    async listScheduleTasks(projectId) {
      const r = await sb.from('design_schedule_tasks').select('id,project_id,trade_code,name,start_date,end_date,done').eq('project_id', projectId).order('start_date')
      fail(r.error)
      return (r.data ?? []) as ScheduleTask[]
    },
    async addScheduleTask(row) { fail((await sb.from('design_schedule_tasks').insert(row)).error) },
    async updateScheduleTask(id, patch) { fail((await sb.from('design_schedule_tasks').update(patch).eq('id', id)).error) },
    async deleteScheduleTask(id) { fail((await sb.from('design_schedule_tasks').delete().eq('id', id)).error) },
    async listUnitPrices(search, trade) {
      let q = sb.from('design_unit_prices').select('id,trade_code,item,spec,unit,variant,sell_price,effective_date,source_doc,approved')
      if (trade) q = q.eq('trade_code', trade)
      if (search.trim()) q = q.or(`item.ilike.${like(search)},spec.ilike.${like(search)}`)
      const r = await q.order('trade_code').order('item').order('effective_date', { ascending: false }).limit(400)
      fail(r.error)
      return (r.data ?? []) as UnitPrice[]
    },
    async listUnitCosts(search, trade) {
      let q = sb.from('design_unit_costs').select('id,trade_code,item,spec,unit,cost_price,vendor_id,effective_date,source_doc,approved')
      if (trade) q = q.eq('trade_code', trade)
      if (search.trim()) q = q.or(`item.ilike.${like(search)},spec.ilike.${like(search)}`)
      const r = await q.order('trade_code').order('item').order('effective_date', { ascending: false }).limit(400)
      fail(r.error)
      return (r.data ?? []) as UnitCost[]
    },
    async listDesignVendors() {
      const r = await sb.from('design_vendors').select('id,client_id,name,trades,contact_name,phone,status,region,source_url,source_note').order('status', { ascending: false }).order('name')
      fail(r.error)
      return (r.data ?? []) as DesignVendor[]
    },
    async listDesignMaterials(search) {
      let q = sb.from('design_materials').select('id,name,category,spec,color_code,unit,supplier_id,product_url,notes')
      if (search.trim()) q = q.or(`name.ilike.${like(search)},category.ilike.${like(search)},color_code.ilike.${like(search)}`)
      const r = await q.order('category').order('name').limit(400)
      fail(r.error)
      return (r.data ?? []) as DesignMaterial[]
    },
    async listKnowledge() {
      const r = await sb.from('design_knowledge').select('id,kind,key,title,body,source,project_code').order('kind')
      fail(r.error)
      return (r.data ?? []) as Knowledge[]
    },
    async listDesignCards(status, projectId) {
      let q = sb.from('design_approvals').select('id,project_id,kind,ref_id,title,payload,status,requested_at,comment')
      q = status === 'pending' ? q.eq('status', 'pending') : q.neq('status', 'pending')
      if (projectId) q = q.eq('project_id', projectId)
      const r = await q.order('requested_at', { ascending: false }).limit(status === 'pending' ? 200 : 60)
      fail(r.error)
      return (r.data ?? []) as DesignCard[]
    },
    async decideDesignCard(id, approve, comment) {
      fail((await sb.rpc('design_decide', { p_id: id, p_approve: approve, p_comment: comment }).retry(false)).error)
    },
  }
}

/** 체험 모드: 화면 확인용 본보기 자료 (저장은 이 창 안에서만) */
export function createDemoDesignApi(): DesignApi {
  const trades: DesignTrade[] = [
    { code: 'T01', name: '가설공사', group_name: '공통', sort: 10 }, { code: 'T03', name: '목공사', group_name: '건축', sort: 30 },
    { code: 'T06', name: '도장공사', group_name: '마감', sort: 60 }, { code: 'T10', name: '전기공사', group_name: '설비', sort: 100 },
    { code: 'T14', name: '사인·그래픽', group_name: '연출', sort: 140 }, { code: 'T15', name: '집기제작', group_name: '연출', sort: 150 },
  ]
  const P = 'demo-design-1'
  const projects: DesignProject[] = [{
    id: P, code: 'AR2611-01', name: '(본보기) 성수 팝업 스토어', address: '서울 성동구 연무장길', client_name: '본보기 브랜드', space_type: 'popup',
    area_m2: 82.5, budget: 60000000, start_date: '2026-12-01', end_date: '2026-12-14', stage: 'estimate', model_version: 1, status: '진행', drive_url: null,
  }]
  let seq = 0
  const id = () => `demo-d-${++seq}`
  let placements: Placement[] = [
    ['T01', '바닥 보양', '플로베니아', 'm2', 82.5, 'model'], ['T03', '가벽 설치', '각재+합판 9T 양면 H2400', 'm2', 46, 'model'],
    ['T06', '벽체 도장', '수성 2회', 'm2', 92, 'model'], ['T10', '콘센트 증설', '2구', 'EA', 8, 'model'],
    ['T14', '외부 사인', '채널 간판 W2400', '식', 1, 'manual'], ['T15', '진열 집기', 'W1200 D450 H900', 'EA', 6, 'model'],
  ].map(([trade_code, item, spec, unit, qty, source], i) => ({ id: id(), project_id: P, model_version: 1, trade_code, item, spec, unit, qty, location: null, source, sort: i } as Placement))
  const price: Record<string, number> = { '바닥 보양': 4500, '가벽 설치': 68000, '벽체 도장': 14000, '콘센트 증설': 45000, '외부 사인': 2400000, '진열 집기': 380000 }
  const linesOf = (eid: string): EstimateLine[] => placements.map((p, i) => ({
    id: `${eid}-${i}`, estimate_id: eid, trade_code: p.trade_code, item: p.item, spec: p.spec, unit: p.unit, qty: p.qty,
    unit_price: price[p.item] ?? null, amount: price[p.item] != null ? Math.round(price[p.item] * p.qty) : null, source: p.source, sort: i,
  }))
  const totalsOf = (eid: string) => {
    const direct = linesOf(eid).reduce((s, l) => s + (l.amount ?? 0), 0)
    const overhead = Math.round(direct * 0.05), profit = Math.round((direct + overhead) * 0.05)
    const supply = direct + overhead + profit, vat = Math.round(supply * 0.1)
    const s = (n: number) => String(n)
    return { direct: s(direct), overhead: s(overhead), profit: s(profit), subtotal: s(supply), adjustment: '0', supply: s(supply), vat: s(vat), total: s(supply + vat) }
  }
  const estimates: Estimate[] = [{ id: 'demo-est-1', project_id: P, revision: 1, variant: 'standard', model_version: 1, totals: totalsOf('demo-est-1'),
    warnings: [{ code: 'missing_trade', level: 'warn', message: '팝업 공간에 보통 들어가는 조명공사가 없습니다.', trade_code: 'T11' }], created_at: '2026-11-14T02:00:00Z' }]
  let tasks: ScheduleTask[] = [
    { id: id(), project_id: P, trade_code: 'T01', name: '가설 · 보양', start_date: '2026-12-01', end_date: '2026-12-01', done: true },
    { id: id(), project_id: P, trade_code: 'T03', name: '목공사', start_date: '2026-12-02', end_date: '2026-12-05', done: false },
    { id: id(), project_id: P, trade_code: 'T06', name: '도장', start_date: '2026-12-06', end_date: '2026-12-08', done: false },
    { id: id(), project_id: P, trade_code: 'T15', name: '집기 반입 · 설치', start_date: '2026-12-09', end_date: '2026-12-11', done: false },
  ]
  let cards: DesignCard[] = [{ id: 'demo-card-1', project_id: P, kind: 'estimate', ref_id: 'demo-est-1', title: '견적 1차 초안 (기본안)', payload: {}, status: 'pending', requested_at: '2026-11-14T02:00:00Z', comment: null }]
  const vendors: DesignVendor[] = [
    { id: 'v1', client_id: null, name: '(본보기) 가나목공', trades: ['T03', 'T15'], contact_name: '김목수', phone: null, status: 'partner', region: '서울', source_url: null, source_note: null },
    { id: 'v2', client_id: null, name: '(본보기) 다라전기', trades: ['T10'], contact_name: null, phone: null, status: 'partner', region: '경기', source_url: null, source_note: null },
    { id: 'v3', client_id: null, name: '(본보기) 나라장터 후보 업체', trades: ['T14'], contact_name: null, phone: null, status: 'candidate', region: '서울', source_url: null, source_note: '나라장터 낙찰 이력' },
  ]
  const jobs: DesignJob[] = []
  return {
    async getDesignOverview() { return { projects: 1, prices: 6, vendors: 2, candidates: 1, materials: 2, knowledge: 2, pending: cards.filter(c => c.status === 'pending').length } },
    async getDesignBase() { return { trades, units: ['EA', 'm', 'm2', '식', '평'] } },
    async listDesignProjects() { return projects },
    async listDesignCandidates() { return [] },
    async startDesign() { throw new ApiError('체험 모드에서는 본보기 프로젝트만 볼 수 있습니다.') },
    async updateDesignProject(pid, patch) { Object.assign(projects.find(p => p.id === pid) ?? {}, patch) },
    async listPlacements(pid, mv) { return placements.filter(p => p.project_id === pid && p.model_version === mv) },
    async addPlacement(row) { placements = [...placements, { ...row, id: id(), source: 'manual', sort: placements.length }] },
    async updatePlacementQty(pid, qty) { placements = placements.map(p => (p.id === pid ? { ...p, qty } : p)) },
    async deletePlacement(pid) { placements = placements.filter(p => p.id !== pid) },
    async listEstimates(pid) { return estimates.filter(e => e.project_id === pid) },
    async listEstimateLines(eid) { return linesOf(eid) },
    async requestDesignJob(pid, kind) {
      if (kind !== 'estimate.build') throw new ApiError('체험 모드에서는 발주서를 만들지 않습니다.')
      const rev = Math.max(0, ...estimates.map(e => e.revision)) + 1
      const eid = `demo-est-${rev}`
      estimates.unshift({ id: eid, project_id: pid, revision: rev, variant: 'standard', model_version: 1, totals: totalsOf(eid), warnings: [], created_at: new Date().toISOString() })
      cards = [{ id: id(), project_id: pid, kind: 'estimate', ref_id: eid, title: `견적 ${rev}차 초안 (기본안)`, payload: {}, status: 'pending', requested_at: new Date().toISOString(), comment: null }, ...cards]
      jobs.unshift({ id: id(), kind, status: 'done', error: null, created_at: new Date().toISOString(), finished_at: new Date().toISOString() })
    },
    async listDesignJobs() { return jobs },
    async listScheduleTasks(pid) { return tasks.filter(t => t.project_id === pid).sort((a, b) => a.start_date.localeCompare(b.start_date)) },
    async addScheduleTask(row) { tasks = [...tasks, { ...row, id: id() }] },
    async updateScheduleTask(tid, patch) { tasks = tasks.map(t => (t.id === tid ? { ...t, ...patch } : t)) },
    async deleteScheduleTask(tid) { tasks = tasks.filter(t => t.id !== tid) },
    async listUnitPrices(search, trade) {
      return placements.filter(p => (!trade || p.trade_code === trade) && (!search.trim() || p.item.includes(search.trim()))).map((p, i): UnitPrice => ({
        id: `up-${i}`, trade_code: p.trade_code, item: p.item, spec: p.spec, unit: p.unit, variant: 'standard', sell_price: price[p.item] ?? 0,
        effective_date: '2026-11-01', source_doc: '본보기', approved: true }))
    },
    async listUnitCosts(search, trade) {
      return placements.filter(p => (!trade || p.trade_code === trade) && (!search.trim() || p.item.includes(search.trim()))).map((p, i): UnitCost => ({
        id: `uc-${i}`, trade_code: p.trade_code, item: p.item, spec: p.spec, unit: p.unit, cost_price: Math.round((price[p.item] ?? 0) * 0.72),
        vendor_id: 'v1', effective_date: '2026-11-01', source_doc: '본보기', approved: true }))
    },
    async listDesignVendors() { return vendors },
    async listDesignMaterials(): Promise<DesignMaterial[]> {
      return [
        { id: 'm1', name: '(본보기) 수성 페인트 백색', category: '도장', spec: '무광', color_code: 'PT-01', unit: 'm2', supplier_id: null, product_url: null, notes: null },
        { id: 'm2', name: '(본보기) 자작 합판 18T', category: '목재', spec: '1220×2440', color_code: 'WD-01', unit: 'EA', supplier_id: null, product_url: null, notes: null },
      ]
    },
    async listKnowledge(): Promise<Knowledge[]> {
      return [
        { id: 'k1', kind: 'drawing_set', key: 'demo-set', title: '(본보기) 도면 세트 구성', body: { sheets: ['표지', '도면 목록', '평면도', '천장도', '입면도', '상세도'] }, source: '본보기', project_code: null },
        { id: 'k2', kind: 'spec_book', key: 'demo-spec', title: '(본보기) 스펙북 구성', body: { sections: ['마감표', '조명', '가구', '위생기구', '하드웨어'] }, source: '본보기', project_code: null },
      ]
    },
    async listDesignCards(status, pid) { return cards.filter(c => (status === 'pending') === (c.status === 'pending') && (!pid || c.project_id === pid)) },
    async decideDesignCard(cid, approve, comment) { cards = cards.map(c => (c.id === cid ? { ...c, status: approve ? 'approved' : 'rejected', comment: comment || null } : c)) },
  }
}
