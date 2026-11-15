import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createNewsBrandHandler,newsBrandPrompt,parseNewsBrands,type NewsBrandJob,type NewsBrandRow} from '../supabase/functions/sales-news-brands/handler.ts'
const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222'
const job:NewsBrandJob={id,actor:id,model:'fast',items:[{n:1,title:'폴뉴아, 서울숲 플래그십 스토어 오픈',summary:'폴뉴아가 14일 서울숲에 매장을 연다'},{n:2,title:'충북음악제 27~29일 개최',summary:'클래식 음악의 울림'},{n:3,title:'해남 고구마 맛탕, 신세계 센텀서 팝업',summary:'SNS 입소문'}]}
const answer=(rows:unknown)=>'결과입니다\n```json\n'+JSON.stringify(rows)+'\n```'
const post=(body:unknown)=>new Request('https://x/',{method:'POST',body:JSON.stringify(body)})
test('prompt lists every article and stays within the request limit',()=>{
 const prompt=newsBrandPrompt(job);assert.ok(prompt.includes('1. 폴뉴아, 서울숲')&&prompt.includes('3. 해남 고구마'));assert.ok(prompt.length<=6000)
 const big={...job,items:Array.from({length:12},(_,i)=>({n:i+1,title:'가'.repeat(200),summary:'나'.repeat(500)}))};assert.ok(newsBrandPrompt(big).length<=6000)
})
test('parse keeps only names and details written in the article',()=>{
 const rows=parseNewsBrands(answer([{n:1,relevant:true,brand:'폴뉴아',event:'플래그십 스토어 오픈',when:'14일',where:'서울숲'},{n:2,relevant:false,brand:'충북음악제',event:'x',when:'',where:''},{n:3,relevant:true,brand:'삼성전자',event:'팝업',when:'12월',where:'신세계 센텀'},{n:9,relevant:true,brand:'x',event:'',when:'',where:''}]),job)
 assert.deepEqual(rows[0],{n:1,relevant:true,brand:'폴뉴아',event:'플래그십 스토어 오픈',when:'14일',where:'서울숲'})
 assert.deepEqual(rows[1],{n:2,relevant:false,brand:'',event:'',when:'',where:''})
 assert.deepEqual(rows[2],{n:3,relevant:false,brand:'',event:'팝업',when:'',where:'신세계 센텀'})
})
test('parse rejects missing rows and non-JSON answers',()=>{
 assert.throws(()=>parseNewsBrands(answer([{n:1,relevant:false,brand:'',event:'',when:'',where:''}]),job));assert.throws(()=>parseNewsBrands('모르겠습니다',job))
 assert.throws(()=>parseNewsBrands(answer([{n:1,relevant:'yes'},{n:2,relevant:false},{n:3,relevant:false}]),job))
})
test('handler claims once, records rows, and records a failure without a second paid call',async()=>{
 let calls=0;const done:[NewsBrandRow[]|null,string][]=[]
 const make=(text:string)=>createNewsBrandHandler({claim:async(_i,t)=>t===token?job:null,generate:async()=>{calls++;return {status:'completed',text}},finish:async(_i,rows,error)=>{done.push([rows,error])}})
 const good=make(answer(job.items.map(i=>({n:i.n,relevant:false,brand:'',event:'',when:'',where:''}))))
 assert.equal((await good(new Request('https://x/'))).status,405);assert.equal((await good(post({id,token,extra:1}))).status,400);assert.equal((await good(post({id,token:id}))).status,403)
 assert.equal((await good(post({id,token}))).status,200);assert.equal(done[0][0]?.length,3);assert.equal(done[0][1],'')
 await make('엉뚱한 답')(post({id,token}));assert.equal(done[1][0],null);assert.match(done[1][1],/판별 미완료/);assert.equal(calls,2)
})
