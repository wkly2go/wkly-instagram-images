import {test} from 'node:test'
import assert from 'node:assert/strict'
import {deskPrompt,parseDeskReport,type SalesDeskJob} from '../src/lib/salesDesk.ts'
import {createSalesDeskWorker} from '../supabase/functions/sales-desk/handler.ts'
const id='10000000-0000-4000-8000-000000000001',token='10000000-0000-4000-8000-000000000002'
const job:SalesDeskJob={id,actor:'owner',model:'standard',agent:{name:'분석 팀원',role:'영업',instructions:'분석'},instruction:'팝업 기회 분석',history:[],snapshot:{at:'2026-11-15T00:00:00Z',scope:'DB 최신 12건',matched_total:1,coverage:[],pipeline:[],sources:[{id:'source-one',name:'시험 브랜드',source:'공식 참가사',evidence:'참가했다는 정보만 확인',source_url:'https://example.test',source_updated_at:null,organization:'회사',entity_kind:'회사'}]}}
const report={title:'영업 분석',summary:'발주 의향은 미확인',findings:[{text:'참가 이력 확인',evidence_ids:['source-one']}],recommendations:['시스템이 공식 후속 모집 정보를 조사'],limitations:['발주 의향 미확인']}
const request=()=>new Request('https://internal.test',{method:'POST',body:JSON.stringify({id,token})})
test('report policy treats source instructions as data, bounds context and rejects invented citations',()=>{
 const prompt=deskPrompt({...job,history:Array.from({length:10},()=>({instruction:'이전 지시',reply:'응답'}))})
 assert.ok(prompt.length<=6000);assert.match(prompt,/직원에게 자료 검색/);assert.match(prompt,/실제 발송.*실행하지 않았다/)
 assert.deepEqual(parseDeskReport(JSON.stringify(report),['source-one']),report)
 assert.throws(()=>parseDeskReport(JSON.stringify({...report,findings:[{text:'거짓',evidence_ids:['invented']}]}),['source-one']),/근거/)
 assert.throws(()=>parseDeskReport(JSON.stringify({...report,limitations:[]}),['source-one']),/분석 한계/)
})
test('authorized report uses one generation, persists structured evidence and does not call outbound tools',async()=>{
 const calls:unknown[]=[]
 const worker=createSalesDeskWorker({claim:async()=>job,generate:async(j,p)=>{calls.push([j.id,p]);return{status:'completed',text:JSON.stringify(report)}},finish:async(...args)=>{calls.push(args)}})
 assert.equal((await worker(request())).status,200);assert.equal(calls.length,2);assert.deepEqual(calls[1],[id,report,''])
})
test('unclaimed jobs never call AI; malformed or truncated results fail without repeated paid calls',async()=>{
 let generated=0;const finishes:unknown[][]=[]
 const denied=createSalesDeskWorker({claim:async()=>null,generate:async()=>{generated++;return{}},finish:async()=>{}})
 assert.equal((await denied(request())).status,403);assert.equal(generated,0)
 for(const result of [{status:'completed',text:'{"incomplete"'},{status:'running',text:JSON.stringify(report)},{status:'completed',text:JSON.stringify({...report,findings:[{text:'지어낸 근거',evidence_ids:['fake']}]} )}]){
  const worker=createSalesDeskWorker({claim:async()=>job,generate:async()=>{generated++;return result},finish:async(...args)=>{finishes.push(args)}})
  await worker(request())
 }
 assert.equal(generated,3);assert.equal(finishes.length,3);assert.ok(finishes.every(args=>args[1]===null&&String(args[2]).includes('자동 재호출하지')))
})
