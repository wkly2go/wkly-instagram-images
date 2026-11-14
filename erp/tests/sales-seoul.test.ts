import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createSeoulWorker,parseSeoulApi,type SeoulWorkerDeps} from '../supabase/functions/sales-seoul/handler.ts'
const row={TITLE:'공식 전시',ORG_NAME:'행사 주최사',PLACE:'서울',STRTDATE:'2026-12-01 00:00:00',END_DATE:'2026-12-20 00:00:00',ORG_LINK:'https://culture.seoul.go.kr/culture/culture/cultureEvent/view.do?cultcode=123',CODENAME:'전시'}
const envelope=(rows:unknown[],total=rows.length)=>({culturalEventInfo:{RESULT:{CODE:'INFO-000'},row:rows,list_total_count:total}})
const request=()=>new Request('https://example.test',{method:'POST',body:JSON.stringify({runId:'11111111-1111-4111-8111-111111111111',token:'22222222-2222-4222-8222-222222222222'})})
test('official API separates events from companies and removes expired events, unsafe links',()=>{
 const p=parseSeoulApi(envelope([row,{...row,TITLE:'지난 전시',END_DATE:'2026-11-01'},{...row,TITLE:'출처 확인',ORG_LINK:'https://evil.test/?key=secret',HMPG_ADDR:'javascript:alert(1)'}]),'2026-11-14')
 assert.equal(p.rows.length,2);assert.equal(p.rows[0].organization,'행사 주최사');assert.equal(p.rows[0].id,'cultcode:123');assert.equal(p.rows[1].url,'');assert.equal(p.scanned,3)
 assert.throws(()=>parseSeoulApi({RESULT:{CODE:'ERROR-301'}},'2026-11-14'),/API 승인/)
})
test('worker authenticates before using the key and paginates with no client URL input',async()=>{
 const urls:string[]=[],saved:unknown[]=[],finished:unknown[][]=[]
 const d:SeoulWorkerDeps={key:'serverOnlyKey',now:()=>new Date('2026-11-14T00:00:00Z'),claim:async()=>true,fetcher:async(input,init)=>{urls.push(String(input));assert.equal(init?.redirect,'error');return Response.json(envelope([row],urls.length===1?1001:1001))},page:async(...args)=>{saved.push(args)},finish:async(...args)=>{finished.push(args)}}
 const response=await createSeoulWorker(d)(request());assert.equal(response.status,200);assert.equal(urls.length,2);assert.ok(urls[0].endsWith('/1/1000/'));assert.ok(urls[1].endsWith('/1001/2000/'));assert.equal(saved.length,2);assert.equal(finished[0][1],'완료');assert.ok(!(await response.text()).includes('serverOnlyKey'))
 urls.length=0;d.claim=async()=>false;assert.equal((await createSeoulWorker(d)(request())).status,403);assert.equal(urls.length,0)
})
test('credential-bearing transport errors are sanitized and partial progress marked failed',async()=>{
 const finished:unknown[][]=[];let requests=0
 const d:SeoulWorkerDeps={key:'sensitiveKey',now:()=>new Date('2026-11-14T00:00:00Z'),claim:async()=>true,page:async()=>{},finish:async(...args)=>{finished.push(args)},fetcher:async()=>{if(requests++===0)return Response.json(envelope([row],1001));throw new Error('http://openapi.seoul.go.kr:8088/sensitiveKey')}}
 const response=await createSeoulWorker(d)(request());assert.equal(response.status,502);assert.equal(finished[0][1],'실패');assert.equal(finished[0][2],1);assert.ok(!JSON.stringify(finished).includes('sensitiveKey'));assert.ok(!(await response.text()).includes('sensitiveKey'))
})
test('missing keys fail honestly without scraping or sample fallback',async()=>{
 let fetched=false;const d:SeoulWorkerDeps={claim:async()=>true,fetcher:async()=>{fetched=true;return Response.json({})},page:async()=>{},finish:async()=>{}}
 assert.equal((await createSeoulWorker(d)(request())).status,502);assert.equal(fetched,false)
})
