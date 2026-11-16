import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {transmitInstagram} from '../supabase/functions/sales-dispatch/instagram.ts'
import {inboundMessages,signatureValid,verifySubscription} from '../supabase/functions/sales-instagram/handler.ts'
import type {DispatchLease} from '../supabase/functions/sales-dispatch/worker.ts'
const lease:DispatchLease={id:'10000000-0000-4000-8000-000000000009',token:'claim',fingerprint:'f',sender:'sender@example.com',message:{channel:'instagram',recipient:'ig:1784000000000001',subject:'',body:'문의 주셔서 감사합니다. 팝업 일정 정리해 드릴게요.'},attachments:[{name:'proposal.md',mime:'text/markdown',content:'x'}],expires_at:'2026-11-16T04:00:00Z'}
const now=()=>Date.parse('2026-11-16T01:00:00Z'),signal=()=>new AbortController().signal

test('a DM goes to the one approved Instagram user with the approved text only',async()=>{
 const calls:{url:string,init:RequestInit}[]=[]
 const fetcher=(async(url:string,init:RequestInit)=>{calls.push({url,init});return new Response(JSON.stringify({recipient_id:'1784000000000001',message_id:'aWdfZAG1'}),{status:200})}) as typeof fetch
 const r=await transmitInstagram(lease,signal(),{enabled:true,token:'tok'},fetcher,now)
 assert.deepEqual(r,{outcome:'accepted',providerId:'aWdfZAG1'})
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://graph.instagram.com/v21.0/me/messages')
 assert.deepEqual(JSON.parse(String(calls[0].init.body)),{recipient:{id:'1784000000000001'},message:{text:lease.message.body}})
})

test('switch off, no token, bad recipient, long text or expired approval never call Instagram',async()=>{
 let called=0;const fetcher=(async()=>{called++;return new Response('{}')}) as typeof fetch
 for(const [l,c] of [[lease,{enabled:false,token:'tok'}],[lease,{enabled:true,token:null}],[{...lease,message:{...lease.message,recipient:'person@example.com'}},{enabled:true,token:'tok'}],[{...lease,message:{...lease.message,body:'가'.repeat(1001)}},{enabled:true,token:'tok'}],[{...lease,expires_at:'2026-11-16T00:00:00Z'},{enabled:true,token:'tok'}]] as const)
  assert.deepEqual(await transmitInstagram(l as DispatchLease,signal(),c,fetcher,now),{outcome:'rejected'})
 assert.equal(called,0)
})

test('a 4xx is a rejection, a lost 5xx answer stays unknown (never resent)',async()=>{
 const four=(async()=>new Response(JSON.stringify({error:{message:'outside window'}}),{status:400})) as typeof fetch
 assert.deepEqual(await transmitInstagram(lease,signal(),{enabled:true,token:'tok'},four,now),{outcome:'rejected'})
 const five=(async()=>new Response('oops',{status:502})) as typeof fetch
 await assert.rejects(transmitInstagram(lease,signal(),{enabled:true,token:'tok'},five,now),/unknown/)
})

test('webhook accepts only Meta-signed bodies and the stored verify token',async()=>{
 const raw=JSON.stringify({object:'instagram'}),sig='sha256='+createHmac('sha256','appsecret').update(raw).digest('hex')
 assert.equal(await signatureValid(raw,sig,'appsecret'),true)
 assert.equal(await signatureValid(raw,sig,'other'),false)
 assert.equal(await signatureValid(raw,null,'appsecret'),false)
 assert.equal(await signatureValid(raw,sig,null),false)
 const u=(q:string)=>new URL('https://x.test/f?'+q)
 assert.equal(verifySubscription(u('hub.mode=subscribe&hub.verify_token=abc&hub.challenge=123'),'abc'),'123')
 assert.equal(verifySubscription(u('hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123'),'abc'),null)
 assert.equal(verifySubscription(u('hub.mode=subscribe&hub.verify_token=abc&hub.challenge=<x>'),'abc'),null)
})

test('only messages people sent us are kept; echoes and our own account are skipped',()=>{
 const body={object:'instagram',entry:[{id:'1700000000000000',messaging:[
  {sender:{id:'1784000000000001'},recipient:{id:'1700000000000000'},timestamp:1794800000000,message:{mid:'m1',text:'팝업 대관 문의드려요'}},
  {sender:{id:'1700000000000000'},recipient:{id:'1784000000000001'},timestamp:1794800001000,message:{mid:'m2',text:'답장',is_echo:true}},
  {sender:{id:'1784000000000002'},timestamp:1794800002000,message:{mid:'m3',attachments:[{type:'image'}]}},
  {sender:{id:'bad'},message:{mid:'m4',text:'x'}},
 ]}]}
 assert.deepEqual(inboundMessages(body),[{mid:'m1',ig_user:'1784000000000001',text:'팝업 대관 문의드려요',timestamp:1794800000000},{mid:'m3',ig_user:'1784000000000002',text:'(첨부 1개)',timestamp:1794800002000}])
 assert.deepEqual(inboundMessages({object:'page',entry:[]}),[])
})
