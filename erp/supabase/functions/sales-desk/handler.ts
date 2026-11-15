import {deskPrompt,parseDeskReport,type SalesDeskJob,type DeskReport} from '../../../src/lib/salesDesk.ts'
export interface DeskDeps {
 claim:(id:string,token:string)=>Promise<SalesDeskJob|null>;
 generate:(job:SalesDeskJob,prompt:string)=>Promise<{status?:string;text?:string;error?:string}>;
 finish:(id:string,report:DeskReport|null,error:string)=>Promise<void>;
 background?:(work:Promise<void>)=>void;
}
export function createSalesDeskWorker(d:DeskDeps){return async(req:Request)=>{
 if(req.method!=='POST')return new Response('POST only',{status:405})
 let job:SalesDeskJob|null
 try{const raw=await req.text();if(raw.length>2048)return new Response('Request too large',{status:413});const b=JSON.parse(raw),uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;if(!b||!uuid.test(b.id??'')||!uuid.test(b.token??''))return new Response('Invalid job',{status:400});job=await d.claim(b.id,b.token)}catch{return new Response('Worker unavailable',{status:503})}
 if(!job)return new Response('Job unavailable',{status:403})
 const work=async()=>{try{const result=await d.generate(job!,deskPrompt(job!));if(result.error||result.status!=='completed'||!result.text)throw new Error('incomplete');await d.finish(job!.id,parseDeskReport(result.text,job!.snapshot.sources.map(s=>s.id)),'')}catch{try{await d.finish(job!.id,null,'보고서 생성 또는 근거 검증을 완료하지 못했습니다. 입력과 DB 자료는 보존했으며 자동 재호출하지 않았습니다. AI 연결·사용 한도·처리 기록 확인이 필요합니다.')}catch{/* watchdog marks stalled jobs; no second paid call */}}}
 if(d.background){d.background(work());return Response.json({accepted:true},{status:202})}
 await work();return Response.json({accepted:true})
}}
