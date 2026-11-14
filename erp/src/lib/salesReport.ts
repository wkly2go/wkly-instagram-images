import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
export const ENTITY_KINDS = ['회사','사람','영업 기회','미분류'] as const
export const ASSESSMENTS = ['우선 검토','확인 필요','보류','제외'] as const
export type EntityKind = typeof ENTITY_KINDS[number]
export type Assessment = typeof ASSESSMENTS[number]
export interface SalesProspect {
 id:string; source:string; name:string; entity_kind:EntityKind; organization:string; contact:string; source_url:string; evidence:string;
 source_updated_at:string|null; collected_at:string; created_at:string; linked_sales_id:string|null; client_id:string|null; contact_id:string|null;
 assessment:Assessment; score:number; reasons:string; next_action:string; blocked:boolean; end_date:string|null;
 reviewed_kind:EntityKind|null; reviewed_assessment:Assessment|null; review_note:string; revision:number;
}
export interface CollectionSource {source:string;status:string;count:number;source_at:string|null;note:string;started_at:string;finished_at:string|null}
export interface ReportAction {id:string;name:string;organization:string;assessment:string;score:number;next_action:string;source:string;source_url:string}
export interface SalesReport {
 prospects:SalesProspect[]; total:number; counts:{total:number;companies:number;people:number;new:number;priority:number}; due:number;
 briefing:null|{report_date:string;title:string;summary:string;direction:string;actions:ReportAction[];source_status:CollectionSource[];created_at:string};
 sources:CollectionSource[];pipeline:{stage:string;count:number;amount:number}[];schedules:{name:string;active:boolean;schedule:string}[];
}
export interface ReportFilter {search:string;kind:string;assessment:string;page:number}
export const EMPTY_REPORT:SalesReport={prospects:[],total:0,counts:{total:0,companies:0,people:0,new:0,priority:0},due:0,briefing:null,sources:[],pipeline:[],schedules:[]}
export const effectiveAssessment=(p:SalesProspect):Assessment=>p.blocked?'제외':p.reviewed_assessment??p.assessment
export const effectiveKind=(p:SalesProspect):EntityKind=>p.reviewed_kind??p.entity_kind
export const sourceIsStale=(s:CollectionSource,now=Date.now())=>!s.source_at||!Number.isFinite(Date.parse(s.source_at))||now-Date.parse(s.source_at)>86400000
export interface SalesReportApi {
 getSalesReport(filter:ReportFilter):Promise<SalesReport>;
 collectSalesReport():Promise<void>;
 reviewSalesProspect(id:string,revision:number,kind:EntityKind,assessment:Assessment,note:string):Promise<void>;
 startSalesProspect(id:string):Promise<string>;
}
function fail(error:{code?:string;message:string}|null){if(error)throw new ApiError(['PGRST202','42883','42P01'].includes(error.code??'')?'영업 보고 서버를 준비하고 있습니다. 기존 영업 업무는 아래에서 계속 사용할 수 있습니다.':error.message)}
export function createSupabaseSalesReportApi(sb:SupabaseClient):SalesReportApi{return {
 async getSalesReport(f){const r=await sb.rpc('sales_report',{p_search:f.search,p_kind:f.kind,p_assessment:f.assessment,p_page:f.page});fail(r.error);return r.data as SalesReport},
 async collectSalesReport(){const r=await sb.rpc('sales_collect_now');fail(r.error)},
 async reviewSalesProspect(id,revision,kind,assessment,note){const r=await sb.rpc('sales_prospect_review',{p_id:id,p_revision:revision,p_kind:kind,p_assessment:assessment,p_note:note});fail(r.error)},
 async startSalesProspect(id){const r=await sb.rpc('sales_prospect_start',{p_id:id});fail(r.error);return r.data as string},
}}
export function createDemoSalesReportApi():SalesReportApi{return {
 async getSalesReport(){return structuredClone(EMPTY_REPORT)},
 async collectSalesReport(){throw new ApiError('체험 모드에서는 실제 자동 수집을 실행하지 않습니다.')},
 async reviewSalesProspect(){throw new ApiError('운영 계정에서 분류를 저장해 주세요.')},
 async startSalesProspect(){throw new ApiError('운영 계정에서 영업을 시작해 주세요.')},
}}
