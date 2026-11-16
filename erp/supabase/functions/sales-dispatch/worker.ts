/** Internal worker core. No HTTP entry point or provider connection is enabled. */
export interface DispatchLease {
 id:string;token:string;fingerprint:string;sender:string;
 message:{recipient:string;subject:string;body:string;channel?:string};
 attachments:{name:string;mime:string;content:string}[];expires_at:string;
 /** A fixed test text to an address the administrator named; sent even while customer sending is switched off. */
 test?:boolean;
}
export type DispatchOutcome='accepted'|'rejected'|'unknown'
export interface DispatchDeps {
 claim:(id:string)=>Promise<DispatchLease|null>;
 transmit:(lease:DispatchLease,signal:AbortSignal)=>Promise<{outcome:'accepted';providerId:string}|{outcome:'rejected'}>;
 finish:(id:string,token:string,outcome:DispatchOutcome,providerId:string|null)=>Promise<void>;
 now?:()=>number;
}
/** Never retry transmission. Only repeat an idempotent result write. */
export async function runSalesDispatch(id:string,d:DispatchDeps){
 let lease:DispatchLease|null
 try{lease=await d.claim(id)}catch{return {state:'claim_unavailable' as const,recorded:false}}
 if(!lease)return {state:'not_claimed' as const,recorded:false}
 let outcome:DispatchOutcome='unknown',providerId:string|null=null
 const remaining=Date.parse(lease.expires_at)-(d.now??Date.now)()
 if(!Number.isFinite(remaining)||remaining<=0)outcome='rejected'
 else{
  const controller=new AbortController()
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
   const result=await Promise.race([
    d.transmit(lease,controller.signal),
    new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('dispatch timeout'))},Math.min(remaining,20000))}),
   ])
   if(result.outcome==='accepted'&&typeof result.providerId==='string'&&result.providerId.trim().length>0&&result.providerId.length<=200&&!/[\r\n\x00-\x1f\x7f]/.test(result.providerId)){outcome='accepted';providerId=result.providerId}
   else if(result.outcome==='rejected')outcome='rejected'
  }catch{/* A lost response can mean the provider accepted it: do not resend. */}
  finally{if(timer!==undefined)clearTimeout(timer)}
 }
 for(let attempt=0;attempt<2;attempt++){
  try{await d.finish(lease.id,lease.token,outcome,providerId);return {state:outcome,recorded:true}}
  catch{/* The watchdog and future receipt reconciliation handle a failed result write. */}
 }
 return {state:outcome,recorded:false}
}
