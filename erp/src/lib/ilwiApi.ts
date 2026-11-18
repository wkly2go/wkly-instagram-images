import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { IlwiApi, IlwiItem, IlwiLine, LaborRate } from './ilwi'

const fail = (e: { message: string; code?: string } | null) => {
  if (!e) return
  if (['PGRST202', 'PGRST205', '42P01'].includes(e.code ?? '')) throw new ApiError('일위대가 서버를 준비 중입니다. 잠시 뒤 다시 열어 주세요.')
  if (e.code === '42501') throw new ApiError('일위대가는 관리자만 고칠 수 있습니다.')
  if (e.code === '23505') throw new ApiError('같은 번호의 항목이 이미 있습니다. 번호를 바꿔 주세요.')
  throw new ApiError(e.message)
}
const num = (v: unknown) => (v == null ? null : Number(v))

export function createSupabaseIlwiApi(sb: SupabaseClient): IlwiApi {
  return {
    async listIlwiItems() {
      const r = await sb.from('design_ilwi_items').select('*').order('code')
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return (r.data ?? []).map(x => ({ ...x, material: Number(x.material), labor: Number(x.labor), expense: Number(x.expense), total: Number(x.total), lines: Number(x.lines), missing: Number(x.missing) })) as IlwiItem[]
    },
    async listIlwiLines(itemId) {
      const r = await sb.from('design_ilwi_lines').select('*').eq('item_id', itemId).order('sort').order('id')
      fail(r.error)
      return (r.data ?? []).map(x => ({ ...x, qty: Number(x.qty), unit_price: num(x.unit_price), pct: num(x.pct), price: num(x.price), amount: num(x.amount) })) as IlwiLine[]
    },
    async saveIlwiItem(id, draft) {
      const row = { ...draft, code: draft.code.trim(), name: draft.name.trim(), updated_at: new Date().toISOString() }
      const r = id ? await sb.from('design_ilwi_item_rows').update(row).eq('id', id).select('id').single() : await sb.from('design_ilwi_item_rows').insert(row).select('id').single()
      fail(r.error)
      return String(r.data?.id)
    },
    async deleteIlwiItem(id) { fail((await sb.from('design_ilwi_item_rows').delete().eq('id', id)).error) },
    async addIlwiLines(rows) {
      if (!rows.length) return
      const base = Math.floor(Date.now() / 1000) % 100000000
      fail((await sb.from('design_ilwi_line_rows').insert(rows.map((x, i) => ({ ...x, sort: base + i })))).error)
    },
    async updateIlwiLine(id, patch) { fail((await sb.from('design_ilwi_line_rows').update(patch).eq('id', id)).error) },
    async deleteIlwiLine(id) { fail((await sb.from('design_ilwi_line_rows').delete().eq('id', id)).error) },
    async listLaborRates() {
      const r = await sb.from('design_labor_rates').select('code,name,wage,as_of,low_sample,source').order('code')
      if (r.error && ['42P01', 'PGRST205'].includes(r.error.code ?? '')) return []
      fail(r.error)
      return (r.data ?? []).map(x => ({ ...x, wage: Number(x.wage) })) as LaborRate[]
    },
  }
}

/** 체험 모드에는 자료를 두지 않는다 (대표 지시 '목업은 올리지 마') */
export function createDemoIlwiApi(): IlwiApi {
  const none = async () => { throw new ApiError('체험 모드에서는 일위대가를 고칠 수 없습니다.') }
  return { async listIlwiItems() { return [] }, async listIlwiLines() { return [] }, saveIlwiItem: none, deleteIlwiItem: none, addIlwiLines: none, updateIlwiLine: none, deleteIlwiLine: none, async listLaborRates() { return [] } }
}
