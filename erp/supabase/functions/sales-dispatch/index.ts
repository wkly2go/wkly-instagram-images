import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {runSalesDispatch,type DispatchLease} from './worker.ts'
import {transmitGmail} from './gmail.ts'
// Sends one approved message. The request names a queued job only; recipients, wording and
// attachments come from the package the administrator approved, re-checked when the job is claimed.
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>={}){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
async function config(){
 const [enabled,client,secret,refresh]=await Promise.all([rpc('sales_dispatch_enabled'),server.from('app_settings').select('value').eq('key','google_oauth_client_id').maybeSingle(),rpc('gdrive_secret_get',{p_name:'GOOGLE_CLIENT_SECRET'}),rpc('gdrive_secret_get',{p_name:'GOOGLE_DRIVE_REFRESH_TOKEN'})])
 if(client.error||typeof client.data?.value!=='string'||typeof secret!=='string'||typeof refresh!=='string')return null
 return {enabled:enabled===true,clientId:client.data.value,clientSecret:secret,refreshToken:refresh,expectedEmail:Deno.env.get('SALES_SENDER_EMAIL')}
}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('POST only',{status:405})
 let id:string
 try{const raw=await req.text();if(raw.length>512)throw new Error();const body=JSON.parse(raw);if(!body||Object.keys(body).some(k=>k!=='id')||!uuid.test(body.id??''))throw new Error();id=body.id}catch{return new Response('Invalid job',{status:400})}
 const work=runSalesDispatch(id,{
  claim:async job=>await rpc('sales_dispatch_claim',{p_id:job}) as DispatchLease|null,
  // A missing or switched-off configuration is a refusal before any send attempt.
  transmit:async(lease,signal)=>transmitGmail(lease,signal,await config().catch(()=>null)),
  finish:async(job,token,outcome,providerId)=>{await rpc('sales_dispatch_finish',{p_id:job,p_token:token,p_outcome:outcome,p_provider_id:providerId})},
 }).then(()=>undefined,()=>undefined)
 EdgeRuntime.waitUntil(work)
 return Response.json({accepted:true},{status:202})
})
