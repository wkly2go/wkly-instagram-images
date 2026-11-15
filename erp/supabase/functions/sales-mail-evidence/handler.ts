// Read-only evidence retrieval. No message mutation, attachment download or sending.
import type {SenderConfig} from '../sales-readiness/handler.ts'
export interface MailTarget {id:string;thread_id:string;emails:string[];reply_to?:string;not_before?:number}
export interface MailJob {mailbox:string;messages:MailTarget[]}
export interface MailEvidence {id:string;status:'retrieved'|'unsupported'|'unavailable'|'mismatch';text:string;truncated:boolean;direction:'inbound'|'outbound'|null}
export interface MailResult {status:'complete'|'partial'|'account_unavailable';messages:MailEvidence[]}
const email=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
const messageId=/^[a-f0-9]{1,32}$/i
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function json(response:Response,limit=32768):Promise<any>{
 if(!response.ok||!response.body)throw new Error('unavailable')
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw new Error('response limit');text+=decoder.decode(part.value,{stream:true})}return JSON.parse(text+decoder.decode())}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock()}
}
// Intentionally accepts only one unambiguous mailbox, not lists/groups/comments.
function address(value:unknown):string|null{
 if(typeof value!=='string'||/[\r\n]/.test(value))return null
 const v=value.trim(),match=v.match(/^[^<>;:@]*<([^<>]+)>$/),candidate=(match?match[1]:v).trim().toLowerCase()
 return candidate.length<=254&&email.test(candidate)?candidate:null
}
export function extractMessage(raw:any,target:MailTarget,mailbox:string,now:number):MailEvidence{
 const empty=(status:MailEvidence['status']):MailEvidence=>({id:target.id,status,text:'',truncated:false,direction:null})
 if(!raw||raw.id!==target.id||raw.threadId!==target.thread_id||!Array.isArray(raw.labelIds)||raw.labelIds.some((l:unknown)=>typeof l!=='string'||['SPAM','TRASH','DRAFT'].includes(l)))return empty('mismatch')
 const timestamp=typeof raw.internalDate==='string'&&/^\d{1,16}$/.test(raw.internalDate)?Number(raw.internalDate):NaN
 if(!Number.isFinite(timestamp)||timestamp>now||timestamp<now-180*86400000)return empty('mismatch')
 const headers=raw.payload?.headers
 if(!Array.isArray(headers)||headers.length>200)return empty('mismatch')
 const header=(name:string)=>headers.filter((h:any)=>typeof h?.name==='string'&&h.name.toLowerCase()===name)
 if(target.reply_to){
  const references=[...header('in-reply-to'),...header('references')].flatMap((h:any)=>typeof h.value==='string'?h.value.match(/<[^<>\s]+>/g)??[]:[])
  if(!references.includes(target.reply_to)||!Number.isFinite(target.not_before)||timestamp<target.not_before!)return empty('mismatch')
  if(raw.labelIds.includes('SENT')||header('auto-submitted').some((h:any)=>typeof h.value!=='string'||h.value.trim().toLowerCase()!=='no')||header('precedence').some((h:any)=>/bulk|list|junk/i.test(h.value??''))||header('list-id').length)return empty('unsupported')
 }
 const from=header('from'),to=header('to')
 if(from.length!==1||to.length!==1)return empty('mismatch')
 const f=address(from[0].value),t=address(to[0].value)
 const direction=f&&target.emails.includes(f)&&t===mailbox?'inbound':f===mailbox&&t&&target.emails.includes(t)?'outbound':null
 if(!direction||target.reply_to&&direction!=='inbound')return empty('mismatch')
 let visited=0,bytes=0,truncated=false,unsupported=false;const texts:string[]=[]
 const visit=(part:any,depth:number)=>{
  if(++visited>60||depth>8){unsupported=true;return}
  if(!part||typeof part!=='object'){unsupported=true;return}
  // Attached and forwarded messages never count as the correspondent's own text.
  const disposition=Array.isArray(part.headers)?part.headers.find((h:any)=>typeof h?.name==='string'&&h.name.toLowerCase()==='content-disposition')?.value:''
  if(part.filename||typeof disposition==='string'&&/^attachment\b/i.test(disposition)||part.mimeType==='message/rfc822')return
  if(part.mimeType==='text/plain'){
   const contentType=Array.isArray(part.headers)?part.headers.find((h:any)=>typeof h?.name==='string'&&h.name.toLowerCase()==='content-type')?.value:''
   const charset=typeof contentType==='string'?contentType.match(/charset\s*=\s*"?([^";\s]+)/i)?.[1]?.toLowerCase():undefined
   if(charset&&!['utf-8','us-ascii'].includes(charset)){unsupported=true;return}
   if(part.body?.attachmentId){unsupported=true;return}
   const data=part.body?.data
   if(typeof data!=='string'||data.length>350000||!/^[A-Za-z0-9_-]*={0,2}$/.test(data)){unsupported=true;return}
   try{const binary=atob(data.replace(/-/g,'+').replace(/_/g,'/'));bytes+=binary.length;if(bytes>262144){unsupported=true;return}
    const value=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim()
    if(value)texts.push(value)
   }catch{unsupported=true}
  }else if(typeof part.mimeType==='string'&&part.mimeType.startsWith('multipart/')&&Array.isArray(part.parts)){
   for(const child of part.parts.slice(0,60))visit(child,depth+1)
   if(part.parts.length>60)unsupported=true
  }else if(part.mimeType!=='text/html')unsupported=true
 }
 visit(raw.payload,0)
 const text=texts.join('\n\n');truncated=text.length>6000||unsupported
 return text?{id:target.id,status:'retrieved',text:text.slice(0,6000),truncated,direction}:empty('unsupported')
}
export async function collectMailEvidence(job:MailJob,config:SenderConfig|null,fetcher:typeof fetch=fetch,now=Date.now()):Promise<MailResult>{
 const failed:MailResult={status:'account_unavailable',messages:[]}
 if(!email.test(job.mailbox)||job.mailbox!==job.mailbox.toLowerCase()||job.messages.length<1||job.messages.length>5||job.messages.some(m=>!messageId.test(m.id)||!messageId.test(m.thread_id)||!m.emails.length||m.emails.length>50||m.emails.some(e=>!email.test(e)||e!==e.toLowerCase())))return failed
 if(job.messages.some(m=>m.reply_to!==undefined&&(!/^<wkly-sales-[0-9a-f-]{36}@[a-z0-9.-]+>$/.test(m.reply_to)||!Number.isFinite(m.not_before)||m.not_before!>now||m.not_before!<now-180*86400000)))return failed
 if(!config?.clientId||!config.clientSecret||!config.refreshToken||config.expectedEmail&&config.expectedEmail.toLowerCase().trim()!==job.mailbox)return failed
 let access:string
 try{
  const token=await json(await fetcher('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'})}))
  const scopes=typeof token.scope==='string'?token.scope.split(/\s+/):[]
  if(typeof token.access_token!=='string'||!token.access_token||/[\r\n]/.test(token.access_token)||typeof token.expires_in!=='number'||token.expires_in<120||!scopes.some((s:string)=>['https://mail.google.com/','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify'].includes(s)))return failed
  access=token.access_token
  const profile=await json(await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile',{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${access}`}}))
  if(typeof profile.emailAddress!=='string'||profile.emailAddress.toLowerCase().trim()!==job.mailbox)return failed
 }catch{return failed}
 const messages:MailEvidence[]=[]
 for(const target of job.messages){
  try{const raw=await json(await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${target.id}?format=full`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${access}`}}),1024*1024);messages.push(extractMessage(raw,target,job.mailbox,now))}
  catch{messages.push({id:target.id,status:'unavailable',text:'',truncated:false,direction:null})}
 }
 return {status:messages.every(m=>m.status==='retrieved'&&!m.truncated)?'complete':'partial',messages}
}
export interface MailDeps {claim:(id:string,token:string)=>Promise<MailJob|null>;config:()=>Promise<SenderConfig|null>;finish:(id:string,result:MailResult)=>Promise<void>;fetcher:typeof fetch;background?:(work:Promise<void>)=>void}
export function createMailEvidenceHandler(d:MailDeps){return async(req:Request)=>{
 if(req.method!=='POST')return new Response('POST only',{status:405})
 let id:string,token:string
 try{const b=await json(new Response(req.body),2048);id=b.id;token=b.token;if(!uuid.test(id??'')||!uuid.test(token??'')||Object.keys(b).some(k=>!['id','token'].includes(k)))throw new Error()}
 catch{return new Response('Invalid request',{status:400})}
 let job:MailJob|null;try{job=await d.claim(id,token)}catch{return new Response('Unavailable',{status:503})}
 if(!job)return new Response('Unauthorized or already claimed',{status:403})
 const work=async()=>{let result:MailResult
  try{result=await collectMailEvidence(job!,await d.config(),d.fetcher)}catch{result={status:'account_unavailable',messages:[]}}
  try{await d.finish(id,result);return Response.json({recorded:true,status:result.status})}catch{return Response.json({recorded:false},{status:503})}
 }
 if(d.background){d.background(work().then(()=>undefined));return Response.json({accepted:true},{status:202})}
 return work()
}}
