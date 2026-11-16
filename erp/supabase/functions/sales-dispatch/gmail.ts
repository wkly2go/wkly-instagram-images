// Disabled-by-default provider adapter. Only the approval-bound dispatcher may supply a lease.
import type {DispatchLease} from './worker.ts'
import type {SenderConfig} from '../sales-readiness/handler.ts'
import {renderSalesEmailHtml,salesEmailText} from '../../../src/lib/salesEmail.ts'
/** The approved execution plan is shown inside the designed mail, not attached as a file. */
export const INLINE_PROPOSAL='proposal.md'
const email=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const encoder=new TextEncoder()
function b64(text:string){let binary='';for(const byte of encoder.encode(text))binary+=String.fromCharCode(byte);return btoa(binary)}
function foldedBase64(text:string){return b64(text).match(/.{1,76}/g)?.join('\r\n')??''}
function encodedSubject(subject:string){const words:string[]=[];let text='';for(const char of subject){if(encoder.encode(text+char).length>42){words.push('=?UTF-8?B?'+b64(text)+'?=');text=''}text+=char}if(text)words.push('=?UTF-8?B?'+b64(text)+'?=');return words.join('\r\n ')}
export function dispatchMessageId(lease:DispatchLease){if(!uuid.test(lease.id)||!email.test(lease.sender))throw new Error('Invalid lease');return `<wkly-sales-${lease.id.toLowerCase()}@${lease.sender.split('@')[1].toLowerCase()}>`}
export function approvedMime(lease:DispatchLease,sentAt=Date.now()):string{
 if(!email.test(lease.sender)||lease.sender.length>254||!email.test(lease.message.recipient)||lease.message.recipient.length>254||!uuid.test(lease.id)||!lease.message.subject.trim()||lease.message.subject.length>200||/[\x00-\x1f\x7f]/.test(lease.message.subject)||!lease.message.body.trim()||lease.message.body.length>50000||lease.attachments.length>5)throw new Error('Invalid approved material')
 if(!Number.isFinite(new Date(sentAt).getTime()))throw new Error('Invalid message date')
 const boundary='wkly_'+lease.id.toLowerCase(),alt='wkly_alt_'+lease.id.toLowerCase(),names=new Set<string>()
 const proposal=lease.attachments.find(f=>f.name===INLINE_PROPOSAL&&/^text\/(?:plain|markdown)(?:; charset=utf-8)?$/i.test(f.mime))?.content??null
 const text=salesEmailText({body:lease.message.body,proposal}).replace(/\r\n|\r|\n/g,'\r\n')
 const html=renderSalesEmailHtml({subject:lease.message.subject,body:lease.message.body,proposal,sender:lease.sender})
 const lines=[`From: ${lease.sender}`,`To: ${lease.message.recipient}`,`Subject: ${encodedSubject(lease.message.subject)}`,`Message-ID: ${dispatchMessageId(lease)}`,`Date: ${new Date(sentAt).toUTCString()}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,`Content-Type: multipart/alternative; boundary="${alt}"`,'',`--${alt}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',foldedBase64(text),`--${alt}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',foldedBase64(html),`--${alt}--`]
 let total=encoder.encode(lease.message.body).length+encoder.encode(html).length
 for(const file of lease.attachments){
  if(file.name===INLINE_PROPOSAL&&/^text\/(?:plain|markdown)(?:; charset=utf-8)?$/i.test(file.mime)&&typeof file.content==='string'&&file.content.length<=50000){names.add(file.name);continue}
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(file.name)||names.has(file.name)||!/^text\/(?:plain|markdown)(?:; charset=utf-8)?$/i.test(file.mime)||typeof file.content!=='string'||file.content.length>50000)throw new Error('Unsupported approved attachment')
  names.add(file.name);total+=encoder.encode(file.content).length;if(total>400000)throw new Error('Approved material limit')
  lines.push(`--${boundary}`,`Content-Type: ${file.mime}`,`Content-Disposition: attachment; filename="${file.name}"`,'Content-Transfer-Encoding: base64','',foldedBase64(file.content))
 }
 lines.push(`--${boundary}--`,'');return lines.join('\r\n')
}
async function boundedJson(response:Response):Promise<Record<string,unknown>>{
 if(!response.body)throw new Error('Unavailable response')
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0
 try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>32768)throw new Error('Response limit');text+=decoder.decode(p.value,{stream:true})}const value=JSON.parse(text+decoder.decode());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid response');return value}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock()}
}
export interface GmailDispatchConfig extends SenderConfig {enabled:boolean}
/** One POST at most. Lost/malformed responses remain unknown to the caller; never resend. */
export async function transmitGmail(lease:DispatchLease,signal:AbortSignal,config:GmailDispatchConfig|null,fetcher:typeof fetch=fetch,now:()=>number=Date.now):Promise<{outcome:'accepted';providerId:string}|{outcome:'rejected'}>{
 const rejected={outcome:'rejected' as const}
 if(!config?.enabled||!config.clientId||!config.clientSecret||!config.refreshToken||config.expectedEmail&&config.expectedEmail.toLowerCase().trim()!==lease.sender.toLowerCase())return rejected
 let raw:string,access:string
 try{
  raw=b64(approvedMime(lease,now())).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  if(signal.aborted||!Number.isFinite(Date.parse(lease.expires_at))||Date.parse(lease.expires_at)<=now())return rejected
  const tokenResponse=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',signal,redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'})})
  const token=await boundedJson(tokenResponse),scopes=typeof token.scope==='string'?token.scope.split(/\s+/):[]
  if(!tokenResponse.ok||typeof token.access_token!=='string'||!token.access_token||/[\r\n]/.test(token.access_token)||typeof token.expires_in!=='number'||!Number.isFinite(token.expires_in)||token.expires_in<60||!scopes.some(s=>['https://mail.google.com/','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.compose','https://www.googleapis.com/auth/gmail.modify'].includes(s)))return rejected
  access=token.access_token
  // A send-only grant cannot establish the mailbox profile; fail closed without expansion.
  const profileResponse=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile',{method:'GET',signal,redirect:'error',headers:{Authorization:`Bearer ${access}`}})
  const profile=await boundedJson(profileResponse)
  if(!profileResponse.ok||typeof profile.emailAddress!=='string'||profile.emailAddress.trim().toLowerCase()!==lease.sender.toLowerCase()||signal.aborted||Date.parse(lease.expires_at)<=now())return rejected
 }catch{return rejected} // No send attempt has happened yet.
 const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',signal,redirect:'error',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({raw})})
 const receipt=await boundedJson(response)
 if(response.ok&&typeof receipt.id==='string'&&/^[a-f0-9]{1,32}$/i.test(receipt.id)&&typeof receipt.threadId==='string'&&/^[a-f0-9]{1,32}$/i.test(receipt.threadId))return {outcome:'accepted',providerId:receipt.id}
 if([400,401,403,404,413,422,429].includes(response.status)&&receipt.error&&typeof receipt.error==='object')return rejected
 throw new Error('Provider acceptance unknown')
}
