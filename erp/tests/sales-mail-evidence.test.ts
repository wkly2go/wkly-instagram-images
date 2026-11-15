import {test} from 'node:test'
import assert from 'node:assert/strict'
import {collectMailEvidence,extractMessage,createMailEvidenceHandler} from '../supabase/functions/sales-mail-evidence/handler.ts'
const now=Date.parse('2026-11-15T04:00:00Z'),target={id:'abc123',thread_id:'def456',emails:['person@example.com']},mailbox='sales@example.com'
const encode=(s:string)=>Buffer.from(s).toString('base64url')
const message=()=>({id:target.id,threadId:target.thread_id,labelIds:['INBOX'],internalDate:String(now-1000),payload:{mimeType:'text/plain',headers:[{name:'From',value:'Person <person@example.com>'},{name:'To',value:mailbox},{name:'Content-Type',value:'text/plain; charset=UTF-8'}],body:{data:encode('다음 달 팝업 운영 견적 문의입니다.')}}})
const config={clientId:'test-client',clientSecret:'test-secret',refreshToken:'test-refresh'},token={access_token:'test-access',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'},job={mailbox,messages:[target]}
test('matches actual envelope and time without granting permission',()=>{
 const r=extractMessage(message(),target,mailbox,now);assert.equal(r.status,'retrieved');assert.equal(r.direction,'inbound');assert.match(r.text,/견적/);assert.equal(r.truncated,false)
 const out=message();out.payload.headers[0].value=mailbox;out.payload.headers[1].value='person@example.com';assert.equal(extractMessage(out,target,mailbox,now).direction,'outbound')
 for(const mutate of [(m:any)=>m.id='bad',(m:any)=>m.threadId='bad',(m:any)=>m.internalDate=String(now+1),(m:any)=>m.internalDate=String(now-181*86400000),(m:any)=>m.labelIds.push('TRASH'),(m:any)=>m.payload.headers.push({name:'From',value:'spoof@example.com'}),(m:any)=>m.payload.headers[0].value='notperson@example.com',(m:any)=>m.payload.headers[1].value='sales@example.com, other@example.com',(m:any)=>m.payload.headers[0].value='fake@example.com, Person <person@example.com>']){const raw=message();mutate(raw);assert.equal(extractMessage(raw,target,mailbox,now).status,'mismatch')}
})
test('skips attachments, forwarded messages, HTML and unsupported encodings; marks truncation',()=>{
 const raw:any=message(),plain={mimeType:'text/plain',body:{data:encode('original request')}},html={mimeType:'text/html',body:{data:encode('<script>alert(1)</script>')}}
 raw.payload={...raw.payload,mimeType:'multipart/mixed',parts:[plain,{...plain,filename:'secret.txt',body:{data:encode('attachment secret')}},{mimeType:'message/rfc822',parts:[plain]},html]}
 assert.equal(extractMessage(raw,target,mailbox,now).text,'original request')
 for(const part of [html,{...plain,headers:[{name:'Content-Type',value:'text/plain; charset=euc-kr'}]},{...plain,body:{attachmentId:'a'}},{...plain,body:{data:'_w'}}]){raw.payload.parts=[part];assert.equal(extractMessage(raw,target,mailbox,now).status,'unsupported')}
 raw.payload.parts=[{...plain,body:{data:encode('x'.repeat(7000))}}];const r=extractMessage(raw,target,mailbox,now);assert.equal(r.text.length,6000);assert.equal(r.truncated,true)
})
test('uses existing read grant, verifies mailbox and GETs only queued messages',async()=>{
 const calls:{url:string;init:RequestInit}[]=[]
 const fetcher:typeof fetch=async(u,init)=>{calls.push({url:String(u),init:init!});return Response.json(calls.length===1?token:calls.length===2?{emailAddress:mailbox}:message())}
 const r=await collectMailEvidence(job,config,fetcher,now);assert.equal(r.status,'complete');assert.equal(calls.length,3);assert.doesNotMatch(String(calls[0].init.body),/scope=/)
 assert.ok(calls.slice(1).every(c=>c.init.method==='GET'));assert.match(calls[2].url,/messages\/abc123\?format=full$/);assert.ok(calls.every(c=>c.init.redirect==='error'));assert.doesNotMatch(JSON.stringify(r),/test-secret|test-access|test-refresh/)
})
test('wrong account, metadata scope, invalid jobs and missing config never read messages',async()=>{
 for(const variant of ['scope','account','config','id','count']){let calls=0;const fetcher:typeof fetch=async()=>{calls++;return Response.json(calls===1?{...token,scope:variant==='scope'?'https://www.googleapis.com/auth/gmail.metadata':token.scope}:{emailAddress:'other@example.com'})}
  const j=structuredClone(job);if(variant==='id')j.messages[0].id='../../profile';if(variant==='count')j.messages=Array(6).fill(target)
  assert.equal((await collectMailEvidence(j,variant==='config'?null:config,fetcher,now)).status,'account_unavailable');assert.ok(calls<=2)
 }
})
test('oversized provider responses produce sanitized partial evidence without retry',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return calls===1?Response.json(token):calls===2?Response.json({emailAddress:mailbox}):new Response('secret'.repeat(200000))}
 const r=await collectMailEvidence(job,config,fetcher,now);assert.equal(calls,3);assert.equal(r.status,'partial');assert.equal(r.messages[0].status,'unavailable');assert.doesNotMatch(JSON.stringify(r),/secret/)
})
test('one-use claim precedes provider access and save failures stay visible',async()=>{
 const id='10000000-0000-4000-8000-000000000001',key='20000000-0000-4000-8000-000000000001';let calls=0
 const handler=createMailEvidenceHandler({claim:async()=>null,config:async()=>{calls++;return config},finish:async()=>{calls++},fetcher:fetch}),req=(body:any)=>new Request('https://example.test',{method:'POST',body:JSON.stringify(body)})
 assert.equal((await handler(req({id,token:key}))).status,403);assert.equal((await handler(req({id,token:key,url:'https://evil.test'}))).status,400);assert.equal(calls,0)
 const broken=createMailEvidenceHandler({claim:async()=>job,config:async()=>null,finish:async()=>{throw new Error('private details')},fetcher:fetch});const r=await broken(req({id,token:key}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private details/)
})
