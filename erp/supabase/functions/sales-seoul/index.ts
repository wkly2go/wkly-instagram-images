import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {createSeoulWorker,normalizeSeoulApiKey} from './handler.ts'
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
Deno.serve(createSeoulWorker({
 key:normalizeSeoulApiKey(Deno.env.get('SEOUL_CULTURAL_EVENT_API_KEY'))||normalizeSeoulApiKey(Deno.env.get('SEOUL_OPEN_DATA_API_KEY')),fetcher:fetch,
 loadKey:async()=>normalizeSeoulApiKey(await rpc('sales_seoul_key',{})),
 claim:(id,token)=>rpc('sales_seoul_claim',{p_run:id,p_token:token}),
 page:async(id,rows,stamp)=>{await rpc('sales_seoul_page',{p_run:id,p_rows:rows,p_stamp:stamp})},
 finish:async(id,status,count,scanned,total,note,stamp)=>{await rpc('sales_seoul_finish',{p_run:id,p_status:status,p_count:count,p_scanned:scanned,p_total:total,p_note:note,p_stamp:stamp})},
}))
