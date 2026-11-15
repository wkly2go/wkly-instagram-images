// Diagnostic only: refresh existing credentials and read the authenticated mailbox profile.
// Never request additional scopes, create drafts or send messages.
export const senderCodes=['ready','read_only','scope_unknown','identity_unverified','account_mismatch','not_connected','provider_error'] as const
export type SenderCode=typeof senderCodes[number]
export interface SenderResult {code:SenderCode;email:string|null;can_send:boolean;can_read:boolean;valid_for:number}
export interface SenderConfig {clientId:string;clientSecret:string;refreshToken:string;expectedEmail?:string}
const scope=(name:string)=>`https://www.googleapis.com/auth/gmail.${name}`
const sendScopes=new Set(['https://mail.google.com/',scope('send'),scope('compose'),scope('modify')])
const profileScopes=new Set(['https://mail.google.com/',scope('readonly'),scope('metadata'),scope('compose'),scope('modify')])
const readScopes=new Set(['https://mail.google.com/',scope('readonly'),scope('modify')])
const emailPattern=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
async function boundedJson(response:Response){
 if(!response.ok||!response.body)throw new Error('provider unavailable')
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32768)throw new Error('response limit');text+=decoder.decode(part.value,{stream:true})}return JSON.parse(text+decoder.decode()) as Record<string,unknown>}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock()}
}
export async function inspectSender(config:SenderConfig|null,fetcher:typeof fetch=fetch):Promise<SenderResult>{
 const fail=(code:SenderCode):SenderResult=>({code,email:null,can_send:false,can_read:false,valid_for:60})
 if(!config?.clientId||!config.clientSecret||!config.refreshToken)return fail('not_connected')
 try{
  const token=await boundedJson(await fetcher('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'})}))
  if(typeof token.access_token!=='string'||!token.access_token||/[\r\n]/.test(token.access_token)||typeof token.expires_in!=='number'||!Number.isFinite(token.expires_in)||token.expires_in<=30)return fail('provider_error')
  if(typeof token.scope!=='string'||!token.scope.trim())return fail('scope_unknown')
  const scopes=new Set(token.scope.split(/\s+/)),canSend=[...scopes].some(s=>sendScopes.has(s)),canRead=[...scopes].some(s=>readScopes.has(s))
  if(![...scopes].some(s=>profileScopes.has(s)))return fail('identity_unverified')
  const profile=await boundedJson(await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile',{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token.access_token}`}}))
  const email=typeof profile.emailAddress==='string'?profile.emailAddress.trim().toLowerCase():''
  if(email.length>254||!emailPattern.test(email))return fail('identity_unverified')
  if(config.expectedEmail&&email!==config.expectedEmail.trim().toLowerCase())return fail('account_mismatch')
  return {code:canSend?'ready':'read_only',email,can_send:canSend,can_read:canRead,valid_for:Math.floor(Math.min(token.expires_in-30,900))}
 }catch{return fail('provider_error')}
}

export interface ReadinessDeps {
 authorize:(authorization:string)=>Promise<boolean>;
 begin:()=>Promise<string|null>;
 config:()=>Promise<SenderConfig|null>;
 finish:(run:string,result:SenderResult)=>Promise<void>;
 fetcher:typeof fetch;
}
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}
export function createReadinessHandler(d:ReadinessDeps){return async(req:Request)=>{
 const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:cors})
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
 if(req.method!=='POST')return respond({error:'POST only'},405)
 const authorization=req.headers.get('authorization')??''
 if(!/^Bearer \S+$/i.test(authorization))return respond({error:'로그인이 필요합니다.'},401)
 try{if(!await d.authorize(authorization))return respond({error:'관리자 계정에서 연결 상태를 확인할 수 있습니다.'},403)}catch{return respond({error:'계정 확인을 완료하지 못했습니다.'},503)}
 let run:string|null
 try{run=await d.begin()}catch{return respond({error:'진단 서버 상태 확인 필요'},503)}
 if(!run)return respond({checking:true},202)
 let result:SenderResult
 try{result=await inspectSender(await d.config(),d.fetcher)}catch{result={code:'provider_error',email:null,can_send:false,can_read:false,valid_for:60}}
 try{await d.finish(run,result)}catch{return respond({error:'진단 결과 저장 실패 · 잠시 후 자동 재확인'},503)}
 return respond({checked:true,code:result.code})
}}
