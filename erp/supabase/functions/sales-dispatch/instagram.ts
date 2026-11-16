// Instagram DM adapter. Only a lease for an approved package reaches it, and the claim has already
// re-checked the 24-hour reply window and opt-outs. A DM carries the approved text only (no attachment).
// One POST at most; a lost response is never resent.
import type {DispatchLease} from './worker.ts'
const recipient=/^ig:([0-9]{5,30})$/
export interface InstagramConfig {enabled:boolean;token:string|null}
async function boundedJson(response:Response):Promise<Record<string,unknown>>{
 const text=(await response.text()).slice(0,32768)
 const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid response');return value
}
export async function transmitInstagram(lease:DispatchLease,signal:AbortSignal,config:InstagramConfig|null,fetcher:typeof fetch=fetch,now:()=>number=Date.now):Promise<{outcome:'accepted';providerId:string}|{outcome:'rejected'}>{
 const rejected={outcome:'rejected' as const}
 const id=recipient.exec(lease.message.recipient)?.[1],text=lease.message.body
 if(!config?.enabled||!config.token||/\s/.test(config.token)||!id||typeof text!=='string'||!text.trim()||text.length>1000)return rejected
 if(signal.aborted||!Number.isFinite(Date.parse(lease.expires_at))||Date.parse(lease.expires_at)<=now())return rejected
 const response=await fetcher('https://graph.instagram.com/v21.0/me/messages',{method:'POST',signal,redirect:'error',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify({recipient:{id},message:{text}})})
 let receipt:Record<string,unknown>
 try{receipt=await boundedJson(response)}catch{if(response.status>=400&&response.status<500)return rejected;throw new Error('Provider acceptance unknown')}
 if(response.ok&&typeof receipt.message_id==='string'&&receipt.message_id.length>0&&receipt.message_id.length<=200&&!/[\r\n\x00-\x1f\x7f]/.test(receipt.message_id))return {outcome:'accepted',providerId:receipt.message_id}
 if(response.status>=400&&response.status<500)return rejected
 throw new Error('Provider acceptance unknown')
}
