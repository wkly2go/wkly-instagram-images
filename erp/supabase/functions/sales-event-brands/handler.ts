// Reads an event's own public page and lists the brands it names as participants or sponsors.
// Names are taken only from list items under a matching heading; nothing is inferred from prose.
import {sourceUrl,robotsAllowed,type HtmlNode,type HtmlParser,type Page} from '../sales-contact-discovery/handler.ts'
export interface Brand {name:string;role:'participant'|'sponsor';url:string;excerpt:string}
export interface EventJob {event_id:string;title:string;url:string}
export interface EventResult {status:'complete'|'partial'|'blocked'|'unavailable'|'no_list';pages:{url:string;status:'read'|'blocked'|'failed'}[];brands:Brand[];limited:boolean}
const participantWords=/참가\s*(업체|기업|브랜드|사|팀|셀러|작가)|참여\s*(업체|기업|브랜드|사|팀|셀러|작가)|입점\s*(업체|브랜드)|라인업|line-?up|exhibitors?|participants?|participating|brands?\b|vendors?|셀러\s*(소개|목록|리스트)|부스\s*(안내|배치|목록)/i
const sponsorWords=/후원|협찬|파트너|sponsors?|partners?/i
const noise=/^(더\s*보기|바로\s*가기|자세히|목록|이전|다음|닫기|신청|예매|문의|홈|home|menu|more|top|로그인|회원가입|공지|전체|검색|share|공유|이미지|image|logo|로고|banner|배너|thumbnail|사진)$/i
const headings=new Set(['h1','h2','h3','h4','h5','h6','dt','caption','summary','legend'])
/** Event pages are often addressed by an id in the query string, so a short plain query is allowed here.
 *  Everything else keeps the shared rules: HTTPS, public host name, no credentials, port or fragment. */
