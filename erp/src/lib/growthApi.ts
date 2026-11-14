import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './api'
import type { Profile } from './types'
import { validateGrowth, type GrowthApi, type GrowthItem, type GrowthSummary, type AiState } from './growth'
import { newSalesDraft, type SalesApi } from './sales'
import { growthSearchFilter, matchesGrowthSearch } from './growthSearch'
import { reviewSalesCandidate } from './salesCandidateReview'
import { readTenderSearchResult, validateTenderQuery } from './tenderSearch'
const summary = ({ document, ...row }: GrowthItem): GrowthSummary => ({ ...row, ...(row.kind === 'content' ? {} : { sales_review: reviewSalesCandidate({ ...row, source: document.source, segment: document.segment, deadline: document.deadline, qualification: document.qualification }) }) })
const summaryColumns = 'id,kind,title,owner_id,status,campaign_id,linked_sales_id,revision,created_at,updated_at,created_by'
type ReviewSummaryRow = GrowthSummary & { review_source?: unknown; review_segment?: unknown; review_deadline?: unknown; review_qualification?: unknown }
function reviewedSummary(item: ReviewSummaryRow): GrowthSummary {
  const { review_source, review_segment, review_deadline, review_qualification, ...row } = item
  return { ...row, ...(row.kind === 'content' ? {} : { sales_review: reviewSalesCandidate({ ...row, source: review_source, segment: review_segment, deadline: review_deadline, qualification: review_qualification }) }) }
}
function fail(e: { message: string; code?: string } | null, status?: number) {
  if (!e) return
  const message = ['42P01','42883','PGRST202','PGRST205'].includes(e.code ?? '') ? '이 기능의 공용 저장소·서버가 아직 적용되지 않았습니다. 관리자에게 적용 상태를 확인해 주세요.'
    : e.code === '23505' ? '같은 공고번호·차수 또는 연락처가 이미 있습니다. 기존 항목을 검색해 주세요.' : e.message
  // Keep explicit database rejection separate from a lost transport response.
  throw Object.assign(new ApiError(message), { code: e.code, status, uncertain: !e.code && status !== undefined && [0,502,503,504].includes(status) })
}
export function createSupabaseGrowthApi(sb: SupabaseClient): GrowthApi {
  return {
    async instagramContacts(action) {
      const {data,error}=await sb.functions.invoke('instagram-contacts',{body:{action}})
      if(error){let message='인스타그램 연락처 서버 연결·배포 상태를 확인해 주세요.';if(error.context instanceof Response){try{const body=await error.context.clone().json();if(typeof body?.error==='string')message=body.error.slice(0,500)}catch{}}throw new ApiError(message)}
      if(data?.error)throw new ApiError(String(data.error).slice(0,500))
      if(!data||typeof data.hasMore!=='boolean'||(action==='status'&&typeof data.configured!=='boolean')||(action==='sync'&&(!Number.isSafeInteger(data.inserted)||data.inserted<0||!Number.isSafeInteger(data.kept)||data.kept<0)))throw new ApiError('수집 결과를 확인하지 못했습니다. 상태를 다시 확인해 주세요.')
      return data
    },
    async searchTenders(query) {
      const invalid = validateTenderQuery(query); if (invalid) throw new ApiError(invalid)
      const { data, error } = await sb.functions.invoke('g2b-search', { body: query })
      if (error) {
        let message = '나라장터 조회 서버에 연결하지 못했습니다. 관리자에게 함수 배포·API 설정 상태를 확인해 주세요.'
        if (error.context instanceof Response) { try { const body = await error.context.clone().json(); if (typeof body?.error === 'string') message = body.error.slice(0, 500) } catch { /* Keep the controlled connection guidance. */ } }
        throw new ApiError(message)
      }
      if (typeof data?.error === 'string') throw new ApiError(data.error.slice(0, 500))
      return readTenderSearchResult(data)
    },
    async listGrowth(f) {
      const reviewColumns = f.kind === 'contact' ? ',review_source:document->>source,review_segment:document->>segment' : f.kind === 'tender' ? ',review_deadline:document->>deadline,review_qualification:document->>qualification' : ''
      let q=sb.from('growth_items').select(summaryColumns + reviewColumns).eq('kind',f.kind).order('updated_at',{ascending:false}).order('id')
      const search=growthSearchFilter(f.kind,f.search)
      if(search)q=q.or(search)
      if(f.status)q=q.eq('status',f.status)
      const from=Math.max(0,f.page)*30, r=await q.range(from,from+30); fail(r.error)
      return {items:((r.data??[]) as unknown as ReviewSummaryRow[]).slice(0,30).map(reviewedSummary),hasMore:(r.data?.length??0)>30}
    },
    async getGrowth(id){const r=await sb.from('growth_items').select('*').eq('id',id).single().retry(false);fail(r.error,r.status);return r.data as GrowthItem},
    async saveGrowth(id,draft,revision){const submitted=structuredClone(draft),e=validateGrowth(submitted);if(e)throw new ApiError(e);const r=await sb.rpc('growth_save',{p_id:id,p_document:submitted,p_expected_revision:revision}).retry(false);fail(r.error,r.status);return r.data as GrowthItem},
    async linkGrowthSales(id,revision){const r=await sb.rpc('growth_link_sales',{p_id:id,p_expected_revision:revision});fail(r.error);return r.data as string},
    async backfillMailLeads(){const r=await sb.rpc('growth_backfill_mail');fail(r.error);return r.data as number},
    async getAiState(){const results=await Promise.all([sb.from('growth_ai_models').select('*').order('key'),sb.from('growth_ai_budgets').select('*').order('starts_at',{ascending:false}).limit(5),sb.from('growth_ai_usage').select('id,task,status,reserved_usd,actual_usd,created_at').order('created_at',{ascending:false}).limit(100)]);results.forEach(r=>fail(r.error));return {models:results[0].data??[],budgets:results[1].data??[],usage:results[2].data??[]} as AiState},
    async reconcileAi(id,actual,note){const r=await sb.rpc('growth_ai_reconcile',{p_id:id,p_actual:actual,p_note:note});fail(r.error)},
    async configureAi(budget,models){const r=await sb.rpc('growth_ai_configure',{p_budget:budget,p_models:models});fail(r.error)},
    async runGrowthAi(request){
      const {data,error}=await sb.functions.invoke('growth-ai',{body:request})
      if(error){
        let message='AI 실행 결과를 확인하지 못했습니다. 사용 이력에서 상태를 확인하고 같은 요청으로 다시 확인해 주세요.'
        if(error.context instanceof Response){
          try{const body=await error.context.clone().json();if(typeof body?.error==='string')message=body.error.slice(0,500)}catch{ /* 서버 응답을 읽지 못하면 상태 확인 안내를 유지한다. */ }
        }
        throw new ApiError(message)
      }
      if(data?.error)throw new ApiError(data.error)
      return data
    },
  }
}
export function createDemoGrowthApi(viewer:()=>Profile|undefined,sales:SalesApi):GrowthApi {
  const key='wkly-growth-demo-v1', get=():GrowthItem[]=>JSON.parse(localStorage.getItem(key)??'[]')
  const user=()=>{const u=viewer();if(!u?.active)throw new ApiError('로그인이 필요합니다.');return u}
  return {
    async instagramContacts(action){user();if(action==='sync')throw new ApiError('체험 모드에서는 실제 인스타그램을 조회하지 않습니다.');return {configured:false,hasMore:false,lastSyncedAt:null,lastCompletedAt:null}},
    async searchTenders(){user();throw new ApiError('체험 모드에서는 실제 나라장터 공고를 조회하지 않습니다. 운영 계정의 서버 함수·공공데이터포털 API 설정 후 사용할 수 있습니다.')},
    async listGrowth(f){user();const a=get().filter(x=>x.kind===f.kind&&(!f.status||x.status===f.status)&&matchesGrowthSearch(x,f.search)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));return {items:a.slice(f.page*30,f.page*30+30).map(summary),hasMore:a.length>f.page*30+30}},
    async getGrowth(id){user();const r=get().find(x=>x.id===id);if(!r)throw new ApiError('자료를 찾을 수 없습니다.');return r},
    async saveGrowth(id,d,rev){const u=user(),items=get(),old=items.find(x=>x.id===id),e=validateGrowth(d);if(e)throw new ApiError(e);if(u.role!=='admin'&&(d.owner_id!==u.id||(old&&old.owner_id!==u.id)))throw new ApiError('담당자 또는 관리자만 수정할 수 있습니다.');if((old?.revision??0)!==rev)throw new ApiError('다른 작업에서 변경되었습니다. 다시 불러와 주세요.');
      const sk=(x:GrowthItem|typeof d)=>x.kind==='tender'?`${x.document.number}:${x.document.round}`:x.kind==='contact'?(x.document.email?.toLowerCase()||x.document.instagram?.replace(/^@/,'').toLowerCase()):null
      if(sk(d)&&items.some(x=>x.id!==id&&x.kind===d.kind&&sk(x)===sk(d)))throw new ApiError('같은 공고 또는 연락처가 이미 있습니다.')
      for(const v of d.document.versions??[]){const prev=old?.document.versions?.find(x=>x.channel===v.channel);if(['승인','발행'].includes(v.status)){if(!prev||['original','division','source_url'].some(k=>old?.document[k as keyof typeof d.document]!==d.document[k as keyof typeof d.document])||['title','body','tags','rights'].some(k=>prev[k as keyof typeof prev]!==v[k as keyof typeof v]))throw new ApiError('초안으로 저장한 뒤 다시 승인해 주세요.');if(u.role!=='admin'&&!['승인','발행'].includes(prev.status))throw new ApiError('관리자가 승인해야 합니다.')}}
      const now=new Date().toISOString(),saved={...structuredClone(d),id,revision:rev+1,linked_sales_id:old?.linked_sales_id??null,created_by:old?.created_by??u.id,created_at:old?.created_at??now,updated_at:now};localStorage.setItem(key,JSON.stringify([...items.filter(x=>x.id!==id),saved]));return saved},
    async linkGrowthSales(id,rev){const u=user(),items=get(),r=items.find(x=>x.id===id);if(!r||(u.role!=='admin'&&r.owner_id!==u.id))throw new ApiError('담당자 또는 관리자만 연결할 수 있습니다.');if(r.linked_sales_id)return r.linked_sales_id;if(r.revision!==rev)throw new ApiError('다시 불러와 주세요.');if(r.kind==='content'||['제외','취소','종료'].includes(r.status)||(r.kind==='contact'&&r.status!=='확인')||r.document.qualification==='불충족')throw new ApiError('검토·확인한 영업 대상만 연결해 주세요.');const sid=crypto.randomUUID();await sales.saveSales(sid,{...newSalesDraft(r.owner_id),title:r.title,division:r.document.division,source:r.kind==='tender'?'나라장터':'기타',source_url:r.document.source_url,next_action:'대상 확인 및 첫 연락 준비',description:[r.document.note,r.document.agency,r.document.evidence,r.document.email,r.document.instagram].filter(Boolean).join('\n')},0);r.linked_sales_id=sid;r.revision++;localStorage.setItem(key,JSON.stringify(items));return sid},
    async backfillMailLeads(){throw new ApiError('체험 모드에서는 실제 메일을 가져오지 않습니다.')},
    async getAiState(){return {models:[],budgets:[],usage:[]}},
    async reconcileAi(){throw new ApiError('체험 모드에는 실제 과금 내역이 없습니다.')},
    async configureAi(){throw new ApiError('운영 계정에서 서버 연결 후 설정해 주세요.')},
    async runGrowthAi(){throw new ApiError('체험 모드에서는 유료 API를 호출하지 않습니다. 요청문 복사를 사용해 주세요.')},
  }
}
