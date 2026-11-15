import {test} from 'node:test'
import assert from 'node:assert/strict'
import {candidates,createBrandSiteHandler,inspect,type BrandSiteResult} from '../supabase/functions/sales-brand-site/handler.ts'
const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222'
const results={web:{results:[{url:'https://www.instagram.com/paulnua',title:'폴뉴아 (@paulnua)',description:''},{url:'https://news.example-daily.com/a/1',title:'폴뉴아 오픈',description:''},{url:'https://shop.other.co.kr/',title:'여성의류 쇼핑몰',description:'무관'},{url:'https://www.paulnua.com/about?x=1',title:'폴뉴아 공식 온라인 스토어',description:'PAULNUA'},{url:'https://paulnua.com/',title:'폴뉴아',description:''},{url:'http://plain.paulnua.kr/',title:'폴뉴아',description:''}]}}
const home='<html><head><title>폴뉴아 | PAULNUA</title><script>var a="x@y.com"</script></head><body><a href="/contact/partnership">제휴 문의</a><a href="https://other.com/contact">문의</a><p>제휴 partner@paulnua.com · 고객센터 help@cs-vendor.co.kr · logo@2x.png</p></body></html>'
const post=(body:unknown)=>new Request('https://x/',{method:'POST',body:JSON.stringify(body)})
function setup(over:Record<string,unknown>={},status=200,payload:unknown=results){
 const calls:{url?:string;headers?:Record<string,string>;read:string[];done?:BrandSiteResult}={read:[]}
 const handler=createBrandSiteHandler({key:'search-key',fetcher:(async(url:string,init:RequestInit)=>{calls.url=url;calls.headers=init.headers as Record<string,string>;return new Response(JSON.stringify(payload),{status})}) as typeof fetch,
  read:async url=>{calls.read.push(url);return {status:200,contentType:'text/html',text:home}},claim:async(_i,t)=>t===token?{id,brand:'폴뉴아'}:null,finish:async(_i,r)=>{calls.done=r},...over})
 return {handler,calls}
}
test('candidates keep only own-site results that mention the brand',()=>{
 assert.deepEqual(candidates(results,'폴뉴아'),['https://www.paulnua.com/','https://paulnua.com/']);assert.throws(()=>candidates({},'x'))
})
test('inspect requires the brand on the page and takes only same-site contact links and shown addresses',()=>{
 assert.deepEqual(inspect(home,'https://www.paulnua.com/','폴뉴아'),{named:true,contact_page:'https://www.paulnua.com/contact/partnership',emails:['partner@paulnua.com','help@cs-vendor.co.kr']})
 assert.equal(inspect('<title>다른 회사</title><p>hello</p>','https://www.paulnua.com/','폴뉴아').named,false)
})
test('handler searches once with the key in a header and saves a verified site',async()=>{
 const {handler,calls}=setup()
 assert.equal((await handler(new Request('https://x/'))).status,405);assert.equal((await handler(post({id,token,q:'x'}))).status,400);assert.equal((await handler(post({id,token:id}))).status,403)
 assert.equal((await handler(post({id,token}))).status,200)
 assert.match(calls.url!,/^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?q=/);assert.equal(calls.headers?.['X-Subscription-Token'],'search-key');assert.ok(!calls.url!.includes('search-key'))
 assert.deepEqual(calls.read,['https://www.paulnua.com/']);assert.equal(calls.done?.status,'found');assert.equal(calls.done?.homepage,'https://www.paulnua.com/');assert.deepEqual(calls.done?.emails,['partner@paulnua.com','help@cs-vendor.co.kr'])
})
test('a page that does not name the brand is skipped; nothing is invented when no site qualifies',async()=>{
 const other=setup({read:async()=>({status:200,contentType:'text/html',text:'<title>임대 문의</title>'})});await other.handler(post({id,token}));assert.deepEqual([other.calls.done?.status,other.calls.done?.homepage,other.calls.done?.emails],['not_found','',[]])
 const blocked=setup({read:async()=>{throw new Error('Source unavailable')}});await blocked.handler(post({id,token}));assert.equal(blocked.calls.done?.status,'not_found')
})
test('missing key, rejected key and quota are reported as unavailable without leaking the key',async()=>{
 const none=setup({key:' '});await none.handler(post({id,token}));assert.deepEqual([none.calls.done?.status,none.calls.done?.note,none.calls.url],['unavailable','웹 검색 키 설정 필요',undefined])
 const denied=setup({},401,{error:'search-key'});await denied.handler(post({id,token}));assert.equal(denied.calls.done?.note,'웹 검색 키 인증 실패')
 const quota=setup({},429,{});await quota.handler(post({id,token}));assert.match(quota.calls.done!.note,/무료 한도/);assert.ok(!JSON.stringify(quota.calls.done).includes('search-key'))
 const broken=setup({},200,{nope:1});await broken.handler(post({id,token}));assert.equal(broken.calls.done?.status,'not_found')
})
