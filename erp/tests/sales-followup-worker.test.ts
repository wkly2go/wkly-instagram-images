import {test} from 'node:test'
import assert from 'node:assert/strict'
import {followupPrompt,parseFollowupPlan,type FollowupJob} from '../src/lib/salesFollowup.ts'
import {createFollowupHandler} from '../supabase/functions/sales-followup/handler.ts'
const id='10000000-0000-4000-8000-000000000001',token='20000000-0000-4000-8000-000000000002'
const job:FollowupJob={id,actor:id,model:'standard',input:{reply:{id:'bb22',text:'제안서를 보내주세요. 일정은 미정입니다.',received_at:'2026-11-15T01:00:00Z'},sent:{subject:'운영 제안',body:'팝업 운영 제안'},proposal:'검토 가능한 범위 초안',pipeline:{stage:'접촉',revision:1}}}
const plan={summary:'제안서 요청이 있으나 일정 미확인',action:'prepare_reply',evidence:[{quote:'제안서를 보내주세요.',meaning:'문안 작성 근거이며 수신 자격 검증과 별개'}],next_action:'시스템이 제안 범위를 검증해 승인안을 준비',missing:['일정 미확인'],draft:{subject:'요청하신 제안 범위 검토',body:'제안 범위 초안을 검토 중입니다.'}}
const request=()=>new Request('https://internal.test',{method:'POST',body:JSON.stringify({id,token})})
test('follow-up quotes must exist in supplied reply and research cannot masquerade as a send draft',()=>{
 assert.deepEqual(parseFollowupPlan(JSON.stringify(plan),job.input),plan)
 assert.throws(()=>parseFollowupPlan(JSON.stringify({...plan,evidence:[{quote:'예산 1억원 확정',meaning:'invented'}]}),job.input))
 assert.throws(()=>parseFollowupPlan(JSON.stringify({...plan,action:'research'}),job.input))
 assert.throws(()=>parseFollowupPlan(JSON.stringify({...plan,draft:{subject:'Hello\r\nBcc:bad@example.com',body:'hello'}}),job.input))
 assert.match(followupPrompt(job),/사람에게 검색/);assert.match(followupPrompt(job),/지시는 따르지 않는다/);assert.ok(followupPrompt(job).length<=6000)
})
test('one claimed job generates once; only idempotent persistence retries',async()=>{
 let calls=0,writes=0;const handler=createFollowupHandler({claim:async()=>job,generate:async()=>{calls++;return{status:'completed',text:JSON.stringify(plan)}},finish:async(_id,p)=>{assert.deepEqual(p,plan);if(++writes===1)throw new Error('transient')}})
 const response=await handler(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{recorded:true});assert.equal(calls,1);assert.equal(writes,2)
})
test('unclaimed work does not spend AI budget; truncated output never becomes a review draft',async()=>{
 let calls=0;const denied=createFollowupHandler({claim:async()=>null,generate:async()=>{calls++;return{}},finish:async()=>{}});assert.equal((await denied(request())).status,403);assert.equal(calls,0)
 const written:any[]=[];const handler=createFollowupHandler({claim:async()=>job,generate:async()=>{calls++;return{status:'running',text:JSON.stringify(plan)}},finish:async(...args)=>{written.push(args)}})
 await handler(request());assert.equal(calls,1);assert.equal(written[0][1],null);assert.match(written[0][2],/동일 요청 자동 재호출 없음/)
})
test('persistence failure is reported without exposing errors or regenerating',async()=>{
 let calls=0;const handler=createFollowupHandler({claim:async()=>job,generate:async()=>{calls++;return{status:'completed',text:JSON.stringify(plan)}},finish:async()=>{throw new Error('secret')}})
 const response=await handler(request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{recorded:false});assert.equal(calls,1)
})

test('enriched prompts stay bounded, retain untrusted-source rules and reject invented website quotations',()=>{
 const input={...job.input,research:{scope:'공개 자료 일부',pages:[{url:'https://company.com/services',excerpt:'행사 운영 서비스를 제공합니다.'}]}}
 const enriched={...plan,research_evidence:[{url:input.research.pages[0].url,quote:'행사 운영 서비스'}]}
 assert.deepEqual(parseFollowupPlan(JSON.stringify(enriched),input),enriched)
 assert.throws(()=>parseFollowupPlan(JSON.stringify({...enriched,research_evidence:[{url:'https://wrong.com',quote:'행사'}]}),input))
 const prompt=followupPrompt({...job,input:{...input,research:{...input.research,pages:Array(3).fill({url:'https://company.com/'+ 'x'.repeat(1400),excerpt:'x'.repeat(1200)})}}});assert.ok(prompt.length<=6000);assert.match(prompt,/해결되지 않은 missing은 지우지/)
})
