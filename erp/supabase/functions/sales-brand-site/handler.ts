// Finds a brand's own website with one web search, then reads that page itself: the site and any
// contact address are saved only when the brand's name and the address are written on the page.
import type {Page} from '../sales-contact-discovery/handler.ts'
export interface BrandSiteJob {id:string;brand:string}
export interface BrandSiteResult {status:'found'|'not_found'|'unavailable';homepage:string;contact_page:string;emails:string[];note:string}
export interface SearchRow {url:string;title:string;description:string}
export interface SearchProvider {name:string;search:(query:string)=>Promise<SearchRow[]>}
export interface BrandSiteDeps {
 /** Search engines tried in order until one yields the brand's own site. */
 providers:SearchProvider[];read:(url:string)=>Promise<Page>;
 claim:(id:string,token:string)=>Promise<BrandSiteJob|null>;
 finish:(id:string,result:BrandSiteResult)=>Promise<void>;
 background?:(work:Promise<void>)=>void;
}
/** Marketplaces, social networks, portals, news and wikis are never a brand's own site. */
const OTHER=/(^|\.)(instagram|facebook|youtube|x|twitter|tiktok|threads|linkedin|pinterest|naver|daum|kakao|tistory|google|coupang|11st|gmarket|auction|ssg|musinsa|29cm|oliveyoung|wikipedia|namu|wadiz|tumblbug|saramin|jobkorea|wanted|greetinghr|catch|blind|brunch|medium|notion|linktr|apple|amazon)\.[a-z.]+$|(news|press|times|daily|ilbo|sinmun|herald|biz|media|journal|tv|magazine|blog|wiki|review)\b|(^|\.)xn--/i
const squash=(v:string)=>v.toLowerCase().replace(/<[^>]*>/g,'').replace(/[\s·.,'"()\[\]㈜]|주식회사|\(주\)/g,'')
function origin(value:unknown):string{
 if(typeof value!=='string'||value.length>1000)return ''
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)||OTHER.test(u.hostname))return '';return 'https://'+u.hostname.toLowerCase()+'/'}catch{return ''}
}
/** Search results are candidates only; at most three distinct sites that mention the brand are tried. */
export function candidates(input:unknown,brand:string):string[]{
 if(!Array.isArray(input))throw new Error('format')
 const key=squash(brand),out:string[]=[]
 for(const r of input as Record<string,unknown>[]){
  const site=origin(r?.url);if(!site||out.includes(site))continue
  if(!squash(String(r?.title??'')+' '+String(r?.description??'')).includes(key))continue
  out.push(site);if(out.length===3)break
 }
 return out
}
/** Sites whose own front-page title, as the search engine shows it, begins with the brand's name. */
export function titled(input:unknown,brand:string):string[]{
 if(!Array.isArray(input))return []
 const key=squash(brand),out:string[]=[]
 for(const r of input as Record<string,unknown>[]){
  const site=origin(r?.url);if(!site||out.includes(site))continue
  try{if(new URL(String(r.url)).pathname!=='/')continue}catch{continue}
  if(key.length>=2&&squash(String(r?.title??'')).startsWith(key))out.push(site)
 }
 return out
}
/** A redirect is followed only while it stays on the same site (the same host, with or without www, or its sub-site). */
export function sameSite(next:string,base:string):boolean{
 try{const a=new URL(next),b=new URL(base);if(a.protocol!=='https:'||a.username||a.password||a.port)return false
  const x=a.hostname.toLowerCase().replace(/^www\./,''),y=b.hostname.toLowerCase().replace(/^www\./,'');return x===y||x.endsWith('.'+y)||y.endsWith('.'+x)}catch{return false}
}
export async function readFollowing(read:(url:string)=>Promise<Page>,start:string):Promise<{page:Page;url:string}>{
 let url=start
 for(let hop=0;;hop++){
  const page=await read(url)
  if(page.status<300||page.status>=400||!page.location||hop===3)return {page,url}
  let next:string;try{next=new URL(page.location,url).href}catch{return {page,url}}
  if(!sameSite(next,start)||next.length>1000)return {page,url}
  url=next
 }
}
function addresses(body:string,host:string):string[]{
 const emails:string[]=[]
 for(const m of body.matchAll(/[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,180}\.[a-z]{2,}/gi)){const e=m[0].toLowerCase();if(!emails.includes(e)&&!/\.(png|jpe?g|gif|svg|webp)$/.test(e)&&!/^(example|your|name|email|test)@|@(example|sentry|wixpress)\./.test(e))emails.push(e);if(emails.length===5)break}
 return emails.filter(e=>e.endsWith('@'+host)||e.endsWith('.'+host)).concat(emails.filter(e=>!(e.endsWith('@'+host)||e.endsWith('.'+host)))).slice(0,3)
}
const text=(html:string)=>html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ')
const meta=(html:string,name:string)=>{for(const m of html.matchAll(/<meta\b[^>]{0,400}>/gi)){if(new RegExp(`(property|name)\\s*=\\s*["']${name}["']`,'i').test(m[0]))return m[0].match(/content\s*=\s*["']([^"']{0,200})["']/i)?.[1]??''}return ''}
/**
 * The site must present itself as the brand's: its name stands in the page title, the site name, the
 * copyright line or (for a Latin name) the address. A page that merely mentions the brand, such as a
 * magazine article list, does not count. Addresses and the contact link come only from what the page shows.
 */
