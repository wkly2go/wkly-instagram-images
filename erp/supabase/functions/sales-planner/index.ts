import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {createGrowthAiHandler} from '../growth-ai/handler.ts'
import {createSalesPlanner} from './handler.ts'
const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await sb.rpc(name,args);if(r.error)throw new Error(r.error.message);return r.data}
Deno.serve(createSalesPlanner({
 claim:(id,token)=>rpc('sales_strategy_claim',{p_id:id,p_token:token}),
 async generate(job,prompt){
  const generate=createGrowthAiHandler({configured:true,apiKey:Deno.env.get('ANTHROPIC_API_KEY'),authenticate:async()=>({id:job.actor}),reserve:async args=>await sb.rpc('growth_ai_reserve',args),finish:async args=>await sb.rpc('growth_ai_finish',args),fetch})
  const response=await generate(new Request('https://internal.invalid/plan',{method:'POST',headers:{Authorization:'Bearer claimed-planning-job'},body:JSON.stringify({id:job.id,task:'write',model:job.model,prompt})}))
  return await response.json()
 },
 finish:async(id,plan,error,phase)=>{await rpc(phase==='prepare'?'sales_strategy_prepared':'sales_strategy_finish',{p_id:id,p_plan:plan,p_error:error})},
 background:work=>EdgeRuntime.waitUntil(work),
}))
