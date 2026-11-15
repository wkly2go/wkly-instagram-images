import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {parse} from 'npm:parse5@7.3.0'
import {createResearchHandler} from './handler.ts'
import {readPublicPage} from '../sales-contact-discovery/transport.ts'
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
Deno.serve(createResearchHandler({claim:(id,token)=>rpc('sales_followup_research_claim',{p_id:id,p_token:token}),finish:async(id,result)=>{await rpc('sales_followup_research_finish',{p_id:id,p_result:result})},read:readPublicPage,parse,background:work=>EdgeRuntime.waitUntil(work)}))
