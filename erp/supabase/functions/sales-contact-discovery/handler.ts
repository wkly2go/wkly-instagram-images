// Website addresses are source candidates, never proof of identity or outreach permission.
export interface HtmlNode {nodeName?:string;tagName?:string;value?:string;attrs?:{name:string;value:string}[];childNodes?:HtmlNode[]}
export type HtmlParser=(html:string)=>HtmlNode
export interface Page {status:number;contentType:string;text:string}
export interface Candidate {email:string;url:string;excerpt:string;role:'partnership'|'general'|'non_sales';domain_match:boolean}
export interface DiscoveryResult {status:'complete'|'partial'|'blocked'|'unavailable';pages:{url:string;status:'read'|'blocked'|'failed'}[];candidates:Candidate[];limited:boolean}
export interface DiscoveryJob {company_id:string;company:string;website:string}
const email=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i
const contactWords=/contact|about|company|partner|business|제휴|문의|회사소개|입점/i
export function sourceUrl(value:string,base?:string):URL|null{
 try{if(typeof value!=='string'||value.length>1500||/[\u0000-\u0020\\]/.test(value))return null
 const u=new URL(value,base)
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||!u.hostname.includes('.')||u.hostname.length>253||!u.hostname.split('.').every(l=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(l))||/^\d+(?:\.\d+)*$/.test(u.hostname)||/\.(?:localhost|local|internal|test|invalid|example|onion)$/i.test(u.hostname))return null
 u.hash='';return u
 }catch{return null}
}
function normalizedPath(path:string){return encodeURI(path).replace(/%25([0-9a-f]{2})/gi,'%$1').replace(/%([0-9a-f]{2})/gi,(all,hex)=>/[A-Za-z0-9._~-]/.test(String.fromCharCode(parseInt(hex,16)))?String.fromCharCode(parseInt(hex,16)):all.toUpperCase())}
export function robotsAllowed(text:string,path:string):boolean{
 const groups:{agents:string[];rules:{allow:boolean;path:string}[];delay:boolean}[]=[];let group:typeof groups[number]|undefined,hasRule=false
 for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
  const line=raw.split('#')[0].trim(),colon=line.indexOf(':');if(colon<0)continue
  const key=line.slice(0,colon).trim().toLowerCase(),value=line.slice(colon+1).trim()
  if(key==='user-agent'){if(!group||hasRule){group={agents:[],rules:[],delay:false};groups.push(group);hasRule=false}group.agents.push(value.toLowerCase())}
  else if(group&&['allow','disallow','crawl-delay'].includes(key)){hasRule=true;if(key==='crawl-delay'){if(Number(value)>0||!Number.isFinite(Number(value)))group.delay=true}else if(value){if(!value.startsWith('/'))return false;group.rules.push({allow:key==='allow',path:value})}}
 }
 const exact=groups.filter(g=>g.agents.includes('wklysalesbot')),selected=exact.length?exact:groups.filter(g=>g.agents.includes('*'))
 if(selected.some(g=>g.delay)||selected.reduce((n,g)=>n+g.rules.length,0)>1000)return false // Delay handling is intentionally unsupported, never ignored.
 let best=-1,allow=true;const requested=normalizedPath(path)
 for(const rule of selected.flatMap(g=>g.rules)){
  const pattern=normalizedPath(rule.path),end=pattern.endsWith('$'),literal=end?pattern.slice(0,-1):pattern
  if(literal.length>2048)return false
  const parts=literal.split('*');let matches=requested.startsWith(parts[0]),position=parts[0].length
  for(let i=1;matches&&i<parts.length;i++){
   const part=parts[i],index=end&&i===parts.length-1?requested.length-part.length:requested.indexOf(part,position)
   if(index<position||!requested.startsWith(part,index))matches=false;else position=index+part.length
  }
  if(parts.length===1&&end&&position!==requested.length)matches=false
  const length=literal.replace(/\*/g,'').length
  if(matches&&(length>best||length===best&&rule.allow)){best=length;allow=rule.allow}
 }
 return allow
}
export function extractPage(html:string,url:string,parse:HtmlParser){
 const root=parse(html),segments:string[]=[],links:{href:string;label:string}[]=[];let nodes=0,limited=false
 const walk=(n:HtmlNode,depth=0):string=>{
  if(++nodes>25000||depth>100){limited=true;return ''}
  const attrs=Object.fromEntries((n.attrs??[]).map(a=>[a.name,a.value]))
  if(['script','style','template','noscript','head','svg'].includes(n.tagName??'')||'hidden' in attrs||attrs['aria-hidden']==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style??''))return ''
  if(n.nodeName==='#text')return n.value??''
  const text=(n.childNodes??[]).map(c=>walk(c,depth+1)).join(' ').replace(/\s+/g,' ').trim()
  if(n.tagName==='a'&&attrs.href)links.push({href:attrs.href,label:text.slice(0,200)})
  if(['p','li','address','td','footer'].includes(n.tagName??'')&&text)segments.push(text.slice(0,5000))
  return text.slice(0,100000)
 }
 const text=walk(root),candidates:Candidate[]=[];const host=new URL(url).hostname.replace(/^www\./,'')
 const add=(address:string,context:string)=>{
  const e=address.toLowerCase();if(!email.test(e)||e.length>254||candidates.some(c=>c.email===e))return
  const position=context.toLowerCase().indexOf(e),quote=context.slice(Math.max(0,position-70),Math.max(0,position-70)+220)
  const role=/privacy|abuse|recruit|career|채용|개인정보|정보보호|webmaster/i.test(quote)?'non_sales':/partner|business|제휴|입점|협업|사업문의/i.test(quote)?'partnership':'general'
  const domain=e.split('@')[1];candidates.push({email:e,url,excerpt:quote,role,domain_match:domain===host})
 }
 for(const link of links){if(/^mailto:/i.test(link.href)){try{const e=decodeURIComponent(link.href.slice(7).split('?')[0]);add(e,segments.find(s=>s.includes(e))??link.label+' '+e)}catch{/* Unsupported address encoding. */}}}
 const matches=[...text.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)].slice(0,100)
 for(const match of matches){const context=segments.find(s=>s.includes(match[0]))??text.slice(Math.max(0,match.index!-80),match.index!+150);add(match[0],context)}
 const paths=links.filter(l=>contactWords.test(l.href+' '+l.label)).map(l=>sourceUrl(l.href,url)).filter((u):u is URL=>!!u&&u.origin===new URL(url).origin).map(u=>u.href)
 return {candidates:candidates.slice(0,10),links:[...new Set(paths)].slice(0,20),limited:limited||candidates.length>10||paths.length>20}
}
export async function discover(job:DiscoveryJob,read:(url:string)=>Promise<Page>,parse:HtmlParser):Promise<DiscoveryResult>{
 const result:DiscoveryResult={status:'unavailable',pages:[],candidates:[],limited:false},seed=sourceUrl(job.website)
 if(!seed){result.status='blocked';return result}
 let robots=''
 try{const r=await read(seed.origin+'/robots.txt');if(r.status===200&&/^text\/plain\b/i.test(r.contentType))robots=r.text;else if(![404,410].includes(r.status)){result.status=r.status>=500||r.status===429?'unavailable':'blocked';return result}}catch{return result}
 const pending=[seed.href],seen=new Set<string>();let failed=false
 while(pending.length&&seen.size<3){const url=pending.shift()!;if(seen.has(url))continue;seen.add(url)
  if(!robotsAllowed(robots,new URL(url).pathname)){result.pages.push({url,status:'blocked'});failed=true;continue}
  try{const page=await read(url)
   if(page.status!==200||!/^text\/html(?:;|$)/i.test(page.contentType))throw new Error('Unsupported response')
   const extracted=extractPage(page.text,url,parse);result.pages.push({url,status:'read'});result.limited ||=extracted.limited
   for(const c of extracted.candidates)if(!result.candidates.some(old=>old.email===c.email)){if(result.candidates.length<10)result.candidates.push(c);else result.limited=true}
   // Follow only links actually found on the starting page, never recursive directory crawling.
   if(url===seed.href)for(const link of extracted.links)if(!seen.has(link)&&!pending.includes(link))pending.push(link)
  }catch{result.pages.push({url,status:'failed'});failed=true}
 }
 result.limited ||= pending.length>0
 result.status=result.pages.some(p=>p.status==='read')?(failed||result.limited?'partial':'complete'):result.pages.some(p=>p.status==='blocked')?'blocked':'unavailable'
 return result
}
export interface DiscoveryDeps {claim:(id:string,token:string)=>Promise<DiscoveryJob|null>;finish:(id:string,result:DiscoveryResult)=>Promise<void>;read:(url:string)=>Promise<Page>;parse:HtmlParser;background?:(work:Promise<void>)=>void}
export function createDiscoveryHandler(d:DiscoveryDeps){return async(req:Request)=>{
 if(req.method!=='POST')return new Response('POST only',{status:405})
 let id:string,token:string;const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
 try{const reader=req.body?.getReader();if(!reader)throw new Error();let text='',size=0;const decoder=new TextDecoder();try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>2048)throw new Error();text+=decoder.decode(p.value,{stream:true})}}finally{await reader.cancel();reader.releaseLock()}const b=JSON.parse(text+decoder.decode());id=b.id;token=b.token;if(!uuid.test(id??'')||!uuid.test(token??'')||Object.keys(b).some(k=>!['id','token'].includes(k)))throw new Error()}catch{return new Response('Invalid request',{status:400})}
 let job:DiscoveryJob|null;try{job=await d.claim(id,token)}catch{return new Response('Unavailable',{status:503})}if(!job)return new Response('Unauthorized or already claimed',{status:403})
 const work=async()=>{let result:DiscoveryResult;try{result=await discover(job!,d.read,d.parse)}catch{result={status:'unavailable',pages:[],candidates:[],limited:false}}try{await d.finish(id,result);return Response.json({recorded:true,status:result.status})}catch{return Response.json({recorded:false},{status:503})}}
 if(d.background){d.background(work().then(()=>undefined));return Response.json({accepted:true},{status:202})}return work()
}}
