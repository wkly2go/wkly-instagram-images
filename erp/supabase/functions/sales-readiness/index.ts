import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {createReadinessHandler} from './handler.ts'
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>={}){const result=await server.rpc(name,args);if(result.error)throw new Error('Database operation failed');return result.data}
Deno.serve(createReadinessHandler({
 authorize:async authorization=>{
  const {data,error}=await server.auth.getUser(authorization.replace(/^Bearer /i,''))
  if(error||!data.user)return false
  const profile=await server.from('profiles').select('role,active,is_agent').eq('id',data.user.id).maybeSingle()
  return !profile.error&&profile.data?.active===true&&profile.data.role==='admin'&&profile.data.is_agent!==true
 },
 begin:()=>rpc('sales_sender_check_begin'),
 config:async()=>{
  const [client,secret,refresh]=await Promise.all([server.from('app_settings').select('value').eq('key','google_oauth_client_id').maybeSingle(),rpc('gdrive_secret_get',{p_name:'GOOGLE_CLIENT_SECRET'}),rpc('gdrive_secret_get',{p_name:'GOOGLE_DRIVE_REFRESH_TOKEN'})])
  if(client.error)throw new Error('Configuration unavailable')
  return typeof client.data?.value==='string'&&typeof secret==='string'&&typeof refresh==='string'?{clientId:client.data.value,clientSecret:secret,refreshToken:refresh,expectedEmail:Deno.env.get('SALES_SENDER_EMAIL')}:null
 },
 finish:async(run,result)=>{await rpc('sales_sender_check_finish',{p_run:run,p_result:result})},fetcher:fetch,
}))
