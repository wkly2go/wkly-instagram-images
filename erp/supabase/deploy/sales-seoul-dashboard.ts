// Generated from sales-seoul handler/index. SHA256 c609cbd64292aa43422a24cbc8e9886f42d90aeee44e948232ce74a586bb033e
export class SeoulApiError extends Error {}
/** Accept a saved key or the provider's full example URL, never an arbitrary host. */
export function normalizeSeoulApiKey(raw:string|undefined):string|undefined{
 if(!raw)return
 let key=raw.trim().replace(/^(SEOUL_CULTURAL_EVENT_API_KEY|SEOUL_OPEN_DATA_API_KEY)\s*=\s*/,'').trim().replace(/^(['"])(.*)\1$/,'$2')
 if(/^https?:\/\//i.test(key)){
  try{const u=new URL(key);if(u.hostname!=='openapi.seoul.go.kr'||u.username||u.password||!['','8088'].includes(u.port))return;key=decodeURIComponent(u.pathname.split('/')[1]??'')}catch{return}
 }
 if(/^[A-Za-z0-9]{1,128}$/.test(key)&&!['sample','YOURKEY','YOURAPIKEY'].includes(key))return key
}
export interface SeoulApiRow {id:string;title:string;organization:string;category:string;contact:string;district:string;venue:string;start:string;end:string;url:string}
export interface SeoulApiPage {rows:SeoulApiRow[];total:number;scanned:number}
const value=(x:unknown)=>typeof x==='string'?x.trim():''
const day=(x:unknown)=>/^20\d{2}-\d{2}-\d{2}/.test(value(x))?value(x).slice(0,10):''
export function parseSeoulApi(input:unknown,today:string):SeoulApiPage{
 const root=input as {RESULT?:{CODE?:string};culturalEventInfo?:{RESULT?:{CODE?:string};list_total_count?:number;row?:Record<string,unknown>[]}}
 const data=root?.culturalEventInfo,code=data?.RESULT?.CODE??root?.RESULT?.CODE
 if(code==='INFO-200')return {rows:[],total:0,scanned:0}
 if(code!=='INFO-000'||!Array.isArray(data?.row)||!Number.isSafeInteger(data.list_total_count)||Number(data.list_total_count)<0)throw new SeoulApiError('서울시 API 응답 코드 '+(/^(INFO|ERROR)-[0-9]{3}$/.test(code??'')?code:'형식 불일치'))
 const rows=data.row.flatMap(r=>{
  const title=value(r.TITLE),start=day(r.STRTDATE),end=day(r.END_DATE)
  if(!title||!end||end<today)return []
  let url='';for(const raw of [r.ORG_LINK,r.HMPG_ADDR]){try{const u=new URL(value(raw));if(['http:','https:'].includes(u.protocol)&&u.hostname==='culture.seoul.go.kr'&&!u.username&&!u.password&&!u.port){u.protocol='https:';url=u.href;break}}catch{/* missing source link */}}
  const organization=value(r.ORG_NAME),venue=value(r.PLACE)
  const key=url?new URL(url).searchParams.get('cultcode'):null
  return [{id:key?`cultcode:${key}`:[title,start,venue,organization].join('|').slice(0,1000),title:title.slice(0,300),organization:organization.slice(0,300),category:value(r.CODENAME),contact:value(r.INQUIRY).slice(0,1000),district:value(r.GUNAME),venue:venue.slice(0,300),start,end,url}]
 })
 return {rows,total:Number(data.list_total_count),scanned:data.row.length}
}
export interface SeoulWorkerDeps {
 key?:string;fetcher:typeof fetch;now?:()=>Date;
 loadKey?:()=>Promise<string|undefined>;
 claim:(id:string,token:string)=>Promise<boolean>;
 page:(id:string,rows:SeoulApiRow[],fetchedAt:string)=>Promise<void>;
 finish:(id:string,status:string,count:number,scanned:number,total:number,note:string,fetchedAt:string|null)=>Promise<void>;
}
export function createSeoulWorker(d:SeoulWorkerDeps){return async(request:Request)=>{
 if(request.method!=='POST')return new Response('POST only',{status:405})
 let id='',token='';try{if(Number(request.headers.get('content-length'))>2048)throw new Error();const body=await request.text();if(body.length>2048)throw new Error();const x=JSON.parse(body);id=x.runId;token=x.token;if(!/^[0-9a-f-]{36}$/.test(id)||!/^[0-9a-f-]{36}$/.test(token))throw new Error()}catch{return new Response('Invalid request',{status:400})}
 try{if(!await d.claim(id,token))return new Response('Unauthorized or already processed',{status:403})}catch{return new Response('Worker unavailable',{status:503})}
 let step='키 확인',key=d.key;let count=0,scanned=0,total=0;const stamp=(d.now?.()??new Date()).toISOString(),today=new Date(Date.parse(stamp)+9*3600000).toISOString().slice(0,10)
 try{
  if(!key)key=await d.loadKey?.()
  if(!key||!/^[A-Za-z0-9]+$/.test(key))throw new SeoulApiError('서울시 문화행사 API 키의 저장 형식을 확인해 주세요.')
  // The provider publishes this exact HTTP API endpoint. The key stays in the
  // server request and is never returned, logged or forwarded to other hosts.
  // Official specification: OA-15486 culturalEventInfo, <= 1000 rows/request.
  let complete=false;const deadline=Date.now()+100000
  for(let page=0;page<50;page++){
   if(Date.now()>deadline)throw new Error('서울시 API 수집 제한 시간 초과')
   const start=page*1000+1,end=start+999
   const url=`http://openapi.seoul.go.kr:8088/${key}/json/culturalEventInfo/${start}/${end}/`
   step='API 연결';const response=await d.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}})
   if(!response.ok)throw new SeoulApiError('서울시 API HTTP '+response.status)
   step='응답 읽기';const reader=response.body?.getReader();if(!reader)throw new Error('서울시 API 응답 본문이 없습니다.')
   const chunks:Uint8Array[]=[];let size=0
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8*1024*1024)throw new Error('서울시 API 응답 크기를 초과했습니다.');chunks.push(part.value)}}finally{await reader.cancel().catch(()=>undefined)}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
   step='API 응답 해석';const parsed=parseSeoulApi(JSON.parse(new TextDecoder().decode(bytes)),today);total=parsed.total;scanned+=parsed.scanned
   step='페이지 저장';if(parsed.rows.length)await d.page(id,parsed.rows,stamp);count+=parsed.rows.length
   if(end>=total){complete=true;break}
   if(parsed.scanned===0)throw new Error('서울시 API 일부 페이지가 비어 있습니다.')
  }
  step='결과 저장';await d.finish(id,complete?'완료':'일부 수집',count,scanned,total,complete?'서울시 문화행사 공식 API 전체 페이지 조회 · 종료되지 않은 행사 자동 분류':'호출 상한 50,000건 도달 · 전체 조회 미완료',stamp)
  return Response.json({ok:true,count,scanned,total,complete})
 }catch(error){
  // Never forward fetch/URL errors: they can contain the provider credential.
  const note=!key?'서울시 문화행사 API 키 설정 필요':(error instanceof SeoulApiError?error.message:`서울시 공식 API ${step} 실패`)+ ' · 기존 자료 보존 · API 승인/제공기관 상태 확인 필요'
  try{await d.finish(id,'실패',count,scanned,total,note,count?stamp:null)}catch{/* stale-run monitor records an incomplete worker */}
  return Response.json({ok:false,error:note},{status:502})
 }
}}

import {createClient} from 'npm:@supabase/supabase-js@2.117.3'

const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
Deno.serve(createSeoulWorker({
 key:normalizeSeoulApiKey(Deno.env.get('SEOUL_CULTURAL_EVENT_API_KEY'))||normalizeSeoulApiKey(Deno.env.get('SEOUL_OPEN_DATA_API_KEY')),fetcher:fetch,
 loadKey:async()=>normalizeSeoulApiKey(await rpc('sales_seoul_key',{})),
 claim:(id,token)=>rpc('sales_seoul_claim',{p_run:id,p_token:token}),
 page:async(id,rows,stamp)=>{await rpc('sales_seoul_page',{p_run:id,p_rows:rows,p_stamp:stamp})},
 finish:async(id,status,count,scanned,total,note,stamp)=>{await rpc('sales_seoul_finish',{p_run:id,p_status:status,p_count:count,p_scanned:scanned,p_total:total,p_note:note,p_stamp:stamp})},
}))
