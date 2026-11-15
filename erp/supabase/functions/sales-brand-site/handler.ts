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
const OTHER=/(^|\.)(instagram|facebook|youtube|x|twitter|tiktok|threads|linkedin|pinterest|naver|daum|kakao|tistory|google|coupang|11st|gmarket|auction|ssg|musinsa|29cm|oliveyoung|wikipedia|namu|wadiz|tumblbug|saramin|jobkorea|wanted|greetinghr|catch|blind|brunch|medium|notion|linktr|apple|amazon)\.[a-z.]+$|(news|press|times|daily|ilbo|sinmun|herald|biz|media|journal|tv)\b/i
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
const text=(html:string)=>html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ')
/** The page must name the brand. Addresses and the contact link are taken only from what the page shows. */
export function inspect(html:string,site:string,brand:string):{named:boolean;contact_page:string;emails:string[]}{
 const body=text(html),named=squash(body+' '+(html.match(/<title[^>]*>([^<]{0,200})/i)?.[1]??'')).includes(squash(brand))
 const host=new URL(site).hostname.replace(/^www\./,''),emails:string[]=[]
 for(const m of body.matchAll(/[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,180}\.[a-z]{2,}/gi)){const e=m[0].toLowerCase();if(!emails.includes(e)&&!/\.(png|jpe?g|gif|svg|webp)$/.test(e)&&!/^(example|your|name|email|test)@|@(example|sentry|wixpress)\./.test(e))emails.push(e);if(emails.length===5)break}
 let contact_page=''
 for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]{1,500})["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)){
  if(!/(제휴|입점|협업|비즈니스|파트너|문의|contact|partnership|business|b2b)/i.test(text(m[2])+' '+m[1]))continue
  try{const u=new URL(m[1],site);if(u.protocol==='https:'&&u.hostname.replace(/^www\./,'')===host&&!u.username&&!u.port){u.hash='';contact_page=u.href.slice(0,500);break}}catch{/* not a link */}
 }
 return {named,contact_page,emails:emails.filter(e=>e.endsWith('@'+host)||e.endsWith('.'+host)).concat(emails.filter(e=>!(e.endsWith('@'+host)||e.endsWith('.'+host)))).slice(0,3)}
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
     for(const site of candidates(rows,job!.brand)){
      let page:Page;try{page=await d.read(site)}catch{continue}
      if(page.status!==200||!page.text)continue
      const seen=inspect(page.text,site,job!.brand);if(!seen.named)continue
      result={status:'found',homepage:site,contact_page:seen.contact_page,emails:seen.emails,note:`${provider.name} 검색 → 브랜드 이름이 적힌 자체 사이트 확인`+(seen.emails.length?' · 사이트에 공개된 주소 있음':'')};break search
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
