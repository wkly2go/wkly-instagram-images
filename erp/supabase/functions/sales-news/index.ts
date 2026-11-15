import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {createNewsWorker} from './handler.ts'
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
Deno.serve(createNewsWorker({
 id:Deno.env.get('NAVER_SEARCH_CLIENT_ID')||Deno.env.get('NAVER_API_ID')||Deno.env.get('NAVER-API-ID'),
 secret:Deno.env.get('NAVER_SEARCH_CLIENT_SECRET')||Deno.env.get('NAVER_API_SECRET'),fetcher:fetch,
 claim:(id,token)=>rpc('sales_news_claim',{p_run:id,p_token:token}),
 save:async(id,rows,total,stamp)=>{await rpc('sales_news_save',{p_run:id,p_rows:rows,p_total:total,p_stamp:stamp})},
 finish:async(id,status,note)=>{await rpc('sales_news_finish',{p_run:id,p_status:status,p_note:note})},
 background:work=>EdgeRuntime.waitUntil(work),
}))
