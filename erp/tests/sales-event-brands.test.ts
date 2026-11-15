import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parse} from 'parse5'
import {brandName,brandKey,extractBrands,research,createEventBrandsHandler} from '../supabase/functions/sales-event-brands/handler.ts'
const url='https://festival.example.com/2026/',job={event_id:'e',title:'시험 페스티벌',url}
const html=`<nav><ul><li>홈</li><li>예매</li></ul></nav><h1>시험 페스티벌</h1><p>참가 브랜드가 많습니다.</p>
<h2>참가 브랜드</h2><ul><li>모노 커피</li><li><a href="https://mono.example">MONO COFFEE</a></li><li>(주)바른식탁</li><li>더 보기</li><li>행사는 10시에 시작합니다.</li><li>02-123-4567</li></ul>
<div><img alt="루프 스튜디오 로고" src="a.png"><img alt="logo"></div>
<h2>오시는 길</h2><ul><li>서울숲역</li></ul>
<h3>후원</h3><table><tr><td>한빛은행</td><td>문의 a@b.com</td></tr></table>
<a href="/2026/exhibitors">참가업체 전체 보기</a><a href="https://other.example/exhibitors">참가업체</a><script>var x="<li>가짜 브랜드</li>"</script>`
test('brand names are short labels, never sentences, numbers, contacts or navigation words',()=>{
 for(const ok of ['모노 커피','MONO COFFEE','(주)바른식탁','A24'])assert.equal(brandName(ok),ok)
 assert.equal(brandName('루프 스튜디오 로고'),'루프 스튜디오')
 for(const bad of ['더 보기','행사는 10시에 시작합니다.','02-123-4567','a@b.com','https://x.com','2026.11.15','12,000원','a','logo','가'.repeat(41),'하나 둘 셋 넷 다섯 여섯'])assert.equal(brandName(bad),null,bad)
 assert.equal(brandKey('(주) 바른 식탁'),brandKey('바른식탁'))
})
test('only items under a participant or sponsor heading are taken, with role and source excerpt',()=>{
 const r=extractBrands(html,url,parse)
 assert.deepEqual(r.brands.map(b=>[b.name,b.role]),[['모노 커피','participant'],['MONO COFFEE','participant'],['(주)바른식탁','participant'],['루프 스튜디오','participant'],['한빛은행','sponsor']])
 assert.equal(r.brands[0].excerpt,'참가 브랜드 · 모노 커피');assert.equal(r.brands[0].url,url)
 assert.deepEqual(r.links,['https://festival.example.com/2026/exhibitors'])
 assert.deepEqual(extractBrands('<ul><li>모노 커피</li></ul>',url,parse).brands,[])
})
test('research reads robots first, at most three same-origin pages, and reports no_list honestly',async()=>{
 const calls:string[]=[]
 const read=async(u:string)=>{calls.push(u);return u.endsWith('robots.txt')?{status:200,contentType:'text/plain',text:'User-agent: *\nDisallow: /private'}:u.endsWith('exhibitors')?{status:200,contentType:'text/html',text:'<h2>Exhibitors</h2><ul><li>모노 커피</li><li>새벽 베이커리</li></ul>'}:{status:200,contentType:'text/html; charset=utf-8',text:html}}
 const r=await research(job,read,parse)
 assert.equal(calls[0],'https://festival.example.com/robots.txt');assert.equal(r.status,'complete');assert.equal(r.pages.length,2)
 assert.ok(r.brands.some(b=>b.name==='새벽 베이커리'));assert.equal(r.brands.filter(b=>brandKey(b.name)===brandKey('모노 커피')).length,1)
 const none=await research(job,async u=>u.endsWith('robots.txt')?{status:404,contentType:'',text:''}:{status:200,contentType:'text/html',text:'<h1>행사 안내</h1><p>곧 공개됩니다.</p>'},parse)
 assert.equal(none.status,'no_list');assert.deepEqual(none.brands,[])
 const blocked=await research(job,async u=>u.endsWith('robots.txt')?{status:200,contentType:'text/plain',text:'User-agent: *\nDisallow: /'}:{status:200,contentType:'text/html',text:html},parse)
 assert.equal(blocked.status,'blocked');assert.deepEqual(blocked.brands,[])
 assert.equal((await research({...job,url:'http://festival.example.com'},read,parse)).status,'blocked')
 assert.equal((await research(job,async()=>{throw new Error('down')},parse)).status,'unavailable')
})
test('worker entry accepts only a claimable id and token and runs in the background',async()=>{
 const id='11111111-1111-4111-8111-111111111111',done:unknown[]=[];let work:Promise<void>|undefined
 const h=createEventBrandsHandler({claim:async(i,t)=>i===id&&t===id?job:null,finish:async(_i,r)=>{done.push(r.status)},read:async u=>u.endsWith('robots.txt')?{status:404,contentType:'',text:''}:{status:200,contentType:'text/html',text:html},parse,background:w=>{work=w}})
 const post=(body:unknown)=>h(new Request('https://x/fn',{method:'POST',body:JSON.stringify(body)}))
 assert.equal((await h(new Request('https://x/fn'))).status,405)
 assert.equal((await post({id:'x',token:id})).status,400);assert.equal((await post({id,token:id,extra:1})).status,400)
 assert.equal((await post({id,token:'22222222-2222-4222-8222-222222222222'})).status,403)
 assert.equal((await post({id,token:id})).status,202);await work;assert.deepEqual(done,['complete'])
})
import {eventBrandSummary} from '../src/lib/salesStrategy.ts'
test('planning page status line shows counts only',()=>{
 assert.equal(eventBrandSummary({scope:'',brand_total:0,events:[]}),'조사할 행사가 아직 없습니다. 08시 자료 취합 뒤 자동으로 시작합니다.')
 const ev=(state:string,n=0)=>({id:state+n,title:'t',state:state as never,note:'',brands:Array.from({length:n},(_,i)=>({id:String(i),name:'b'+i,role:'participant' as const,known_client:false}))})
 assert.equal(eventBrandSummary({scope:'',brand_total:5,events:[ev('complete',3),ev('partial',2),ev('no_list'),ev('waiting'),ev('no_page')]}),'행사 5건 조사 · 참가 · 후원 브랜드 5곳 확보 (2건의 행사) · 목록 미공개 1건 · 조사 대기 1건 · 공식 페이지 미확보 1건')
})
