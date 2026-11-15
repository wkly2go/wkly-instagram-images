import {g2bDetailUrl,g2bRequestUrl,parseG2bNames,parseG2bResult,validateG2bQuery,type G2bQuery,type G2bCandidate} from '../g2b-search/handler.ts'

export interface G2bJob {category:G2bQuery['category'];keyword:string;startDate:string;endDate:string}
export interface G2bWorkerDeps {
 key?:string;fetcher:typeof fetch;now?:()=>number;
 claim:(id:string,token:string)=>Promise<G2bJob|null>;
 page:(id:string,page:number,rows:G2bCandidate[],total:number,omitted:number,stamp:string)=>Promise<void>;
 finish:(id:string,status:'완료'|'일부 수집'|'실패',note:string)=>Promise<void>;
 background?:(work:Promise<void>)=>void;
}
async function bodyText(body:ReadableStream<Uint8Array>|null,limit:number){
 if(!body)throw new Error('missing body')
 const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text=''
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw new Error('body limit');text+=decoder.decode(part.value,{stream:true})}return text+decoder.decode()}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock()}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Only server-queued searches are accepted; request bodies cannot select URLs or targets. */
export function createG2bWorker(d:G2bWorkerDeps){return async(req:Request)=>{
 if(req.method!=='POST')return new Response('POST only',{status:405})
 let id:string,token:string
 try{const body=JSON.parse(await bodyText(req.body,2048));id=body.id;token=body.token;if(!uuid.test(id??'')||!uuid.test(token??'')||Object.keys(body).some(k=>!['id','token'].includes(k)))throw new Error()}
 catch{return new Response('Invalid request',{status:400})}
 let job:G2bJob|null
 try{job=await d.claim(id,token)}catch{return new Response('Worker unavailable',{status:503})}
 if(!job)return new Response('Unauthorized or already claimed',{status:403})
 const work=async()=>{
 let stage='서버 설정',savedPages=0,omitted=0,total:number|null=null
 // Licence and region limits need one extra lookup each. A run looks up at most 12 limited notices;
 // a notice whose lookup fails keeps its flag without names, and the database marks it for confirmation.
 let lookups=0
 const names=async(kind:'license'|'region',item:G2bCandidate)=>{
  try{const response=await d.fetcher(g2bDetailUrl(kind,item.number,item.round,d.key!.trim()),{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});if(!response.ok)return undefined;return parseG2bNames(JSON.parse(await bodyText(response.body,256*1024)),kind)}
  catch{return undefined}
 }
 const withLimits=async(item:G2bCandidate):Promise<G2bCandidate>=>{
  const terms=item.terms
  if(!terms||(!terms.industry_limited&&!terms.region_limited)||lookups>=12||now()-started>70000)return item
  lookups++
  const [licenses,regions]=await Promise.all([terms.industry_limited?names('license',item):undefined,terms.region_limited?names('region',item):undefined])
  return {...item,terms:{...terms,...(licenses?{licenses}:{}),...(regions?{regions}:{})}}
 }
 const now=d.now??Date.now,started=now(),stamp=new Date(started).toISOString()
 try{
  if(!d.key?.trim())throw new Error('missing key')
  for(let page=1;page<=20;page++){
   stage='제공기관 조회'
   if(now()-started>100000)throw new Error('time limit')
   const query=validateG2bQuery({...job,page})
   const response=await d.fetcher(g2bRequestUrl(query,d.key.trim()),{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}})
   if(!response.ok)throw new Error('upstream')
   stage='응답 검증'
   const result=parseG2bResult(JSON.parse(await bodyText(response.body,2*1024*1024)),query)
   // Changing totals invalidate the page traversal; retain saved pages but do not claim complete coverage.
   if(total!==null&&total!==result.total)throw new Error('changing total')
   total=result.total;omitted+=result.omitted
   stage='참가 조건 조회';const detailed:G2bCandidate[]=[];for(const item of result.items)detailed.push(await withLimits(item))
   const rows=detailed.map(item=>({...item,warnings:[...(!item.deadline?['마감 시각 자동 추가 검증 대상']:[]),...(item.amount===null?['추정가격 자동 추가 검증 대상']:[]),...(!item.source_url?['공고번호로 공식 원문 자동 추가 탐색 대상']:[])]}))
   stage='자료 저장';await d.page(id,page,rows,result.total,result.omitted,stamp);savedPages++
   if(!result.hasMore){
    const partial=result.limited||omitted>0
    stage='결과 기록';await d.finish(id,partial?'일부 수집':'완료',partial?`조회 범위 일부 수집 · 형식 제외 ${omitted}건${result.limited?' · 600건 상한 도달':''} · 시스템 재수집 대상`:'지정 검색어·최근 7일 범위 조회 완료 · 전체 입찰 또는 참가 자격 검증 완료를 의미하지 않음')
    return Response.json({ok:true,complete:!partial,pages:savedPages})
   }
  }
  throw new Error('page limit')
 }catch{
  // Provider failures may contain a service key. Persist only controlled stage names.
  const note=!d.key?.trim()?'나라장터 API 서버 키·활용 승인 연결 필요 · 자료 가공 업무 아님':`나라장터 자동 수집 ${stage} 실패 · 기존 자료 보존 · 다음 예약에서 제한적으로 재수집`
  try{await d.finish(id,savedPages?'일부 수집':'실패',note)}catch{/* Scheduled monitor closes stale jobs. */}
  return Response.json({ok:false,error:note},{status:502})
 }
 }
 if(d.background){d.background(work().then(()=>undefined));return Response.json({accepted:true},{status:202})}
 return await work()
}}
