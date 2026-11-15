import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {createG2bWorker} from './handler.ts'
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
Deno.serve(createG2bWorker({
 key:Deno.env.get('DATA_GO_KR_SERVICE_KEY'),fetcher:fetch,
 claim:(id,token)=>rpc('sales_g2b_claim',{p_run:id,p_token:token}),
 page:async(id,page,rows,total,omitted,stamp)=>{await rpc('sales_g2b_page',{p_run:id,p_page:page,p_rows:rows,p_total:total,p_omitted:omitted,p_stamp:stamp})},
 finish:async(id,status,note)=>{await rpc('sales_g2b_finish',{p_run:id,p_status:status,p_note:note})},
 background:work=>EdgeRuntime.waitUntil(work),
}))
