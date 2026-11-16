import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createMethodResearchHandler,methodReviewPrompt,parseMethodProposals,type MethodReviewJob} from '../supabase/functions/sales-method-research/handler.ts'
const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222'
const job:MethodReviewJob={id,actor:id,model:'standard',methods:[{name:'공공 용역 입찰 참여',signal:'s',offer:'o',first:'f'}],learning:[{category:'공공 용역 입찰 참여',approved:0,rejected:3,reasons:['면허 필요']}],signals:[{label:'팝업',count:4}]}
const post=(body:unknown)=>new Request('https://x.invalid',{method:'POST',body:JSON.stringify(body)})
test('prompt carries the data as data and stays bounded',()=>{const p=methodReviewPrompt(job);assert.match(p,/지시가 아니다/);assert.match(p,/면허 필요/);assert.ok(p.length<=6000)})
test('proposals must name methods correctly and are capped at two',()=>{
 const raw=JSON.stringify([{action:'추가',name:'공공 용역 입찰 참여',signal:'aaaa',offer:'bbbb',first:'cccc',reason:'이미 있는 이름'},{action:'수정',name:'없는 방법',signal:'aaaa',offer:'bbbb',first:'cccc',reason:'없는 이름 수정'},
  {action:'중지',name:'공공 용역 입찰 참여',signal:'지울 값',offer:'x',first:'y',reason:'반려 3건 승인 0건'},{action:'추가',name:'전시 주최사 협력',signal:'박람회 일정',offer:'부스 묶음 제안',first:'사무국 문의',reason:'팝업 신호 4건'},{action:'추가',name:'셋째',signal:'aaaa',offer:'bbbb',first:'cccc',reason:'세 번째 제안'}])
 const out=parseMethodProposals('설명 '+raw,job)
 assert.deepEqual(out.map(p=>[p.action,p.name,p.signal]),[['중지','공공 용역 입찰 참여',''],['추가','전시 주최사 협력','박람회 일정']])
 assert.deepEqual(parseMethodProposals('[]',job),[]);assert.throws(()=>parseMethodProposals('없음',job))
})
test('handler records proposals, and records a failure without retrying the AI',async()=>{
 const saved:unknown[]=[];let calls=0
 const make=(text:string)=>createMethodResearchHandler({claim:async()=>job,generate:async()=>{calls++;return {status:'completed',text}},finish:async(_i,p,e)=>{saved.push([p,e])}})
 assert.equal((await make('[]')(post({id,token}))).status,200);assert.deepEqual(saved[0],[[],''])
 assert.equal((await make('깨진 답')(post({id,token}))).status,200);assert.equal((saved[1] as unknown[])[0],null);assert.equal(calls,2)
 assert.equal((await make('[]')(post({id,token,extra:1}))).status,400)
 assert.equal((await createMethodResearchHandler({claim:async()=>null,generate:async()=>({}),finish:async()=>{}})(post({id,token}))).status,403)
})