export function inspect(html:string,site:string,brand:string):{named:boolean;contact_page:string;emails:string[];more:string[];thin:boolean}{
 const body=text(html),key=squash(brand),host=new URL(site).hostname.replace(/^www\./,'')
 const identity=[html.match(/<title[^>]*>([^<]{0,200})/i)?.[1]??'',meta(html,'og:site_name'),meta(html,'og:title'),meta(html,'application-name'),...[...body.matchAll(/(?:©|ⓒ|\(c\)|copyright)[^|]{0,80}/gi)].slice(0,3).map(m=>m[0])].join(' ')
 const named=key.length>=2&&(squash(identity).includes(key)||(/^[a-z0-9]{3,}$/.test(key)&&host.replace(/[^a-z0-9]/g,'').includes(key)))
 let contact_page='';const more:string[]=[]
 for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]{1,500})["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)){
  const label=text(m[2])+' '+m[1],contact=/(제휴|입점|협업|비즈니스|파트너|문의|contact|partnership|business|b2b)/i.test(label)
  if(!contact&&!/(회사 ?소개|브랜드 ?소개|고객 ?센터|about|company|support|customer)/i.test(label))continue
  try{const u=new URL(m[1],site);if(u.protocol!=='https:'||u.hostname.replace(/^www\./,'')!==host||u.username||u.port)continue
   u.hash='';const href=u.href.slice(0,500);if(contact&&!contact_page)contact_page=href;if(!more.includes(href)&&u.pathname!=='/')more.push(href)}catch{/* not a link */}
  if(contact_page&&more.length>=4)break
 }
 // Pages worth reading for a public address: the contact page first, then company or support pages.
 return {named,contact_page,emails:addresses(body,host),more:[...(contact_page?[contact_page]:[]),...more.filter(u=>u!==contact_page)].slice(0,2),thin:body.trim().length<1500}
}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
export function createBrandSiteHandler(d:BrandSiteDeps){return async(req:Request)=>{
 if(req.method!=='POST')return new Response('POST only',{status:405})
 let id:string,token:string
 try{const raw=await req.text();if(raw.length>2048)throw new Error();const b=JSON.parse(raw);if(!b||Object.keys(b).some(k=>!['id','token'].includes(k))||!uuid.test(b.id??'')||!uuid.test(b.token??''))throw new Error();id=b.id;token=b.token}catch{return new Response('Invalid job',{status:400})}
 let job:BrandSiteJob|null;try{job=await d.claim(id,token)}catch{return new Response('Unavailable',{status:503})}
 if(!job)return new Response('Not claimed',{status:403})
 const work=async()=>{
  let result:BrandSiteResult={status:'unavailable',homepage:'',contact_page:'',emails:[],note:'검색 미완료 · 다음 예약에서 다시 시도'}
  try{
   if(!d.providers.length){result.note='웹 검색 키 설정 필요'}
   else if(!/^[^\u0000-\u001f]{2,40}$/.test(job!.brand)){result={...result,status:'not_found',note:'브랜드 이름 형식 확인 필요'}}
   else{
    let answered=0,failure=''
    search:for(const provider of d.providers){
     let rows:SearchRow[]
     try{rows=await provider.search(job!.brand+' 공식 홈페이지')}catch(error){const reason=error instanceof Error?error.message:'';failure=`${provider.name} ${reason==='auth'?'검색 키 인증 실패':reason==='quota'?'검색 한도 도달':'검색 응답 실패'}`;continue}
     answered++
     const byTitle=titled(rows,job!.brand)
     for(const site of [...new Set([...candidates(rows,job!.brand),...byTitle])].slice(0,4)){
      let page:Page;try{page=(await readFollowing(d.read,site)).page}catch{continue}
      if(page.status!==200||!page.text)continue
      const seen=inspect(page.text,site,job!.brand)
      // A front page drawn by script shows neither text nor a title; then the title the search engine holds for it decides.
      // A page with a title of its own that lacks the brand (a parked domain, another company) is never accepted this way.
      const untitled=!(page.text.match(/<title[^>]*>([^<]{0,200})/i)?.[1]??'').trim()
      const how=seen.named?'브랜드 이름으로 소개된 자체 사이트 확인':seen.thin&&untitled&&byTitle.includes(site)?'검색 결과의 사이트 제목으로 자체 사이트 확인':''
      if(!how)continue
      const host=new URL(site).hostname.replace(/^www\./,'');let emails=seen.emails,contact_page=seen.contact_page
      // The front page often shows no address: read the contact, company or support page of the same site.
      for(const link of emails.length?[]:seen.more){
       try{const next=(await readFollowing(d.read,link)).page;if(next.status===200&&next.text){emails=addresses(text(next.text),host);if(emails.length)break}}catch{/* next page */}
      }
      result={status:'found',homepage:site,contact_page,emails,note:`${provider.name} 검색 → ${how}`+(emails.length?' · 사이트에 공개된 주소 있음':'')};break search
     }
    }
    if(result.status!=='found')result=answered?{status:'not_found',homepage:'',contact_page:'',emails:[],note:'검색 결과에서 브랜드 자체 사이트를 확인하지 못함'}:{...result,note:failure||result.note}
   }
  }catch{/* controlled note above */}
  for(let attempt=0;attempt<2;attempt++){try{await d.finish(id,result);return true}catch{/* retried once */}}
  return false
 }
 if(d.background){d.background(work().then(()=>undefined));return Response.json({accepted:true},{status:202})}
 const recorded=await work();return Response.json({recorded},{status:recorded?200:503})
}}