export function eventUrl(value:string,base?:string):URL|null{
 try{if(typeof value!=='string'||value.length>1500||/[\u0000-\u0020\\]/.test(value))return null
  const raw=value.split('#')[0].split('?').slice(1).join('?');if(raw&&!/^[A-Za-z0-9_=&%.+-]{1,255}$/.test(raw))return null
  const u=new URL(value,base),query=u.search;u.search=''
  const safe=sourceUrl(u.href);if(!safe)return null
  if(query&&!/^\?[A-Za-z0-9_=&%.+-]{1,255}$/.test(query))return null
  safe.search=query;return safe
 }catch{return null}
}
export const brandKey=(name:string)=>name.normalize('NFKC').toLowerCase().replace(/\(주\)|㈜|주식회사|\s|[.,·'"()\[\]]/g,'')
/** A brand name is a short label: not a sentence, address, date, price or navigation word. */
export function brandName(raw:string):string|null{
 const name=raw.replace(/\s+/g,' ').trim().replace(/\s*(로고|logo)$/i,'').trim()
 if(name.length<2||name.length>40||noise.test(name)||name.split(' ').length>5)return null
 if(/https?:|www\.|@|[<>{}\\]|\d{4}[.\-/년]|\d{2,3}-\d{3,4}-\d{4}|[0-9,]+\s*원|[.!?。]$|(니다|세요|합니다|입니다|됩니다)$/.test(name))return null
 if(!/[A-Za-z가-힣]/.test(name)||/^[\d\s\-.,:]+$/.test(name)||brandKey(name).length<2)return null
 return name
}
export function extractBrands(html:string,url:string,parse:HtmlParser){
 const root=parse(html),brands:Brand[]=[],links:{href:string;label:string}[]=[];let nodes=0,limited=false
 let section:{role:Brand['role'];heading:string}|null=null
 const add=(raw:string)=>{
  if(!section)return;const name=brandName(raw);if(!name)return
  if(brands.some(b=>brandKey(b.name)===brandKey(name)))return
  if(brands.length>=60){limited=true;return}
  brands.push({name,role:section.role,url,excerpt:`${section.heading.slice(0,120)} · ${name}`.slice(0,220)})
 }
 const walk=(n:HtmlNode,depth=0):string=>{
  if(++nodes>25000||depth>100){limited=true;return ''}
  const tag=n.tagName??'',attrs=Object.fromEntries((n.attrs??[]).map(a=>[a.name,a.value]))
  if(['script','style','template','noscript','head','svg','nav','footer','form'].includes(tag)||'hidden' in attrs||attrs['aria-hidden']==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style??''))return ''
  if(n.nodeName==='#text')return n.value??''
  if(tag==='img'){if(section&&attrs.alt)add(attrs.alt);return ''}
  const leaf=['li','td','dd','figcaption'].includes(tag)
  const text=(n.childNodes??[]).map(c=>walk(c,depth+1)).join(' ').replace(/\s+/g,' ').trim()
  if(headings.has(tag)||tag==='th'&&text.length<=40){
   const role=participantWords.test(text)?'participant':sponsorWords.test(text)?'sponsor':null
   if(headings.has(tag)||role)section=role&&text.length<=120?{role,heading:text}:null
   return text
  }
  if(tag==='a'&&attrs.href)links.push({href:attrs.href,label:text.slice(0,200)})
  if(leaf&&text)add(text)
  return text.slice(0,100000)
 }
 walk(root)
 const paths=links.filter(l=>participantWords.test(l.label)||sponsorWords.test(l.label)).map(l=>eventUrl(l.href,url)).filter((u):u is URL=>!!u&&u.origin===new URL(url).origin).map(u=>u.href)
 return {brands,links:[...new Set(paths)].filter(p=>p!==url).slice(0,20),limited:limited||paths.length>20}
}
export async function research(job:EventJob,read:(url:string)=>Promise<Page>,parse:HtmlParser):Promise<EventResult>{
 const result:EventResult={status:'unavailable',pages:[],brands:[],limited:false},seed=eventUrl(job.url)
 if(!seed){result.status='blocked';return result}
 let robots=''
 try{const r=await read(seed.origin+'/robots.txt');if(r.status===200&&/^text\/plain\b/i.test(r.contentType))robots=r.text;else if(![404,410].includes(r.status)){result.status=r.status>=500||r.status===429?'unavailable':'blocked';return result}}catch{return result}
 const pending=[seed.href],seen=new Set<string>();let failed=false
 while(pending.length&&seen.size<3){const url=pending.shift()!;if(seen.has(url))continue;seen.add(url)
  if(!robotsAllowed(robots,new URL(url).pathname)){result.pages.push({url,status:'blocked'});failed=true;continue}
  try{const page=await read(url)
   if(page.status!==200||!/^text\/html(?:;|$)/i.test(page.contentType))throw new Error('Unsupported response')
   const found=extractBrands(page.text,url,parse);result.pages.push({url,status:'read'});result.limited ||=found.limited
   for(const b of found.brands)if(!result.brands.some(old=>brandKey(old.name)===brandKey(b.name))){if(result.brands.length<60)result.brands.push(b);else result.limited=true}
   // Only links found on the event's starting page are followed; no recursive crawling.
   if(url===seed.href)for(const link of found.links)if(!seen.has(link)&&!pending.includes(link))pending.push(link)
  }catch{result.pages.push({url,status:'failed'});failed=true}
 }
 result.limited ||= pending.length>0
 const read_ok=result.pages.some(p=>p.status==='read')
 result.status=!read_ok?(result.pages.some(p=>p.status==='blocked')?'blocked':'unavailable'):!result.brands.length?(failed?'partial':'no_list'):failed||result.limited?'partial':'complete'
 return result
}
export interface EventDeps {claim:(id:string,token:string)=>Promise<EventJob|null>;finish:(id:string,result:EventResult)=>Promise<void>;read:(url:string)=>Promise<Page>;parse:HtmlParser;background:(work:Promise<void>)=>void}
export function createEventBrandsHandler(d:EventDeps){return async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405})
 let body:{id?:unknown;token?:unknown};try{const text=await req.text();if(text.length>2048)throw new Error();body=JSON.parse(text);if(!body||typeof body!=='object'||Object.keys(body).some(k=>!['id','token'].includes(k)))throw new Error()}catch{return new Response('Bad request',{status:400})}
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
 if(typeof body.id!=='string'||typeof body.token!=='string'||!uuid.test(body.id)||!uuid.test(body.token))return new Response('Bad request',{status:400})
 let job:EventJob|null;try{job=await d.claim(body.id,body.token)}catch{return new Response('Unavailable',{status:503})}if(!job)return new Response('Unauthorized or already claimed',{status:403})
 d.background((async()=>{try{await d.finish(body.id as string,await research(job!,d.read,d.parse))}catch{/* The lease expires and the scheduler retries within its limits. */}})())
 return Response.json({accepted:true},{status:202})
}}
