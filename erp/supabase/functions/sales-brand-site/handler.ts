// Finds a brand's own website with one web search, then reads that page itself: the site and any
// contact address are saved only when the brand's name and the address are written on the page.
import type {Page} from '../sales-contact-discovery/handler.ts'
export interface BrandSiteJob {id:string;brand:string}
export interface BrandSiteResult {status:'found'|'not_found'|'unavailable';homepage:string;contact_page:string;emails:string[];note:string}
export interface BrandSiteDeps {
 key?:string;fetcher:typeof fetch;read:(url:string)=>Promise<Page>;
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
 const rows=(input as {web?:{results?:unknown}})?.web?.results;if(!Array.isArray(rows))throw new Error('format')
 const key=squash(brand),out:string[]=[]
 for(const r of rows as Record<string,unknown>[]){
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
   const key=d.key?.trim();if(!key){result.note='웹 검색 키 설정 필요'}
   else if(!/^[^\u0000-\u001f]{2,40}$/.test(job!.brand)){result={...result,status:'not_found',note:'브랜드 이름 형식 확인 필요'}}
   else{
    // Fixed official host; the key travels only in this header and is never logged or returned.
    const response=await d.fetcher('https://api.search.brave.com/res/v1/web/search?q='+encodeURIComponent(job!.brand+' 공식 홈페이지')+'&count=10&country=KR&search_lang=ko',{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json','X-Subscription-Token':key}})
    if(!response.ok){await response.body?.cancel().catch(()=>undefined);result.note=response.status===401||response.status===403?'웹 검색 키 인증 실패':response.status===429?'웹 검색 무료 한도 도달 · 다음 달 또는 한도 조정 후 재개':'웹 검색 응답 실패'}
    else{
     const body=await response.text();if(body.length>2000000)throw new Error('size')
     result={status:'not_found',homepage:'',contact_page:'',emails:[],note:'검색 결과에서 브랜드 자체 사이트를 확인하지 못함'}
     for(const site of candidates(JSON.parse(body),job!.brand)){
      let page:Page;try{page=await d.read(site)}catch{continue}
      if(page.status!==200||!page.text)continue
      const seen=inspect(page.text,site,job!.brand);if(!seen.named)continue
      result={status:'found',homepage:site,contact_page:seen.contact_page,emails:seen.emails,note:'브랜드 이름이 적힌 자체 사이트 확인'+(seen.emails.length?' · 사이트에 공개된 주소 있음':'')};break
     }
    }
   }
  }catch{/* controlled note above */}
  for(let attempt=0;attempt<2;attempt++){try{await d.finish(id,result);return true}catch{/* retried once */}}
  return false
 }
 if(d.background){d.background(work().then(()=>undefined));return Response.json({accepted:true},{status:202})}
 const recorded=await work();return Response.json({recorded},{status:recorded?200:503})
}}
