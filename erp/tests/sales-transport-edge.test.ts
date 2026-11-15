import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readPublicPageEdge} from '../supabase/functions/sales-contact-discovery/transport-edge.ts'
import {publicIPv4} from '../supabase/functions/sales-contact-discovery/address.ts'
const page='https://brand.example.com/contact'
const deps=(response:()=>Response,addresses=['93.184.216.34'])=>{const calls:{url?:string;init?:RequestInit}={};return {calls,net:{resolve:async()=>addresses,fetcher:(async(url:string,init:RequestInit)=>{calls.url=url;calls.init=init;return response()}) as typeof fetch}}}
test('address check accepts only public dotted IPv4',()=>{
 for(const ok of ['93.184.216.34','8.8.8.8'])assert.equal(publicIPv4(ok),true)
 for(const bad of ['10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','0.0.0.0','224.0.0.1','::1','1.2.3','256.1.1.1','example.com'])assert.equal(publicIPv4(bad),false)
})
test('reads a public UTF-8 page without following redirects or sending credentials',async()=>{
 const {calls,net}=deps(()=>new Response('<p>문의 hello@brand.example.com</p>',{headers:{'content-type':'text/html; charset=UTF-8'}}))
 const got=await readPublicPageEdge(page,net)
 assert.deepEqual(got,{status:200,contentType:'text/html; charset=UTF-8',text:'<p>문의 hello@brand.example.com</p>'})
 assert.equal(calls.url,page);assert.equal(calls.init?.redirect,'manual');assert.equal(calls.init?.credentials,'omit')
 const moved=deps(()=>new Response(null,{status:302,headers:{location:'http://10.0.0.1/'}}));assert.deepEqual(await readPublicPageEdge(page,moved.net),{status:302,contentType:'',text:''})
})
test('refuses private or unresolved hosts before any request, and unsupported sources',async()=>{
 for(const addresses of [['10.0.0.5'],['93.184.216.34','127.0.0.1'],[]]){const d=deps(()=>new Response('x'),addresses);await assert.rejects(readPublicPageEdge(page,d.net),/Non-public/);assert.equal(d.calls.url,undefined)}
 const d=deps(()=>new Response('x'));await assert.rejects(readPublicPageEdge('http://brand.example.com/',d.net),/Unsupported source/);await assert.rejects(readPublicPageEdge('https://user:pw@brand.example.com/',d.net),/Unsupported source/)
})
test('refuses oversized, non-UTF-8 and broken bodies and hides transport errors',async()=>{
 await assert.rejects(readPublicPageEdge(page,deps(()=>new Response('x',{headers:{'content-length':'600000'}})).net),/Unsupported response/)
 await assert.rejects(readPublicPageEdge(page,deps(()=>new Response('x',{headers:{'content-type':'text/html; charset=euc-kr'}})).net),/Unsupported charset/)
 await assert.rejects(readPublicPageEdge(page,deps(()=>new Response(new Uint8Array(600000))).net),/Unsupported body/)
 await assert.rejects(readPublicPageEdge(page,deps(()=>new Response(new Uint8Array([0xff,0xfe,0xfd]))).net),/Unsupported body/)
 const broken={resolve:async()=>['93.184.216.34'],fetcher:(async()=>{throw new Error('secret detail')}) as typeof fetch};await assert.rejects(readPublicPageEdge(page,broken),e=>e instanceof Error&&e.message==='Source unavailable')
})
