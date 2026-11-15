import {sourceUrl,robotsAllowed,type HtmlNode,type HtmlParser,type Page} from '../sales-contact-discovery/handler.ts'
export interface ResearchJob {website:string;questions:string[]}
export interface ResearchResult {status:'complete'|'partial'|'blocked'|'unavailable';pages:{url:string;status:'read'|'blocked'|'failed';excerpt:string}[];limited:boolean}
const relevant=/about|service|business|company|event|news|product|space|venue|popup|행사|서비스|사업|소개|공간|대관|제품|팝업/i
export function researchPage(html:string,url:string,questions:string[],parse:HtmlParser){
 const blocks:string[]=[],links:string[]=[];let count=0,limited=false
 const walk=(n:HtmlNode,depth=0):string=>{
  if(++count>25000||depth>100){limited=true;return ''}
  const attrs=Object.fromEntries((n.attrs??[]).map(a=>[a.name,a.value]))
  if(['script','style','head','noscript','template','svg','nav','footer','form'].includes(n.tagName??'')||'hidden' in attrs||attrs['aria-hidden']==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style??''))return ''
  if(n.nodeName==='#text')return n.value??''
  const text=(n.childNodes??[]).map(c=>walk(c,depth+1)).join(' ').replace(/\s+/g,' ').trim().slice(0,100000)
  if(['p','li','h1','h2','h3','td'].includes(n.tagName??'')&&text)blocks.push(text.slice(0,2000))
  if(n.tagName==='a'&&attrs.href&&relevant.test(attrs.href+' '+text)){const link=sourceUrl(attrs.href,url);if(link&&link.origin===new URL(url).origin)links.push(link.href)}
  return text
 }
 const full=walk(parse(html)),terms=[...new Set(questions.join(' ').toLowerCase().split(/[^a-z0-9가-힣]+/).filter(t=>t.length>=2&&t.length<=24&&!['미확인','확인','필요','자료','일정은','정보'].includes(t)))].slice(0,12)
 const ranked=[...new Set(blocks)].map((text,index)=>({text,index,score:terms.filter(t=>text.toLowerCase().includes(t)).length})).sort((a,b)=>b.score-a.score||a.index-b.index)
 const excerpt=(ranked.length?ranked.slice(0,3).map(b=>b.text).join('\n'):full).slice(0,1200)
 return {excerpt,links:[...new Set(links)].slice(0,12),limited:limited||full.length>1200||links.length>12}
}
export async function research(job:ResearchJob,read:(url:string)=>Promise<Page>,parse:HtmlParser):Promise<ResearchResult>{
 const result:ResearchResult={status:'unavailable',pages:[],limited:false},seed=sourceUrl(job.website)
 if(!seed||!Array.isArray(job.questions)||job.questions.length>6||job.questions.some(q=>typeof q!=='string'||q.length>300)){result.status='blocked';return result}
 let robots=''
 try{const r=await read(seed.origin+'/robots.txt');if(r.status===200&&/^text\/plain\b/i.test(r.contentType))robots=r.text;else if(![404,410].includes(r.status)){result.status=r.status>=500||r.status===429?'unavailable':'blocked';return result}}catch{return result}
 const pending=[seed.href],seen=new Set<string>();let failed=false
 while(pending.length&&seen.size<3){const url=pending.shift()!;if(seen.has(url))continue;seen.add(url)
  if(!robotsAllowed(robots,new URL(url).pathname)){result.pages.push({url,status:'blocked',excerpt:''});failed=true;continue}
  try{const response=await read(url);if(response.status!==200||!/^text\/html(?:;|$)/i.test(response.contentType))throw new Error()
   const page=researchPage(response.text,url,job.questions,parse);result.pages.push({url,status:'read',excerpt:page.excerpt});result.limited ||= page.limited
   if(url===seed.href)for(const link of page.links)if(!seen.has(link)&&!pending.includes(link))pending.push(link)
  }catch{result.pages.push({url,status:'failed',excerpt:''});failed=true}
 }
 result.limited ||= pending.length>0
 result.status=result.pages.some(p=>p.status==='read')?(failed||result.limited?'partial':'complete'):result.pages.some(p=>p.status==='blocked')?'blocked':'unavailable'
 return result
}
export interface ResearchDeps {claim:(id:string,token:string)=>Promise<ResearchJob|null>;finish:(id:string,result:ResearchResult)=>Promise<void>;read:(url:string)=>Promise<Page>;parse:HtmlParser;background?:(work:Promise<void>)=>void}
export function createResearchHandler(d:ResearchDeps){return async(req:Request)=>{
 if(req.method!=='POST')return new Response('POST only',{status:405})
 let id:string,token:string
 try{const reader=req.body?.getReader();if(!reader)throw new Error();let raw='',size=0;const decoder=new TextDecoder();try{for(;;){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>2048)throw new Error();raw+=decoder.decode(c.value,{stream:true})}}finally{await reader.cancel();reader.releaseLock()}const b=JSON.parse(raw+decoder.decode()),uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;if(!b||Object.keys(b).some(k=>!['id','token'].includes(k))||!uuid.test(b.id??'')||!uuid.test(b.token??''))throw new Error();id=b.id;token=b.token}catch{return new Response('Invalid request',{status:400})}
 let job:ResearchJob|null;try{job=await d.claim(id,token)}catch{return new Response('Unavailable',{status:503})}if(!job)return new Response('Not claimed',{status:403})
 const work=async()=>{let result:ResearchResult;try{result=await research(job!,d.read,d.parse)}catch{result={status:'unavailable',pages:[],limited:false}}for(let i=0;i<2;i++){try{await d.finish(id,result);return Response.json({recorded:true})}catch{}}return Response.json({recorded:false},{status:503})}
 if(d.background){d.background(work().then(()=>undefined));return Response.json({accepted:true},{status:202})}return work()
}}
