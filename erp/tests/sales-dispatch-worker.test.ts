import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runSalesDispatch,type DispatchDeps,type DispatchLease} from '../supabase/functions/sales-dispatch/worker.ts'
const lease:DispatchLease={id:'job',token:'lease',fingerprint:'approved',sender:'sender@example.com',message:{recipient:'recipient@example.com',subject:'Reviewed subject',body:'Reviewed body'},attachments:[{name:'proposal.md',mime:'text/markdown',content:'Reviewed proposal'}],expires_at:'2026-11-16T04:00:00Z'}
const now=()=>Date.parse('2026-11-16T01:00:00Z')
test('unclaimed or unavailable jobs never reach the provider',async()=>{
 let sends=0
 const d:DispatchDeps={now,claim:async()=>null,transmit:async()=>{sends++;return {outcome:'rejected'}},finish:async()=>assert.fail('no lease')}
 assert.equal((await runSalesDispatch('job',d)).state,'not_claimed')
 d.claim=async()=>{throw new Error('db')};assert.equal((await runSalesDispatch('job',d)).state,'claim_unavailable');assert.equal(sends,0)
})
test('exact material is sent once even when recording the receipt needs a retry',async()=>{
 let sends=0,writes=0
 const d:DispatchDeps={now,claim:async()=>lease,transmit:async value=>{assert.deepEqual(value,lease);sends++;return {outcome:'accepted',providerId:'provider-1'}},finish:async(id,token,state,receipt)=>{assert.deepEqual([id,token,state,receipt],['job','lease','accepted','provider-1']);if(++writes===1)throw new Error('db')}}
 assert.deepEqual(await runSalesDispatch('job',d),{state:'accepted',recorded:true});assert.equal(sends,1);assert.equal(writes,2)
})
test('lost provider response becomes unknown without retrying transmission or storing raw errors',async()=>{
 let sends=0;const results:unknown[]=[]
 const d:DispatchDeps={now,claim:async()=>lease,transmit:async()=>{sends++;throw new Error('sensitive provider detail')},finish:async(...args)=>{results.push(args)}}
 assert.deepEqual(await runSalesDispatch('job',d),{state:'unknown',recorded:true});assert.equal(sends,1);assert.deepEqual(results,[['job','lease','unknown',null]])
})
test('expired lease does not send and missing receipt never counts as accepted',async()=>{
 let sends=0
 const d:DispatchDeps={now:()=>Date.parse(lease.expires_at),claim:async()=>lease,transmit:async()=>{sends++;return {outcome:'accepted',providerId:''}},finish:async()=>{}}
 assert.equal((await runSalesDispatch('job',d)).state,'rejected');assert.equal(sends,0)
 d.now=now;assert.equal((await runSalesDispatch('job',d)).state,'unknown');assert.equal(sends,1)
})
test('result persistence failure is reported separately from provider acceptance',async()=>{
 let sends=0
 const d:DispatchDeps={now,claim:async()=>lease,transmit:async()=>{sends++;return {outcome:'accepted',providerId:'provider-2'}},finish:async()=>{throw new Error('db')}}
 assert.deepEqual(await runSalesDispatch('job',d),{state:'accepted',recorded:false});assert.equal(sends,1)
})
test('timeout aborts the attempt and never launches another send',async()=>{
 let sends=0,aborted=false
 const d:DispatchDeps={now:()=>Date.parse(lease.expires_at)-5,claim:async()=>lease,transmit:async(_,signal)=>{sends++;signal.addEventListener('abort',()=>{aborted=true});return await new Promise(()=>{})},finish:async()=>{}}
 assert.equal((await runSalesDispatch('job',d)).state,'unknown');assert.equal(sends,1);assert.equal(aborted,true)
})
