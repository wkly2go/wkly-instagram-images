import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parse} from 'parse5'
import {researchPage,research,createResearchHandler} from '../supabase/functions/sales-followup-research/handler.ts'
const website='https://company.com/',job={website,questions:['행사 운영 서비스 범위']}
test('research extracts bounded visible evidence and actual same-origin service links',()=>{
 const result=researchPage('<script>비밀</script><nav>메뉴만</nav><form>문의 전송</form><p hidden>숨김</p><p>행사 운영 서비스: 현장 운영과 안전 관리</p><a href="/service">서비스</a><a href="https://evil.com/service">외부</a><a href="/service?token=secret">쿼리</a>',website,job.questions,parse)
 assert.match(result.excerpt,/현장 운영/);assert.doesNotMatch(result.excerpt,/비밀|숨김|문의 전송|메뉴만/);assert.deepEqual(result.links,['https://company.com/service']);assert.ok(result.excerpt.length<=1200)
})
test('research reads robots and at most three pages with no recursive crawl or submission',async()=>{
 const calls:string[]=[];const result=await research(job,async url=>{calls.push(url);return url.endsWith('/robots.txt')?{status:404,contentType:'text/plain',text:''}:{status:200,contentType:'text/html',text:'<p>행사 운영</p><a href="/service">서비스</a><a href="/about">소개</a><a href="/event">행사</a>'}},parse)
 assert.equal(calls.length,4);assert.equal(result.pages.length,3);assert.equal(result.limited,true);assert.equal(result.status,'partial');assert.ok(result.pages.every(p=>p.url.startsWith(website)))
})
test('robots denials, unavailable rules, redirects and unsupported pages preserve explicit failures',async()=>{
 for(const page of [{status:200,contentType:'text/plain',text:'User-agent: *\nDisallow: /'},{status:503,contentType:'text/plain',text:''}]){let calls=0;const result=await research(job,async()=>{calls++;return page},parse);assert.equal(calls,1);assert.equal(result.status,page.status===503?'unavailable':'blocked')}
 const result=await research(job,async url=>url.endsWith('/robots.txt')?{status:404,contentType:'text/plain',text:''}:{status:302,contentType:'text/html',text:''},parse);assert.equal(result.status,'unavailable');assert.deepEqual(result.pages,[{url:website,status:'failed',excerpt:''}])
})
test('unclaimed requests never access a website; failed persistence retries without repeating reads',async()=>{
 const id='10000000-0000-4000-8000-000000000001',token='20000000-0000-4000-8000-000000000002';const request=()=>new Request('https://internal.test',{method:'POST',body:JSON.stringify({id,token})});let reads=0,writes=0
 const read=async()=>{reads++;return{status:404,contentType:'text/plain',text:''}}
 const denied=createResearchHandler({claim:async()=>null,finish:async()=>{},read,parse});assert.equal((await denied(request())).status,403);assert.equal(reads,0)
 const handler=createResearchHandler({claim:async()=>job,finish:async()=>{if(++writes===1)throw new Error('db')},read,parse});assert.equal((await handler(request())).status,200);assert.equal(reads,2);assert.equal(writes,2)
})
