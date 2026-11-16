import {createClient} from 'npm:@supabase/supabase-js@2.117.3'
import {inboundMessages,signatureValid,verifySubscription} from './handler.ts'
// Public webhook for Meta (no JWT). Every POST must carry Meta's signature made with the app secret the
// administrator stored; without it nothing is stored. It never sends messages.
const server=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
async function secret(name:string){const r=await server.rpc('instagram_secret_get',{p_name:name});return typeof r.data==='string'?r.data:null}
async function username(id:string,token:string|null){
 if(!token)return undefined
 try{const r=await fetch(`https://graph.instagram.com/v21.0/${id}?fields=username`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000),redirect:'error'});if(!r.ok)return undefined;const j=await r.json();return typeof j?.username==='string'&&/^[A-Za-z0-9._]{1,60}$/.test(j.username)?j.username:undefined}catch{return undefined}
}
Deno.serve(async req=>{
 const url=new URL(req.url)
 if(req.method==='GET'){const challenge=verifySubscription(url,await secret('INSTAGRAM_VERIFY_TOKEN'));return challenge?new Response(challenge,{status:200}):new Response('Forbidden',{status:403})}
 if(req.method!=='POST')return new Response('Method not allowed',{status:405})
 const raw=await req.text()
 if(raw.length>200000)return new Response('Too large',{status:413})
 if(!await signatureValid(raw,req.headers.get('x-hub-signature-256'),await secret('INSTAGRAM_APP_SECRET')))return new Response('Forbidden',{status:403})
 let body:unknown;try{body=JSON.parse(raw)}catch{return new Response('Bad request',{status:400})}
 const events=inboundMessages(body)
 if(events.length){
  const token=await secret('INSTAGRAM_ACCESS_TOKEN'),names=new Map<string,string|undefined>()
  for(const id of new Set(events.map(e=>e.ig_user)))names.set(id,await username(id,token))
  const r=await server.rpc('sales_dm_receive',{p_events:events.map(e=>({...e,username:names.get(e.ig_user)}))})
  if(r.error)return new Response('Retry',{status:500})
 }
 return new Response('EVENT_RECEIVED',{status:200})
})
