// Meta Instagram webhook: subscription check (GET) and received DMs (POST, signed with the app secret).
// Stores only messages people sent to the company account; echoes of our own messages are skipped.
export interface InboundDm {mid:string;ig_user:string;text:string;timestamp:number;username?:string}
const encoder=new TextEncoder()
function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function same(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
export async function signatureValid(raw:string,header:string|null,secret:string|null){
 if(!secret||!header||!/^sha256=[0-9a-f]{64}$/.test(header))return false
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return same('sha256='+hex(await crypto.subtle.sign('HMAC',key,encoder.encode(raw))),header)
}
export function verifySubscription(url:URL,token:string|null){
 const mode=url.searchParams.get('hub.mode'),given=url.searchParams.get('hub.verify_token'),challenge=url.searchParams.get('hub.challenge')
 if(mode!=='subscribe'||!token||!given||!same(given,token)||!challenge||challenge.length>200||!/^[A-Za-z0-9_-]+$/.test(challenge))return null
 return challenge
}
export function inboundMessages(body:unknown,ownIds:Set<string>=new Set()):InboundDm[]{
 const out:InboundDm[]=[]
 if(!body||typeof body!=='object'||(body as {object?:unknown}).object!=='instagram')return out
 const entries=(body as {entry?:unknown}).entry
 if(!Array.isArray(entries))return out
 for(const entry of entries.slice(0,50)){
  const own=typeof entry?.id==='string'?entry.id:null
  const events=Array.isArray(entry?.messaging)?entry.messaging:[]
  for(const e of events.slice(0,100)){
   const sender=e?.sender?.id,message=e?.message
   if(typeof sender!=='string'||!/^[0-9]{5,30}$/.test(sender)||sender===own||ownIds.has(sender))continue
   if(!message||typeof message!=='object'||message.is_echo||typeof message.mid!=='string'||!message.mid||message.mid.length>300)continue
   const text=typeof message.text==='string'?message.text.slice(0,2000):(Array.isArray(message.attachments)?'(첨부 '+message.attachments.length+'개)':'')
   const timestamp=Number.isFinite(e.timestamp)?Number(e.timestamp):Date.now()
   out.push({mid:message.mid,ig_user:sender,text,timestamp})
  }
 }
 return out.slice(0,100)
}
