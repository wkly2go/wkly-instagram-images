import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {createBrandSiteHandler,googleSearch,kakaoSearch,naverSearch,type SearchProvider} from './handler.ts'
import {readPublicPageEdge} from '../sales-contact-discovery/transport-edge.ts'
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function rpc(name:string,args:Record<string,unknown>){const r=await server.rpc(name,args);if(r.error)throw new Error('Database operation failed');return r.data}
const net={resolve:(hostname:string)=>Deno.resolveDns(hostname,'A'),fetcher:fetch}
const site=(value:string)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search?u:null}catch{return null}}
const env=(name:string)=>(Deno.env.get(name)??'').trim()
// Naver, Kakao(Daum) and Google, free allowances only (2026-11-15 대표 지시). An engine without a saved key is simply left out.
const providers:SearchProvider[]=[]
const naverId=env('NAVER_SEARCH_CLIENT_ID')||env('NAVER_API_ID')||env('NAVER-API-ID'),naverSecret=env('NAVER_SEARCH_CLIENT_SECRET')||env('NAVER_API_SECRET')
if(naverId&&naverSecret)providers.push(naverSearch(naverId,naverSecret,fetch))
if(env('KAKAO_REST_API_KEY'))providers.push(kakaoSearch(env('KAKAO_REST_API_KEY'),fetch))
// Google is asked only when the domestic engines did not lead to the brand's own site.
if(env('GEMINI_API_KEY'))providers.push(googleSearch(env('GEMINI_API_KEY'),fetch))
Deno.serve(createBrandSiteHandler({providers,read:url=>readPublicPageEdge(url,net,site),
 claim:(id,token)=>rpc('sales_brand_site_claim',{p_id:id,p_token:token}),finish:async(id,result)=>{await rpc('sales_brand_site_finish',{p_id:id,p_result:result})},background:work=>EdgeRuntime.waitUntil(work)}))
