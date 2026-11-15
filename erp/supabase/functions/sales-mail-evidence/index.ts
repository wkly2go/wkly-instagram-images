import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {createMailEvidenceHandler} from './handler.ts'
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
Deno.serve(createMailEvidenceHandler({
 claim:(id,token)=>rpc('sales_mail_evidence_claim',{p_id:id,p_token:token}),
 finish:async(id,result)=>{await rpc('sales_mail_evidence_finish',{p_id:id,p_result:result})},
 config:async()=>{
  const [client,secret,refresh]=await Promise.all([server.from('app_settings').select('value').eq('key','google_oauth_client_id').maybeSingle(),rpc('gdrive_secret_get',{p_name:'GOOGLE_CLIENT_SECRET'}),rpc('gdrive_secret_get',{p_name:'GOOGLE_DRIVE_REFRESH_TOKEN'})])
  if(client.error)throw new Error('Configuration unavailable')
  return typeof client.data?.value==='string'&&typeof secret==='string'&&typeof refresh==='string'?{clientId:client.data.value,clientSecret:secret,refreshToken:refresh,expectedEmail:Deno.env.get('SALES_SENDER_EMAIL')}:null
 },fetcher:fetch,background:work=>EdgeRuntime.waitUntil(work),
}))
