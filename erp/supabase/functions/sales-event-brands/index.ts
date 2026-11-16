import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {parse} from 'npm:parse5@7.3.0'
import {createEventBrandsHandler,eventUrl} from './handler.ts'
import {readPublicPageEdge} from '../sales-contact-discovery/transport-edge.ts'
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
const net={resolve:(hostname:string)=>Deno.resolveDns(hostname,'A'),fetcher:fetch}
Deno.serve(createEventBrandsHandler({claim:(id,token)=>rpc('sales_event_brands_claim',{p_id:id,p_token:token}),finish:async(id,result)=>{await rpc('sales_event_brands_finish',{p_id:id,p_result:result})},read:url=>readPublicPageEdge(url,net,eventUrl),parse,background:work=>EdgeRuntime.waitUntil(work)}))
