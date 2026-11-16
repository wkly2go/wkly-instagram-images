import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { SalesStrategyApi } from './salesStrategy'
const fail = (e: {message: string; code?: string} | null) => { if (e) throw new ApiError(['PGRST202','42P01'].includes(e.code??'') ? '영업 기획 서버를 준비 중입니다. 기존 자료 검증과 영업 업무는 계속 이용할 수 있습니다.' : e.message) }
export function createSupabaseSalesStrategyApi(sb: SupabaseClient): SalesStrategyApi { return {
  async getSalesExecution(strategyId){const r=await sb.rpc('sales_execution_get',{p_id:strategyId});fail(r.error);return r.data},
  async refreshSalesSender(){const r=await sb.functions.invoke('sales-readiness',{body:{}});if(r.error)throw new ApiError('발신 계정 진단 서버를 확인하지 못했습니다. 운영 연결 상태 확인이 필요합니다.');if(r.data?.error)throw new ApiError(String(r.data.error))},
  async decideSalesExecution(id,version,fingerprint,decision){const r=await sb.rpc('sales_execution_decide',{p_id:id,p_version:version,p_fingerprint:fingerprint,p_decision:decision}).retry(false);fail(r.error)},
  async listSalesDesk(before){const r=await sb.rpc('sales_desk_list',{p_before:before});fail(r.error);if(!Array.isArray(r.data))throw new ApiError('영업 대화 기록을 확인하지 못했습니다.');return r.data},
  async submitSalesDesk(id,agent,action,instruction){const r=await sb.rpc('sales_desk_submit',{p_id:id,p_agent:agent,p_action:action,p_instruction:instruction}).retry(false);fail(r.error);return r.data},
  async listSalesStrategies(page) { const r=await sb.rpc('sales_strategies',{p_page:page});fail(r.error);return r.data },
  async getSalesEventBrands() { const r=await sb.rpc('sales_event_brands_overview');fail(r.error);return r.data },
  async requestSalesStrategy(id,feedback) { const r=await sb.rpc('sales_strategy_request',{p_id:id,p_feedback:feedback}).retry(false);fail(r.error);return r.data },
  async decideSalesStrategy(id,revision,decision,feedback) { const r=await sb.rpc('sales_strategy_decide',{p_id:id,p_revision:revision,p_decision:decision,p_feedback:feedback}).retry(false);fail(r.error) },
  async listStrategyTasks(id) { const r=await sb.from('sales_strategy_tasks').select('*').eq('strategy_id',id).order('ordinal');fail(r.error);return r.data??[] },
  async updateStrategyTask(id,revision,status,result) { const r=await sb.rpc('sales_strategy_task_update',{p_id:id,p_revision:revision,p_status:status,p_result:result}).retry(false);fail(r.error) },
  async setSalesStrategyAutomatic(enabled) { const r=await sb.rpc('sales_strategy_automatic',{p_enabled:enabled});fail(r.error) },
  // The proposals table may not exist yet on a server that has not received this release: show nothing then.
  async listSalesMethodProposals() { const r=await sb.from('sales_method_proposals').select('id,action,name,signal,offer,first_step,reason,created_at').eq('status','승인 대기').order('created_at').limit(4);if(r.error&&['42P01','PGRST205'].includes(r.error.code??''))return [];fail(r.error);return r.data??[] },
  async listBidQualifications() { const r=await sb.from('sales_bid_qualifications').select('kind,name,status').order('kind').order('name').limit(200);if(r.error&&['42P01','PGRST205'].includes(r.error.code??''))return [];fail(r.error);return r.data??[] },
  async setBidQualification(kind,name,status) { const r=await sb.rpc('sales_bid_qualification_set',{p_kind:kind,p_name:name,p_status:status}).retry(false);fail(r.error) },
  async getRecipientScope() { const r=await sb.rpc('sales_recipient_scope_get');if(r.error&&['PGRST202','42883'].includes(r.error.code??''))return '미정';fail(r.error);return r.data??'미정' },
  async setRecipientScope(scope) { const r=await sb.rpc('sales_recipient_scope_set',{p_scope:scope}).retry(false);fail(r.error) },
  async approveSalesStrategyAndExecute(id,revision,packageId,version,fingerprint) { const r=await sb.rpc('sales_strategy_approve_execute',{p_id:id,p_revision:revision,p_package:packageId,p_version:version,p_fingerprint:fingerprint}).retry(false);fail(r.error);return String(r.data??'') },
  async getAdAudienceByPurpose() { const r=await sb.rpc('sales_ad_audience_by_purpose');if(r.error&&['PGRST202','42883'].includes(r.error.code??''))return [];fail(r.error);return r.data??[] },
  async getAdAudience() { const r=await sb.rpc('sales_ad_audience');fail(r.error);return r.data??[] },
  async decideSalesMethodProposal(id,decision) { const r=await sb.rpc('sales_method_decide',{p_id:id,p_decision:decision}).retry(false);fail(r.error) },
} }
export function createDemoSalesStrategyApi(): SalesStrategyApi { const unavailable=async()=>{throw new ApiError('운영 계정에서 AI 영업 기획과 승인을 사용할 수 있습니다.')};return {
  getSalesExecution:async()=>null,decideSalesExecution:unavailable,
  listSalesDesk:async()=>[],submitSalesDesk:unavailable,
  async listSalesStrategies(){return {items:[],total:0,automatic:false}},requestSalesStrategy:unavailable,getSalesEventBrands:async()=>({scope:'',brand_total:0,events:[]}),decideSalesStrategy:unavailable,listStrategyTasks:async()=>[],updateStrategyTask:unavailable,setSalesStrategyAutomatic:unavailable,listSalesMethodProposals:async()=>[],decideSalesMethodProposal:unavailable,listBidQualifications:async()=>[],setBidQualification:unavailable,getAdAudience:unavailable,getAdAudienceByPurpose:unavailable,approveSalesStrategyAndExecute:unavailable,getRecipientScope:async()=>'미정' as const,setRecipientScope:unavailable,
} }
