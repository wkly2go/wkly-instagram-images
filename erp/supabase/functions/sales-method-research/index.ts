import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {createGrowthAiHandler} from '../growth-ai/handler.ts'
import {createMethodResearchHandler} from './handler.ts'
const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await sb.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
Deno.serve(createMethodResearchHandler({
 claim:(id,token)=>rpc('sales_method_review_claim',{p_id:id,p_token:token}),
 async generate(job,prompt){const run=createGrowthAiHandler({configured:true,apiKey:Deno.env.get('ANTHROPIC_API_KEY'),maxOutputTokens:6000,effort:'medium',requireComplete:true,authenticate:async()=>({id:job.actor}),reserve:async args=>await sb.rpc('sales_method_review_ai_reserve',args),finish:async args=>await sb.rpc('growth_ai_finish',args),fetch});return await (await run(new Request('https://internal.invalid/method-review',{method:'POST',headers:{Authorization:'Bearer claimed-sales-method-job'},body:JSON.stringify({id:job.id,task:'write',model:job.model,prompt})}))).json()},
 finish:async(id,proposals,error)=>{await rpc('sales_method_review_finish',{p_id:id,p_proposals:proposals,p_error:error})},
 background:work=>EdgeRuntime.waitUntil(work),
}))
