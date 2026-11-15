// Collects recent news about pop-ups, festivals and fairs from the official NAVER API HUB search.
// Only server-queued keywords are searched; the request body cannot choose a query or a host.
export interface NewsRow {id:string;title:string;summary:string;url:string;published:string}
export interface NewsJob {keyword:string;days:number}
export interface NewsWorkerDeps {
 id?:string;secret?:string;fetcher:typeof fetch;now?:()=>number;
 claim:(id:string,token:string)=>Promise<NewsJob|null>;
 save:(id:string,rows:NewsRow[],total:number,stamp:string)=>Promise<void>;
 finish:(id:string,status:'완료'|'일부 수집'|'실패',note:string)=>Promise<void>;
 background?:(work:Promise<void>)=>void;
}
const ENTITY:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}
/** Search results mark the matched words with tags and escape punctuation. */
export function plain(value:unknown,limit:number):string{
 if(typeof value!=='string')return ''
 return value.replace(/<[^>]{0,200}>/g,'').replace(/&(#\d{1,6}|#x[0-9a-f]{1,6}|[a-z]{2,6});/gi,(all,code:string)=>{
  if(code[0]!=='#')return ENTITY[code.toLowerCase()]??all
  const n=code[1]==='x'||code[1]==='X'?parseInt(code.slice(2),16):parseInt(code.slice(1),10)
  return n>31&&n<0x110000&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' '
 }).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit)
}
function link(value:unknown):string{
 if(typeof value!=='string'||value.length>1000)return ''
 try{const u=new URL(value.trim());if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.'))return '';u.hash='';return u.href}catch{return ''}
}
async function digest(text:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))
 return Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('')
}
/** Keeps dated articles inside the window that still mention the searched topic. */
export async function parseNews(input:unknown,job:NewsJob,now:number):Promise<{rows:NewsRow[];total:number;scanned:number}>{
 const root=input as {total?:unknown;items?:unknown}
 if(!root||!Array.isArray(root.items)||!Number.isSafeInteger(root.total)||Number(root.total)<0)throw new Error('format')
 const since=now-job.days*86400000,seen=new Set<string>(),rows:NewsRow[]=[]
 for(const raw of root.items as Record<string,unknown>[]){
  const title=plain(raw?.title,200),url=link(raw?.originallink)||link(raw?.link),at=Date.parse(typeof raw?.pubDate==='string'?raw.pubDate:'')
  if(!title||!url||!Number.isFinite(at)||at<since||at>now+3600000||seen.has(url))continue
  seen.add(url);rows.push({id:await digest(url),title,summary:plain(raw?.description,500),url,published:new Date(at).toISOString()})
 }
 return {rows,total:Number(root.total),scanned:root.items.length}
}
/** Newest articles per keyword. Kept small until brands are extracted automatically. */
export const PAGE=30
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function createNewsWorker(d:NewsWorkerDeps){return async(req:Request)=>{
 if(req.method!=='POST')return new Response('POST only',{status:405})
 let id='',token=''
 try{if(Number(req.headers.get('content-length'))>2048)throw new Error();const text=await req.text();if(text.length>2048)throw new Error();const body=JSON.parse(text);id=body.id;token=body.token;if(!uuid.test(id??'')||!uuid.test(token??'')||Object.keys(body).some(k=>!['id','token'].includes(k)))throw new Error()}
 catch{return new Response('Invalid request',{status:400})}
 let job:NewsJob|null
 try{job=await d.claim(id,token)}catch{return new Response('Worker unavailable',{status:503})}
 if(!job)return new Response('Unauthorized or already claimed',{status:403})
 const work=async()=>{
  let stage='서버 설정';const now=(d.now??Date.now)(),stamp=new Date(now).toISOString()
  try{
   const key=d.id?.trim(),secret=d.secret?.trim()
   if(!key||!secret)throw new Error('missing key')
   if(!/^[^\u0000-\u001f]{1,40}$/.test(job!.keyword)||!Number.isInteger(job!.days)||job!.days<1||job!.days>14)throw new Error('job')
   stage='제공기관 조회'
   // Fixed official host. Keys travel only in these request headers and are never logged or returned.
   const url='https://naverapihub.apigw.ntruss.com/search/v1/news?query='+encodeURIComponent(job!.keyword)+'&display='+PAGE+'&start=1&sort=date'
   const response=await d.fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json','X-NCP-APIGW-API-KEY-ID':key,'X-NCP-APIGW-API-KEY':secret}})
   if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw new Error(response.status===401?'auth':response.status===429?'quota':'upstream')}
   stage='응답 검증'
   const text=await response.text();if(text.length>1500000)throw new Error('size')
   const parsed=await parseNews(JSON.parse(text),job!,now)
   stage='자료 저장';await d.save(id,parsed.rows,parsed.total,stamp)
   // One page of the newest articles: older matches in the window may be missing on busy topics.
   const partial=parsed.scanned>=PAGE&&parsed.rows.length===parsed.scanned
   stage='결과 기록';await d.finish(id,partial?'일부 수집':'완료',`네이버 뉴스 검색 · 최근 ${job!.days}일 · 조회 ${parsed.scanned}건 중 ${parsed.rows.length}건 저장`+(partial?` · 최신 ${PAGE}건 상한 도달`:'')+' · 보도 내용은 영업 전 원문 확인 대상')
   return Response.json({ok:true,count:parsed.rows.length})
  }catch(error){
   const reason=error instanceof Error?error.message:''
   const note=reason==='missing key'?'네이버 검색 API 키 설정 필요':reason==='auth'?'네이버 검색 API 인증 실패 · 뉴스 검색 권한 확인 필요':reason==='quota'?'네이버 검색 API 일일 한도 도달 · 내일 다시 수집':`네이버 뉴스 수집 ${stage} 실패 · 기존 자료 보존 · 다음 예약에서 다시 수집`
   try{await d.finish(id,'실패',note)}catch{/* The scheduled monitor closes stale runs. */}
   return Response.json({ok:false,error:note},{status:502})
  }
 }
 if(d.background){d.background(work().then(()=>undefined));return Response.json({accepted:true},{status:202})}
 return await work()
}}
