import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {createBrandSiteHandler} from './handler.ts'
import {readPublicPageEdge} from '../sales-contact-discovery/transport-edge.ts'
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
const net={resolve:(hostname:string)=>Deno.resolveDns(hostname,'A'),fetcher:fetch}
const site=(value:string)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search?u:null}catch{return null}}
Deno.serve(createBrandSiteHandler({key:Deno.env.get('BRAVE_SEARCH_API_KEY'),fetcher:fetch,read:url=>readPublicPageEdge(url,net,site),
 claim:(id,token)=>rpc('sales_brand_site_claim',{p_id:id,p_token:token}),finish:async(id,result)=>{await rpc('sales_brand_site_finish',{p_id:id,p_result:result})},background:work=>EdgeRuntime.waitUntil(work)}))