const clip=(v:unknown)=>typeof v==='string'?v.slice(0,500):''
async function json(response:Response){
 if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw new Error(response.status===401||response.status===403?'auth':response.status===429?'quota':'upstream')}
 const body=await response.text();if(body.length>2000000)throw new Error('upstream');return JSON.parse(body)
}
const options=(headers:Record<string,string>):RequestInit=>({method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json',...headers}})
/** Each provider calls one fixed official host; keys travel only in request headers and are never logged or returned. */
export const kakaoSearch=(key:string,fetcher:typeof fetch):SearchProvider=>({name:'카카오(다음)',search:async query=>{
 const data=await json(await fetcher('https://dapi.kakao.com/v2/search/web?size=10&query='+encodeURIComponent(query),options({Authorization:'KakaoAK '+key})))
 if(!Array.isArray(data?.documents))throw new Error('upstream');return data.documents.map((r:Record<string,unknown>)=>({url:clip(r.url),title:clip(r.title),description:clip(r.contents)}))
}})
export const naverSearch=(id:string,secret:string,fetcher:typeof fetch):SearchProvider=>({name:'네이버',search:async query=>{
 const data=await json(await fetcher('https://naverapihub.apigw.ntruss.com/search/v1/webkr?display=10&query='+encodeURIComponent(query),options({'X-NCP-APIGW-API-KEY-ID':id,'X-NCP-APIGW-API-KEY':secret})))
 if(!Array.isArray(data?.items))throw new Error('upstream');return data.items.map((r:Record<string,unknown>)=>({url:clip(r.link),title:clip(r.title),description:clip(r.description)}))
}})
/**
 * Google Search through the Gemini API's search grounding. The model's answer is never trusted as a fact:
 * the addresses it names and the sites it cites are only candidates, checked by reading each page.
 */
export const googleSearch=(key:string,fetcher:typeof fetch,model='gemini-3.8-flash'):SearchProvider=>({name:'구글',search:async query=>{
 const response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','x-goog-api-key':key},
  body:JSON.stringify({contents:[{parts:[{text:`${query} 주소를 구글 검색으로 찾아라. 브랜드가 직접 운영하는 사이트의 https 주소만 한 줄에 하나씩 최대 3개 적고, 확인되지 않으면 '없음'이라고만 답하라.`}]}],tools:[{google_search:{}}]})})
 // Google reports a wrong or missing key as 400.
 if(response.status===400){await response.body?.cancel().catch(()=>undefined);throw new Error('auth')}
 const data=await json(response),candidate=data?.candidates?.[0]
 if(!candidate||typeof candidate!=='object')throw new Error('upstream')
 const answer=Array.isArray(candidate.content?.parts)?candidate.content.parts.map((p:{text?:unknown})=>typeof p?.text==='string'?p.text:'').join(' ').slice(0,2000):''
 const rows:SearchRow[]=[]
 for(const m of answer.matchAll(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s)"'<>\]]*/gi))rows.push({url:m[0].slice(0,500),title:query,description:''})
 const chunks=candidate.groundingMetadata?.groundingChunks
 // Cited sources arrive as redirect links whose title is the site's domain.
 if(Array.isArray(chunks))for(const c of chunks){const title=typeof c?.web?.title==='string'?c.web.title.trim().toLowerCase():'';if(/^[a-z0-9.-]+\.[a-z]{2,}$/.test(title))rows.push({url:'https://'+title+'/',title:query,description:''})}
 return rows.slice(0,10)
}})
