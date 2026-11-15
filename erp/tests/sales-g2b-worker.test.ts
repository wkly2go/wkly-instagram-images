import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createG2bWorker,type G2bWorkerDeps} from '../supabase/functions/sales-g2b/handler.ts'

const id='00000000-0000-4000-8000-000000000001',token='00000000-0000-4000-8000-000000000002'
const request=(body:unknown={id,token})=>new Request('https://example.test',{method:'POST',body:JSON.stringify(body)})
const row=(n:number)=>({bidNtceNo:`R26TEST${n}`,bidNtceOrd:'000',bidNtceNm:'행사 운영',dminsttNm:'시험 기관',bidClseDt:'2026-11-20 17:00:00',presmptPrce:'12000000',bidNtceDt:'2026-11-12 09:00:00',bidNtceDtlUrl:`https://www.g2b.go.kr/example?bid=${n}`})
function response(page=1,total=1,items:unknown[]=Array.from({length:Math.min(30,Math.max(0,total-(page-1)*30))},(_,i)=>row((page-1)*30+i))){return Response.json({response:{header:{resultCode:'00'},body:{pageNo:page,numOfRows:30,totalCount:total,items}}})}
function setup(overrides:Partial<G2bWorkerDeps>={}){
 const urls:URL[]=[],pages:Parameters<G2bWorkerDeps['page']>[]=[],results:Parameters<G2bWorkerDeps['finish']>[]=[]
 const handler=createG2bWorker({key:'private-test-key',claim:async()=>({category:'service',keyword:'행사',startDate:'2026-11-06',endDate:'2026-11-12'}),fetcher:async input=>{urls.push(new URL(String(input)));return response()},page:async(...args)=>{pages.push(args)},finish:async(...args)=>{results.push(args)},...overrides})
 return {handler,urls,pages,results}
}
test('worker accepts only bounded server jobs and claims before any provider request',async()=>{
 for(const body of [null,{id,token,url:'https://attacker.test'},{id:'wrong',token},{id,token,keyword:'x'.repeat(3000)}]){
  const s=setup({claim:async()=>{throw new Error('must not claim')}});assert.equal((await s.handler(request(body))).status,400);assert.equal(s.urls.length,0)
 }
 const s=setup({claim:async()=>null});assert.equal((await s.handler(request())).status,403);assert.equal(s.urls.length,0)
 assert.equal((await s.handler(new Request('https://example.test'))).status,405)
 const unavailable=setup({claim:async()=>{throw new Error('private-test-key')}})
 const r=await unavailable.handler(request());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private-test-key/)
})
test('worker traverses pages using a fixed server query and records completion only after saving',async()=>{
 const urls:URL[]=[]
 const s=setup({fetcher:async input=>{const u=new URL(String(input));urls.push(u);return response(Number(u.searchParams.get('pageNo')),31)}})
 assert.equal((await s.handler(request())).status,200);assert.equal(s.pages.length,2);assert.equal(s.pages[1][2].length,1);assert.equal(s.results[0][1],'완료')
 assert.equal(s.pages[0][5],s.pages[1][5])
 for(const u of urls){assert.equal(u.hostname,'apis.data.go.kr');assert.equal(u.searchParams.get('inqryBgnDt'),'202611060000');assert.equal(u.searchParams.get('inqryEndDt'),'202611122359');assert.equal(u.searchParams.get('bidNtceNm'),'행사')}
})
test('empty success, format omissions and the 600-row cap report different outcomes',async()=>{
 const empty=setup({fetcher:async()=>response(1,0)});await empty.handler(request());assert.equal(empty.results[0][1],'완료');assert.equal(empty.pages[0][2].length,0)
 const omitted=setup({fetcher:async()=>response(1,2,[row(1),{}])});await omitted.handler(request());assert.equal(omitted.results[0][1],'일부 수집');assert.equal(omitted.pages[0][4],1)
 for(const total of [600,601]){
  const s=setup({fetcher:async input=>response(Number(new URL(String(input)).searchParams.get('pageNo')),total)});await s.handler(request());assert.equal(s.pages.length,20);assert.equal(s.results[0][1],total===600?'완료':'일부 수집')
 }
})
test('provider failure or shifting totals preserves saved pages without reporting full coverage',async()=>{
 for(const kind of ['failure','changed total']){
  let calls=0;const s=setup({fetcher:async()=>{if(++calls===1)return response(1,31);if(kind==='failure')throw new Error('private-test-key');return response(2,32)}})
  const r=await s.handler(request());assert.equal(r.status,502);assert.equal(s.pages.length,1);assert.equal(s.results[0][1],'일부 수집');assert.doesNotMatch(JSON.stringify(s.results)+await r.text(),/private-test-key/)
 }
 const bad=setup({fetcher:async()=>new Response('x'.repeat(2*1024*1024+1))});await bad.handler(request());assert.equal(bad.results[0][1],'실패');assert.equal(bad.pages.length,0)
})
test('missing configuration and storage failures never expose credentials or hand data processing to people',async()=>{
 const missing=setup({key:undefined});await missing.handler(request());assert.equal(missing.urls.length,0);assert.equal(missing.results[0][1],'실패')
 const failed=setup({page:async()=>{throw new Error('private-test-key')}});const r=await failed.handler(request());assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/private-test-key/)
 const incomplete=setup({fetcher:async()=>response(1,1,[{...row(1),bidClseDt:'',presmptPrce:'',bidNtceDtlUrl:''}])});await incomplete.handler(request())
 assert.equal(incomplete.pages[0][2][0].warnings.length,3);assert.ok(incomplete.pages[0][2][0].warnings.every(w=>w.includes('자동')))
})
test('background mode acknowledges the job while retaining the asynchronous result',async()=>{
 let work:Promise<void>|undefined,release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 const s=setup({background:p=>{work=p},fetcher:async()=>{await gate;return response()}})
 const r=await s.handler(request());assert.equal(r.status,202);assert.equal(s.results.length,0);assert.ok(work)
 release();await work;assert.equal(s.results[0][1],'완료')
})
