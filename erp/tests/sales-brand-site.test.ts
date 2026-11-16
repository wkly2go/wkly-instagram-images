import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFollowing,sameSite,titled,candidates,createBrandSiteHandler,googleSearch,inspect,kakaoSearch,naverSearch,type BrandSiteResult,type SearchRow} from '../supabase/functions/sales-brand-site/handler.ts'
const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222'
const results:SearchRow[]=[{url:'https://www.instagram.com/paulnua',title:'폴뉴아 (@paulnua)',description:''},{url:'https://news.example-daily.com/a/1',title:'폴뉴아 오픈',description:''},{url:'https://shop.other.co.kr/',title:'여성의류 쇼핑몰',description:'무관'},{url:'https://www.paulnua.com/about?x=1',title:'<b>폴뉴아</b> 공식 온라인 스토어',description:'PAULNUA'},{url:'https://paulnua.com/',title:'폴뉴아',description:''},{url:'http://plain.paulnua.kr/',title:'폴뉴아',description:''}]
const home='<html><head><title>폴뉴아 | PAULNUA</title><script>var a="x@y.com"</script></head><body><a href="/contact/partnership">제휴 문의</a><a href="https://other.com/contact">문의</a><p>제휴 partner@paulnua.com · 고객센터 help@cs-vendor.co.kr · logo@2x.png</p></body></html>'
const post=(body:unknown)=>new Request('https://x/',{method:'POST',body:JSON.stringify(body)})
function setup(over:Record<string,unknown>={},search:()=>Promise<SearchRow[]>=async()=>results){
 const calls:{queries:string[];read:string[];done?:BrandSiteResult}={queries:[],read:[]}
 const handler=createBrandSiteHandler({providers:[{name:'카카오(다음)',search:async q=>{calls.queries.push(q);return search()}}],
  read:async url=>{calls.read.push(url);return {status:200,contentType:'text/html',text:home}},claim:async(_i,t)=>t===token?{id,brand:'폴뉴아'}:null,finish:async(_i,r)=>{calls.done=r},...over})
 return {handler,calls}
}
test('candidates keep only own-site results that mention the brand',()=>{
 assert.deepEqual(candidates(results,'폴뉴아'),['https://www.paulnua.com/','https://paulnua.com/']);assert.throws(()=>candidates({},'x'))
})
test('inspect requires the brand on the page and takes only same-site contact links and shown addresses',()=>{
 assert.deepEqual(inspect(home,'https://www.paulnua.com/','폴뉴아'),{named:true,contact_page:'https://www.paulnua.com/contact/partnership',emails:['partner@paulnua.com','help@cs-vendor.co.kr'],more:['https://www.paulnua.com/contact/partnership'],thin:true})
 assert.equal(inspect('<title>다른 회사</title><p>hello</p>','https://www.paulnua.com/','폴뉴아').named,false)
})
test('handler searches once and saves a verified site',async()=>{
 const {handler,calls}=setup()
 assert.equal((await handler(new Request('https://x/'))).status,405);assert.equal((await handler(post({id,token,q:'x'}))).status,400);assert.equal((await handler(post({id,token:id}))).status,403)
 assert.equal((await handler(post({id,token}))).status,200)
 assert.deepEqual(calls.queries,['폴뉴아 공식 홈페이지']);assert.deepEqual(calls.read,['https://www.paulnua.com/']);assert.equal(calls.done?.status,'found');assert.equal(calls.done?.homepage,'https://www.paulnua.com/');assert.deepEqual(calls.done?.emails,['partner@paulnua.com','help@cs-vendor.co.kr']);assert.match(calls.done!.note,/카카오\(다음\) 검색/)
})
test('a page that does not name the brand is skipped; nothing is invented when no site qualifies',async()=>{
 const other=setup({read:async()=>({status:200,contentType:'text/html',text:'<title>임대 문의</title>'})});await other.handler(post({id,token}));assert.deepEqual([other.calls.done?.status,other.calls.done?.homepage,other.calls.done?.emails],['not_found','',[]])
 const blocked=setup({read:async()=>{throw new Error('Source unavailable')}});await blocked.handler(post({id,token}));assert.equal(blocked.calls.done?.status,'not_found')
})
test('engines are tried in order; all failing is unavailable, none configured asks for a key',async()=>{
 const none=setup({providers:[]});await none.handler(post({id,token}));assert.deepEqual([none.calls.done?.status,none.calls.done?.note],['unavailable','웹 검색 키 설정 필요'])
 const denied=setup({},async()=>{throw new Error('auth')});await denied.handler(post({id,token}));assert.deepEqual([denied.calls.done?.status,denied.calls.done?.note],['unavailable','카카오(다음) 검색 키 인증 실패'])
 const order:string[]=[];const second=setup({providers:[{name:'A',search:async()=>{order.push('A');throw new Error('quota')}},{name:'B',search:async()=>{order.push('B');return results}}]});await second.handler(post({id,token}))
 assert.deepEqual(order,['A','B']);assert.equal(second.calls.done?.status,'found');assert.match(second.calls.done!.note,/^B 검색/)
})
test('search adapters call fixed hosts with header keys and map results',async()=>{
 const seen:{url:string;headers:Record<string,string>}[]=[]
 const fetcher=(payload:unknown,status=200)=>(async(url:string,init:RequestInit)=>{seen.push({url,headers:init.headers as Record<string,string>});return new Response(JSON.stringify(payload),{status})}) as typeof fetch
 assert.deepEqual(await kakaoSearch('kk',fetcher({documents:[{url:'https://a.com/',title:'A',contents:'c'}]})).search('브랜드 공식 홈페이지'),[{url:'https://a.com/',title:'A',description:'c'}])
 assert.deepEqual(await naverSearch('ni','ns',fetcher({items:[{link:'https://b.com/',title:'B',description:'d'}]})).search('q'),[{url:'https://b.com/',title:'B',description:'d'}])
 assert.match(seen[0].url,/^https:\/\/dapi\.kakao\.com\/v2\/search\/web\?/);assert.equal(seen[0].headers.Authorization,'KakaoAK kk');assert.match(seen[1].url,/^https:\/\/naverapihub\.apigw\.ntruss\.com\/search\/v1\/webkr\?/);assert.ok(!seen.some(s=>/kk|ns/.test(s.url.split('query=')[0])))
 await assert.rejects(kakaoSearch('kk',fetcher({},401)).search('q'),/auth/);await assert.rejects(naverSearch('a','b',fetcher({},429)).search('q'),/quota/);await assert.rejects(kakaoSearch('kk',fetcher({nope:1})).search('q'),/upstream/)
})
test('google adapter turns the answer and its cited sites into candidates only',async()=>{
 let sent:{url?:string;init?:RequestInit}={}
 const fetcher=(payload:unknown,status=200)=>(async(url:string,init:RequestInit)=>{sent={url,init};return new Response(JSON.stringify(payload),{status})}) as typeof fetch
 const rows=await googleSearch('gk',fetcher({candidates:[{content:{parts:[{text:'공식 사이트는 https://www.paulnua.com/ 입니다.'}]},groundingMetadata:{groundingChunks:[{web:{uri:'https://vertexaisearch.cloud.google.com/grounding-api-redirect/x',title:'paulnua.com'}},{web:{uri:'https://x',title:'폴뉴아 - 나무위키'}}]}}]})).search('폴뉴아 공식 홈페이지')
 assert.deepEqual(rows.map(r=>r.url),['https://www.paulnua.com/','https://paulnua.com/']);assert.deepEqual(candidates(rows,'폴뉴아'),['https://www.paulnua.com/','https://paulnua.com/'])
 assert.equal(sent.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');assert.equal((sent.init?.headers as Record<string,string>)['x-goog-api-key'],'gk');assert.deepEqual(JSON.parse(String(sent.init?.body)).tools,[{google_search:{}}])
 assert.deepEqual(await googleSearch('gk',fetcher({candidates:[{content:{parts:[{text:'없음'}]}}]})).search('q'),[])
 await assert.rejects(googleSearch('gk',fetcher({error:{}},400)).search('q'),/auth/);await assert.rejects(googleSearch('gk',fetcher({},429)).search('q'),/quota/);await assert.rejects(googleSearch('gk',fetcher({})).search('q'),/upstream/)
})
test('a site counts as the brand\'s own only when it presents itself under that name',()=>{
 const article='<title>머니 매거진</title><body><a href="/a/1">컬리, 뷰티페스타 체험존 운영</a><p>© 머니 매거진</p></body>'
 assert.equal(inspect(article,'https://www.moneyweekly.co.kr/','컬리').named,false)
 assert.equal(inspect('<title>쇼핑</title><meta property="og:site_name" content="컬리 - 마켓컬리"><body></body>','https://www.kurly.com/','컬리').named,true)
 assert.equal(inspect('<title>Home</title><body><footer>Copyright © 2026 주식회사 폴뉴아. All rights reserved. | 이용약관</footer></body>','https://shop.example.co.kr/','폴뉴아').named,true)
 assert.equal(inspect('<title>Official Store</title><body>welcome</body>','https://www.mlb-korea.com/','MLB').named,true)
 assert.equal(inspect('<title>Official Store</title><body>MLB 관련 소식</body>','https://www.sports-shop.com/','MLB').named,false)
 assert.deepEqual(candidates([{url:'https://money-magazine.co.kr/x',title:'컬리',description:''},{url:'https://thehyundaiblog.com/',title:'컬리',description:''},{url:'https://xn--hz2b150a43d.kr/',title:'컬리',description:''},{url:'https://www.kurly.com/main',title:'컬리 공식',description:''}],'컬리'),['https://www.kurly.com/'])
})

test('redirects are followed only inside the same site, at most three times',async()=>{
 assert.equal(sameSite('https://www.hyundai.com/kr/','https://hyundai.com/'),true);assert.equal(sameSite('https://shop.brand.co.kr/x','https://www.brand.co.kr/'),true)
 assert.equal(sameSite('https://evil.com/brand.co.kr','https://brand.co.kr/'),false);assert.equal(sameSite('http://brand.co.kr/','https://brand.co.kr/'),false);assert.equal(sameSite('https://notbrand.co.kr/','https://brand.co.kr/'),false)
 const seen:string[]=[],pages:Record<string,{status:number;location?:string;text?:string}>={'https://a.com/':{status:302,location:'/ko'},'https://a.com/ko':{status:301,location:'https://www.a.com/ko/main'},'https://www.a.com/ko/main':{status:200,text:'ok'},'https://b.com/':{status:302,location:'https://other.com/'}}
 const read=async(u:string)=>{seen.push(u);const p=pages[u];return {status:p.status,contentType:'text/html',text:p.text??'',...(p.location?{location:p.location}:{})}}
 assert.equal((await readFollowing(read,'https://a.com/')).page.text,'ok');assert.deepEqual(seen,['https://a.com/','https://a.com/ko','https://www.a.com/ko/main'])
 assert.equal((await readFollowing(read,'https://b.com/')).page.status,302)
 let n=0;const loop=await readFollowing(async()=>{n++;return {status:302,contentType:'',text:'',location:'/again'+n}},'https://c.com/');assert.equal(loop.page.status,302);assert.equal(n,4)
})
test('a missing address is looked for on the contact page; a script-drawn front page is accepted by its search title only when it has no other title',async()=>{
 const front='<title>폴뉴아</title><body><a href="/company">회사 소개</a><a href="/contact">제휴 문의</a>'+'<p>브랜드 이야기</p>'.repeat(200)+'</body>'
 const withContact=setup({read:async(u:string)=>({status:200,contentType:'text/html',text:u.endsWith('/contact')?'<p>제휴 문의 biz@paulnua.com</p>':front})});await withContact.handler(post({id,token}))
 assert.deepEqual([withContact.calls.done?.status,withContact.calls.done?.emails,withContact.calls.done?.contact_page],['found',['biz@paulnua.com'],'https://www.paulnua.com/contact'])
 const rootRow=[{url:'https://www.paulnua.com/',title:'폴뉴아 ｜ PAULNUA Corp.',description:'폴뉴아'}]
 assert.deepEqual(titled(rootRow,'폴뉴아'),['https://www.paulnua.com/']);assert.deepEqual(titled([{url:'https://www.paulnua.com/news/1',title:'폴뉴아 소식',description:''}],'폴뉴아'),[])
 const shell=setup({read:async()=>({status:200,contentType:'text/html',text:'<html><body><div id="app"></div><script src="/a.js"></script></body></html>'})},async()=>rootRow);await shell.handler(post({id,token}))
 assert.equal(shell.calls.done?.status,'found');assert.match(shell.calls.done!.note,/검색 결과의 사이트 제목으로/)
 const parked=setup({read:async()=>({status:200,contentType:'text/html',text:'<title>도메인 임대 문의</title><body></body>'})},async()=>rootRow);await parked.handler(post({id,token}));assert.equal(parked.calls.done?.status,'not_found')
})
