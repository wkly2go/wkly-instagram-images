import {followupPrompt,parseFollowupPlan,type FollowupJob,type FollowupPlan} from '../../../src/lib/salesFollowup.ts'
export interface FollowupDeps {claim:(id:string,token:string)=>Promise<FollowupJob|null>;generate:(job:FollowupJob,prompt:string)=>Promise<{status?:string;text?:string;error?:string}>;finish:(id:string,plan:FollowupPlan|null,error:string)=>Promise<void>;background?:(work:Promise<void>)=>void}
export function createFollowupHandler(d:FollowupDeps){return async(req:Request)=>{
 if(req.method!=='POST')return new Response('POST only',{status:405})
 let id:string,token:string
 try{const raw=await req.text();if(raw.length>2048)throw new Error();const b=JSON.parse(raw),uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;if(!b||Object.keys(b).some(k=>!['id','token'].includes(k))||!uuid.test(b.id??'')||!uuid.test(b.token??''))throw new Error();id=b.id;token=b.token}catch{return new Response('Invalid job',{status:400})}
 let job:FollowupJob|null;try{job=await d.claim(id,token)}catch{return new Response('Unavailable',{status:503})}
 if(!job)return new Response('Not claimed',{status:403})
 const work=async()=>{
  let plan:FollowupPlan|null=null,error=''
  try{const response=await d.generate(job!,followupPrompt(job!));if(response.error||response.status!=='completed'||!response.text)throw new Error();plan=parseFollowupPlan(response.text,job!.input)}catch{error='후속안 작성·원문 인용 검증 미완료 · 동일 요청 자동 재호출 없음. 시스템이 연결·사용 한도를 재확인합니다.'}
  // Retry only the idempotent result write, never a paid generation.
  for(let attempt=0;attempt<2;attempt++){try{await d.finish(id,plan,error);return true}catch{}}
  return false
 }
 if(d.background){d.background(work().then(()=>undefined));return Response.json({accepted:true},{status:202})}
 const recorded=await work();return Response.json({recorded},{status:recorded?200:503})
}}
