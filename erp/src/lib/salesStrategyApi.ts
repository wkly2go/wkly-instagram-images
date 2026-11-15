import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { SalesStrategyApi } from './salesStrategy'
const fail = (e: {message: string; code?: string} | null) => { if (e) throw new ApiError(['PGRST202','42P01'].includes(e.code??'') ? '영업 기획 서버를 준비 중입니다. 기존 자료 검증과 영업 업무는 계속 이용할 수 있습니다.' : e.message) }
export function createSupabaseSalesStrategyApi(sb: SupabaseClient): SalesStrategyApi { return {
  async listSalesStrategies(page) { const r=await sb.rpc('sales_strategies',{p_page:page});fail(r.error);return r.data },
  async requestSalesStrategy(id,feedback) { const r=await sb.rpc('sales_strategy_request',{p_id:id,p_feedback:feedback}).retry(false);fail(r.error);return r.data },
  async decideSalesStrategy(id,revision,decision,feedback) { const r=await sb.rpc('sales_strategy_decide',{p_id:id,p_revision:revision,p_decision:decision,p_feedback:feedback}).retry(false);fail(r.error) },
  async listStrategyTasks(id) { const r=await sb.from('sales_strategy_tasks').select('*').eq('strategy_id',id).order('ordinal');fail(r.error);return r.data??[] },
  async updateStrategyTask(id,revision,status,result) { const r=await sb.rpc('sales_strategy_task_update',{p_id:id,p_revision:revision,p_status:status,p_result:result}).retry(false);fail(r.error) },
  async setSalesStrategyAutomatic(enabled) { const r=await sb.rpc('sales_strategy_automatic',{p_enabled:enabled});fail(r.error) },
} }
export function createDemoSalesStrategyApi(): SalesStrategyApi { const unavailable=async()=>{throw new ApiError('운영 계정에서 AI 영업 기획과 승인을 사용할 수 있습니다.')};return {
  async listSalesStrategies(){return {items:[],total:0,automatic:false}},requestSalesStrategy:unavailable,decideSalesStrategy:unavailable,listStrategyTasks:async()=>[],updateStrategyTask:unavailable,setSalesStrategyAutomatic:unavailable,
} }
