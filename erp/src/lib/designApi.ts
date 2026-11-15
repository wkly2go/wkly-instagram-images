import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { PlanGeometry } from './designPlan'
import type {
  CostLine, DesignApi, SpecItem, DesignCard, DesignDocument, DesignJob, PoLine, PurchaseOrder, DesignMaterial, DesignProject, DesignTrade, DesignVendor, Estimate, EstimateLine,
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
      const r = await sb.from('design_placements').select('id,project_id,model_version,trade_code,item,spec,unit,qty,location,source,sort,section,note')
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
      const r = await sb.from('design_estimate_lines').select('id,estimate_id,trade_code,item,spec,unit,qty,unit_price,amount,source,sort,section,note')
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
    async listDesignDocuments(projectId) {
      const r = await sb.from('design_documents').select('id,kind,version,file_path,drive_path,created_at').eq('project_id', projectId).order('version', { ascending: false }).order('kind').limit(60)
      fail(r.error)
      return (r.data ?? []) as DesignDocument[]
    },
    async downloadDesignFile(documentId) {
      const r = await sb.rpc('design_file', { p_document: documentId })
      fail(r.error)
      const f = (r.data ?? [])[0] as { name: string; mime: string; base64: string } | undefined
      if (!f) throw new ApiError('보관된 파일이 없습니다. 견적을 다시 계산하면 새로 만들어집니다.')
      const bin = atob(f.base64.replace(/\s/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { name: f.name, blob: new Blob([bytes], { type: f.mime }) }
    },
    async getDesignPlan(projectId) {
      const r = await sb.from('design_spaces').select('version,geometry').eq('project_id', projectId).eq('source', 'manual').order('version', { ascending: false }).limit(20)
      fail(r.error)
      const rows = r.data ?? []
      return ((rows.find(x => x.version === 0) ?? rows[0])?.geometry ?? null) as PlanGeometry | null
    },
    async saveDesignPlan(projectId, plan) {
      fail((await sb.from('design_spaces').upsert({ project_id: projectId, version: 0, source: 'manual', geometry: plan, approved: false }, { onConflict: 'project_id,version' })).error)
    },
    async applyDesignPlan(projectId, plan, lines) {
      fail((await sb.rpc('design_apply_plan', { p_project: projectId, p_geometry: plan, p_lines: lines }).retry(false)).error)
    },
    async listSpecItems(projectId) {
      const r = await sb.from('design_spec_items').select('id,project_id,book,code,name,spec,location,maker,material_id,qty,unit,product_url,note,status,sort').eq('project_id', projectId).order('book').order('sort').order('created_at')
      fail(r.error)
      return (r.data ?? []) as SpecItem[]
    },
    async addSpecItem(row) { fail((await sb.from('design_spec_items').insert({ ...row, sort: Math.floor(Date.now() / 1000) % 1000000 })).error) },
    async updateSpecItem(id, patch) { fail((await sb.from('design_spec_items').update(patch).eq('id', id)).error) },
    async deleteSpecItem(id) { fail((await sb.from('design_spec_items').delete().eq('id', id)).error) },
    async listCostLines(projectId) {
      const r = await sb.from('design_cost_lines').select('id,project_id,zone,item,qty,cost_price,vendor_name,note,source_doc,sort').eq('project_id', projectId).order('sort').order('created_at')
      fail(r.error)
      return (r.data ?? []) as CostLine[]
    },
    async replaceCostLines(projectId, rows, sourceDoc) {
      fail((await sb.from('design_cost_lines').delete().eq('project_id', projectId)).error)
      for (let i = 0; i < rows.length; i += 200) {
        fail((await sb.from('design_cost_lines').insert(rows.slice(i, i + 200).map((x, k) => ({ ...x, project_id: projectId, source_doc: sourceDoc, sort: i + k + 1 })))).error)
      }
    },
    async addCostLine(row) { fail((await sb.from('design_cost_lines').insert({ ...row, sort: 900000 + Math.floor(Date.now() / 1000) % 90000 })).error) },
    async updateCostLine(id, patch) { fail((await sb.from('design_cost_lines').update(patch).eq('id', id)).error) },
    async deleteCostLine(id) { fail((await sb.from('design_cost_lines').delete().eq('id', id)).error) },
    async listPurchaseOrders(projectId) {
      const r = await sb.from('design_purchase_orders').select('id,po_number,vendor_id,status,issue_date,due_date,total,payment_terms').eq('project_id', projectId).order('po_number')
      fail(r.error)
      return (r.data ?? []) as PurchaseOrder[]
    },
    async listPoLines(poIds) {
      if (!poIds.length) return []
      const r = await sb.from('design_po_lines').select('id,po_id,item,spec,unit,qty,cost_price,amount,received_qty').in('po_id', poIds)
      fail(r.error)
      return (r.data ?? []) as PoLine[]
    },
    async updatePlacement(id, patch) { fail((await sb.from('design_placements').update(patch).eq('id', id)).error) },
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

/** 체험 모드: 가짜 본보기 자료를 두지 않는다 (2026-11-15 대표 지시 '목업은 올리지 마'). 실제 자료는 운영 계정에서만 보인다. */
export function createDemoDesignApi(): DesignApi {
  const none = async () => { throw new ApiError('설계·견적은 운영 계정에서 실제 자료로만 사용할 수 있습니다.') }
  return {
    async getDesignOverview() { return { projects: 0, prices: 0, vendors: 0, candidates: 0, materials: 0, knowledge: 0, pending: 0 } },
    async getDesignBase() { return { trades: [], units: [] } },
    async listDesignProjects() { return [] },
    async listDesignCandidates() { return [] },
    startDesign: none, updateDesignProject: none,
    async listPlacements() { return [] },
    addPlacement: none, updatePlacementQty: none, deletePlacement: none,
    async listEstimates() { return [] },
    async listEstimateLines() { return [] },
    requestDesignJob: none,
    async listDesignJobs() { return [] },
    async listDesignDocuments() { return [] },
    async getDesignPlan() { return null },
    saveDesignPlan: none, applyDesignPlan: none, addSpecItem: none, updateSpecItem: none, deleteSpecItem: none,
    async listSpecItems() { return [] },
    downloadDesignFile: none, replaceCostLines: none, addCostLine: none, updateCostLine: none, deleteCostLine: none,
    async listCostLines() { return [] },
    async listPurchaseOrders() { return [] },
    async listPoLines() { return [] },
    updatePlacement: none,
    async listScheduleTasks() { return [] },
    addScheduleTask: none, updateScheduleTask: none, deleteScheduleTask: none,
    async listUnitPrices() { return [] },
    async listUnitCosts() { return [] },
    async listDesignVendors() { return [] },
    async listDesignMaterials() { return [] },
    async listKnowledge() { return [] },
    async listDesignCards() { return [] },
    decideDesignCard: none,
  }
}
