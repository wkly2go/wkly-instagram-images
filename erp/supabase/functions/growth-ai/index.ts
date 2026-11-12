import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { MAX_OUTPUT, SYSTEM, validateRequest } from './policy.ts'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Content-Type':'application/json'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers})
 if(req.method!=='POST')return json({error:'지원하지 않는 요청입니다.'},405)
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,key=Deno.env.get('ANTHROPIC_API_KEY')
 const auth=req.headers.get('Authorization')??''
 const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
 const {data:{user},error:authError}=await client.auth.getUser()
 if(authError||!user)return json({error:'로그인이 필요합니다.'},401)
 const sb=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
 let reserved=false,requestId=''
 try{
  const raw=await req.text();if(raw.length>30000)return json({error:'요청이 너무 큽니다.'},400)
  const body=JSON.parse(raw);validateRequest(body);requestId=body.id
  if(!key)return json({error:'서버 API 연결이 아직 설정되지 않았습니다.'},503)
  const {data:model,error:me}=await sb.from('growth_ai_models').select('*').eq('key',body.model).eq('enabled',true).single()
  if(me||!model)return json({error:'관리자에게 모델 연결·단가 설정을 확인해 주세요.'},400)
  const inputTokens=new TextEncoder().encode(SYSTEM+body.prompt).byteLength+1024
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([body.task,body.model,body.prompt])))
  const signature=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')
  const {data:reservation,error:re}=await sb.rpc('growth_ai_reserve',{p_id:body.id,p_user:user.id,p_task:body.task,p_signature:signature,p_model:body.model,p_input_tokens:inputTokens})
  if(re)return json({error:re.message},400)
  if(!reservation.execute)return json({status:reservation.status,text:reservation.text??'',cost:reservation.cost})
  reserved=true
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:reservation.model_id,max_tokens:MAX_OUTPUT,system:SYSTEM,messages:[{role:'user',content:body.prompt}]}),signal:AbortSignal.timeout(55000)})
  if(!response.ok)throw new Error('provider request failed')
  const result=await response.json()
  if(!Number.isFinite(result.usage?.input_tokens)||!Number.isFinite(result.usage?.output_tokens))throw new Error('missing usage')
  const output=(result.content??[]).filter((x:{type:string})=>x.type==='text').map((x:{text:string})=>x.text).join('\n').slice(0,30000)
  const cost=(result.usage.input_tokens*Number(reservation.input_rate)+result.usage.output_tokens*Number(reservation.output_rate))/1e6
  const {error:fe}=await sb.rpc('growth_ai_finish',{p_id:body.id,p_actual:cost,p_output:output,p_uncertain:false})
  if(fe)throw new Error('settlement failed')
  return json({text:output,cost,status:'completed'})
 }catch{
  if(reserved)await sb.rpc('growth_ai_finish',{p_id:requestId,p_actual:null,p_output:null,p_uncertain:true})
  return json({error:reserved?'실행 결과가 불확실합니다. 중복 호출을 막고 예약 비용을 유지했습니다. 관리자에게 Console 사용량 확인을 요청해 주세요.':'요청 내용을 확인해 주세요.'},400)
 }
})
