import {test} from 'node:test'
import assert from 'node:assert/strict'
import {approvedMime,dispatchMessageId,transmitGmail} from '../supabase/functions/sales-dispatch/gmail.ts'
import {runSalesDispatch,type DispatchLease} from '../supabase/functions/sales-dispatch/worker.ts'
const lease:DispatchLease={id:'10000000-0000-4000-8000-000000000001',token:'claim',fingerprint:'reviewed',sender:'sender@example.com',message:{recipient:'person@example.com',subject:'팝업 행사 운영 제안 · 검토 문안',body:'안녕하세요.\n확인한 행사 제안입니다.'},attachments:[{name:'proposal.md',mime:'text/markdown; charset=utf-8',content:'# 승인된 제안\n확인한 범위'}],expires_at:'2026-11-16T04:00:00Z'}
const now=()=>Date.parse('2026-11-16T01:00:00Z'),config={enabled:true,clientId:'client',clientSecret:'secret',refreshToken:'refresh',expectedEmail:lease.sender},token={access_token:'token',scope:'https://www.googleapis.com/auth/gmail.modify',expires_in:3600}
const signal=()=>new AbortController().signal
test('MIME has exactly one recipient, stable reconciliation ID, a plain and a designed HTML part with the plan inside',()=>{
 const mime=approvedMime(lease,now());assert.match(mime,/^From: sender@example.com\r\nTo: person@example.com\r\n/);assert.equal((mime.match(/^To:/gm)??[]).length,1);assert.doesNotMatch(mime,/^Bcc:|^Cc:/m);assert.ok(mime.includes(dispatchMessageId(lease)))
 assert.match(mime,/multipart\/alternative/);assert.match(mime,/Content-Type: text\/html; charset=UTF-8/);assert.doesNotMatch(mime,/filename="proposal.md"/)
 const parts=[...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map(m=>Buffer.from(m[1].replace(/\r\n/g,''),'base64').toString('utf8'))
 assert.ok(parts[0].includes('확인한 행사 제안입니다.')&&parts[0].includes('확인한 범위'))
 assert.ok(parts[1].includes('<!doctype html>')&&parts[1].includes('확인한 범위')&&parts[1].includes('확인한 행사 제안입니다.'))
 const subject=mime.match(/Subject: ([\s\S]*?)\r\nMessage-ID:/)![1];const decoded=[...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map(m=>Buffer.from(m[1],'base64').toString('utf8')).join('');assert.equal(decoded,lease.message.subject)
})
test('invalid headers, multi-recipient addresses and unreviewed attachment formats are rejected',()=>{
 for(const bad of [{...lease,sender:'a@example.com\r\nBcc: x@example.com'},{...lease,message:{...lease.message,recipient:'one@example.com,two@example.com'}},{...lease,message:{...lease.message,subject:'hi\r\nBcc: x@example.com'}},{...lease,attachments:[{...lease.attachments[0],name:'bad\".md'}]},{...lease,attachments:[{...lease.attachments[0],mime:'text/html'}]}])assert.throws(()=>approvedMime(bad))
})
test('disabled adapter has no provider traffic; mismatched account or read-only scope cannot send',async()=>{
 let calls=0;const noCalls:typeof fetch=async()=>{calls++;throw new Error()};assert.deepEqual(await transmitGmail(lease,signal(),{...config,enabled:false},noCalls,now),{outcome:'rejected'});assert.equal(calls,0)
 for(const variant of ['scope','account']){const urls:string[]=[];const fetcher:typeof fetch=async url=>{urls.push(String(url));return Response.json(urls.length===1?{...token,scope:variant==='scope'?'https://www.googleapis.com/auth/gmail.readonly':token.scope}:{emailAddress:'other@example.com'})};assert.equal((await transmitGmail(lease,signal(),config,fetcher,now)).outcome,'rejected');assert.ok(!urls.some(u=>u.endsWith('/send')))}
})
test('verified profile sends exact encoded MIME once and records provider acceptance only',async()=>{
 const urls:string[]=[],bodies:string[]=[];const fetcher:typeof fetch=async(url,init)=>{urls.push(String(url));bodies.push(String(init?.body??''));assert.equal(init?.redirect,'error');return Response.json(urls.length===1?token:urls.length===2?{emailAddress:lease.sender}:{id:'abc123',threadId:'def456'})}
 const result=await transmitGmail(lease,signal(),config,fetcher,now);assert.deepEqual(result,{outcome:'accepted',providerId:'abc123'});assert.equal(urls.filter(u=>u.endsWith('/send')).length,1)
 assert.equal(Buffer.from(JSON.parse(bodies[2]).raw,'base64url').toString('utf8'),approvedMime(lease,now()));assert.doesNotMatch(bodies[0],/scope=/)
})
test('lost send response stays unknown and only the database receipt write may retry',async()=>{
 let sends=0,writes=0;const fetcher:typeof fetch=async url=>{if(String(url).endsWith('/token'))return Response.json(token);if(String(url).endsWith('/profile'))return Response.json({emailAddress:lease.sender});sends++;throw new Error('private provider response')}
 const result=await runSalesDispatch(lease.id,{now,claim:async()=>lease,transmit:(l,s)=>transmitGmail(l,s,config,fetcher,now),finish:async(_id,_token,outcome,receipt)=>{assert.equal(outcome,'unknown');assert.equal(receipt,null);if(++writes===1)throw new Error('db')}})
 assert.deepEqual(result,{state:'unknown',recorded:true});assert.equal(sends,1);assert.equal(writes,2)
})
test('expired during profile verification never reaches the send endpoint',async()=>{
 let calls=0,time=now();const fetcher:typeof fetch=async()=>{calls++;if(calls===2)time=Date.parse(lease.expires_at);return Response.json(calls===1?token:{emailAddress:lease.sender})};assert.equal((await transmitGmail(lease,signal(),config,fetcher,()=>time)).outcome,'rejected');assert.equal(calls,2)
})
