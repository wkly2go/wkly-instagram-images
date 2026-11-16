import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createNewsWorker,parseNews,plain,type NewsRow} from '../supabase/functions/sales-news/handler.ts'
const now=Date.parse('2026-11-15T03:00:00Z'),id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222'
const item=(over:Record<string,unknown>={})=>({title:'<b>팝업스토어</b> 오픈 &quot;모노&quot;',originallink:'https://news.example.com/a/1#top',link:'https://n.news.naver.com/1',description:'성수동 <b>팝업</b>&amp;전시',pubDate:'Sat, 14 Nov 2026 09:00:00 +0900',...over})
const post=(body:unknown)=>new Request('https://x/functions/v1/sales-news',{method:'POST',body:JSON.stringify(body)})
function worker(over:Record<string,unknown>={},payload:unknown={total:2,items:[item()]},status=200){
 const calls:{url?:string;headers?:Record<string,string>;saved?:NewsRow[];finish?:[string,string]}={}
 const handler=createNewsWorker({id:'key-id',secret:'key-secret',now:()=>now,
  fetcher:(async(url:string,init:RequestInit)=>{calls.url=url;calls.headers=init.headers as Record<string,string>;return new Response(JSON.stringify(payload),{status})}) as typeof fetch,
  claim:async(_i,t)=>t===token?{keyword:'팝업스토어 오픈',days:3}:null,
  save:async(_i,rows)=>{calls.saved=rows},finish:async(_i,s,n)=>{calls.finish=[s,n]},...over})
 return {handler,calls}
}
test('plain removes highlight tags and decodes entities',()=>{
 assert.equal(plain('<b>A</b>&amp;B &#39;C&#x27; &lt;D&gt;\n E',50),"A&B 'C' <D> E");assert.equal(plain(5,10),'');assert.equal(plain('abcdef',3),'abc')
})
test('parseNews keeps recent, linked, unique articles only',async()=>{
 const parsed=await parseNews({total:9,items:[item(),item(),item({originallink:'',link:'https://n.news.naver.com/2'}),item({originallink:'https://old.example.com/1',pubDate:'Sun, 01 Nov 2026 09:00:00 +0900'}),item({originallink:'javascript:alert(1)',link:'ftp://x.example.com/'}),item({originallink:'https://bad.example.com/x',pubDate:'soon'}),item({title:'<b></b>'})]},{keyword:'k',days:3},now)
 assert.equal(parsed.total,9);assert.equal(parsed.scanned,7);assert.equal(parsed.rows.length,2)
 assert.deepEqual({...parsed.rows[0],id:''},{id:'',title:'팝업스토어 오픈 "모노"',summary:'성수동 팝업&전시',url:'https://news.example.com/a/1',published:'2026-11-14T00:00:00.000Z'})
 assert.match(parsed.rows[0].id,/^[0-9a-f]{32}$/);assert.notEqual(parsed.rows[0].id,parsed.rows[1].id)
 await assert.rejects(parseNews({items:[]},{keyword:'k',days:3},now))
})
test('worker rejects other methods, malformed bodies and unknown tokens',async()=>{
 const {handler,calls}=worker()
 assert.equal((await handler(new Request('https://x/',{method:'GET'}))).status,405)
 assert.equal((await handler(post({id,token,query:'x'}))).status,400)
 assert.equal((await handler(post({id:'1',token}))).status,400)
 assert.equal((await handler(post({id,token:id}))).status,403);assert.equal(calls.url,undefined)
})
test('worker searches the fixed host with header keys and records the result',async()=>{
 const {handler,calls}=worker()
 const response=await handler(post({id,token}));assert.equal(response.status,200)
 assert.equal(calls.url,'https://naverapihub.apigw.ntruss.com/search/v1/news?query='+encodeURIComponent('팝업스토어 오픈')+'&display=30&start=1&sort=date')
 assert.equal(calls.headers?.['X-NCP-APIGW-API-KEY-ID'],'key-id');assert.equal(calls.headers?.['X-NCP-APIGW-API-KEY'],'key-secret')
 assert.equal(calls.saved?.length,1);assert.equal(calls.finish?.[0],'완료');assert.ok(!JSON.stringify([calls.finish,await response.json()]).includes('key-'))
})
test('worker reports missing keys, rejected keys and provider failures without leaking them',async()=>{
 const missing=worker({secret:' '});assert.equal((await missing.handler(post({id,token}))).status,502);assert.deepEqual(missing.calls.finish,['실패','네이버 검색 API 키 설정 필요'])
 const denied=worker({},{error:'key-secret'},401);await denied.handler(post({id,token}));assert.match(denied.calls.finish![1],/인증 실패/);assert.equal(denied.calls.saved,undefined)
 const broken=worker({},{total:'x'});await broken.handler(post({id,token}));assert.deepEqual(broken.calls.finish,['실패','네이버 뉴스 수집 응답 검증 실패 · 기존 자료 보존 · 다음 예약에서 다시 수집'])
 const thrown=worker({fetcher:(async()=>{throw new Error('key-secret in url')}) as typeof fetch});const r=await thrown.handler(post({id,token}));assert.ok(!JSON.stringify([thrown.calls.finish,await r.json()]).includes('key-secret'))
})
test('a full page of in-window articles is recorded as partial',async()=>{
 const items=Array.from({length:30},(_,i)=>item({originallink:'https://news.example.com/a/'+i}))
 const {handler,calls}=worker({},{total:500,items});await handler(post({id,token}));assert.equal(calls.finish?.[0],'일부 수집');assert.equal(calls.saved?.length,30)
})
