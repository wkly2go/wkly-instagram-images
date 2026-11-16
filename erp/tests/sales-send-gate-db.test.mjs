import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),admin=randomUUID(),plan=randomUUID(),one=async(q,p=[])=>(await db.query(q,p)).rows[0]
const stub=['발신 계정·이메일 발송 권한과 전송 처리가 아직 연결되지 않았습니다.','시스템의 수신 자격·문안·제안 범위 검증이 완료되지 않았습니다.']
const material=async()=>(await one(`select private.sales_execution_material('${plan}') m`)).m
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema private;create schema auth;create schema vault;create schema net;
 create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','k');
 create table net.calls(body jsonb);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.calls values(body);select 1::bigint$$;
 create table profiles(id uuid primary key);insert into profiles values('${admin}');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function is_admin() returns boolean language sql as $$select auth.uid() is not null$$;
 create table private.sales_sender_readiness(id boolean primary key default true,code text default 'read_only',email text,can_send boolean default false);insert into private.sales_sender_readiness(email) values('info@thewklyn.com');
 create table private.test_material(payload jsonb,blockers jsonb);
 insert into private.test_material values('${JSON.stringify({messages:[{recipient:'Deal@Client.co.kr'},{recipient:'ask@brand.com'},{recipient:'staff@wkly.test'}],targets:[{source_id:'1',email:'deal@client.co.kr',email_origin:'거래처 DB'},{source_id:'2',email:'ask@brand.com',email_origin:'공식 사이트 공개 주소'},{source_id:'3',email:'staff@wkly.test',email_origin:'연결 없음'}],schedule:{expires_at:'2026-11-17T05:00:00+00:00'},sender:null,transport_enabled:false})}','${JSON.stringify([...stub,'다른 차단 사유'])}');
 create function private.sales_execution_material(p_id uuid) returns jsonb language sql stable as $$select case when p_id='${plan}' then jsonb_build_object('payload',payload,'blockers',blockers,'fingerprint','old') end from private.test_material$$;`)
 await db.exec(`create table sales_execution_packages(strategy_id uuid,version integer,payload jsonb)`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090137_sales_send_gate.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090139_sales_test_package_schedule.sql',import.meta.url),'utf8'))
})
test('with no rule chosen and no send permission nothing can go out, and the placeholders are replaced by real reasons',async()=>{
 const m=await material()
 assert.deepEqual(m.blockers,['다른 차단 사유','발신 계정에 메일 보내기 권한이 없습니다. 드라이브 설정에서 구글 계정을 다시 연결해 주세요.','수신자 범위 규칙이 아직 정해지지 않았습니다. 기획실에서 대표님이 고르면 다시 판정합니다.'])
 assert.deepEqual([m.payload.sender,m.payload.transport_enabled,m.payload.recipient_scope,m.payload.recipient_verification],[null,false,'미정',{}]);assert.match(m.fingerprint,/^[0-9a-f]{64}$/)
 assert.equal((await one("select private.sales_execution_material(gen_random_uuid()) m")).m,null)
})
test('a confirmed sender is kept while a new check runs and dropped when the check fails',async()=>{
 await db.exec("update private.sales_sender_readiness set code='ready',can_send=true");let m=await material()
 assert.deepEqual([m.payload.sender,m.payload.transport_enabled],['info@thewklyn.com',true]);const print=m.fingerprint
 await db.exec("update private.sales_sender_readiness set code='checking',can_send=false");assert.equal((await material()).fingerprint,print)
 await db.exec("update private.sales_sender_readiness set code='read_only',can_send=false");assert.equal((await material()).payload.sender,null)
 await db.exec("update private.sales_sender_readiness set code='ready',can_send=true")
})
test('only the administrator sets the rule; each rule verifies exactly its own kind of address',async()=>{
 await assert.rejects(db.query("select public.sales_recipient_scope_set('거래·문의')"));await db.exec(`select set_config('test.uid','${admin}',false)`)
 await assert.rejects(db.query("select public.sales_recipient_scope_set('모두')"))
 await db.exec("select public.sales_recipient_scope_set('거래·문의')");let m=await material()
 assert.deepEqual(Object.keys(m.payload.recipient_verification),['deal@client.co.kr']);assert.equal(m.payload.recipient_verification['deal@client.co.kr'].status,'verified');assert.equal(m.payload.recipient_verification['deal@client.co.kr'].valid_until.slice(0,10),'2026-11-18')
 assert.equal(m.blockers.at(-1),'수신자 범위 규칙(거래·문의) 밖의 대상이 2곳 있습니다.')
 await db.exec("select public.sales_recipient_scope_set('공개 창구 포함')");m=await material()
 assert.deepEqual(Object.keys(m.payload.recipient_verification).sort(),['ask@brand.com','deal@client.co.kr']);assert.match(m.blockers.at(-1),/밖의 대상이 1곳/)
 await db.exec("insert into private.sales_test_recipients values('staff@wkly.test')");m=await material()
 assert.deepEqual(m.blockers,['다른 차단 사유']);assert.equal(m.payload.recipient_verification['staff@wkly.test'].purpose,'발송 기능 시험')
 assert.equal((await one('select public.sales_recipient_scope_get() s')).s,'공개 창구 포함')
})
test('a test send goes once, only to a named test address, with the fixed text',async()=>{
 await assert.rejects(db.query("select private.sales_dispatch_test_start('customer@brand.com')"))
 const id=(await one("select private.sales_dispatch_test_start(' Staff@wkly.test ') id")).id
 assert.deepEqual((await one('select body from net.calls')).body,{id});await assert.rejects(db.query("select private.sales_dispatch_test_start('staff@wkly.test')"),/10분/)
 const lease=(await one('select public.sales_dispatch_test_claim($1) l',[id])).l
 assert.deepEqual([lease.test,lease.sender,lease.message.recipient,lease.message.subject,lease.attachments],[true,'info@thewklyn.com','staff@wkly.test','[WKLY 인트라넷] 영업 메일 전송 시험',[]])
 assert.equal((await one('select public.sales_dispatch_test_claim($1) l',[id])).l,null)
 await assert.rejects(db.query('select public.sales_dispatch_test_finish($1,gen_random_uuid(),$2,$3)',[id,'accepted','m1']))
 await db.query('select public.sales_dispatch_test_finish($1,$2,$3,$4)',[id,lease.token,'accepted','m1']);await db.query('select public.sales_dispatch_test_finish($1,$2,$3,$4)',[id,lease.token,'accepted','m1'])
 assert.deepEqual(await one('select state,provider_id from private.sales_dispatch_tests'),{state:'accepted',provider_id:'m1'})
 await db.exec("update private.sales_dispatch_tests set created_at=now()-interval '11 minutes';update private.sales_sender_readiness set code='read_only',can_send=false")
 const stale=(await one("select private.sales_dispatch_test_start('staff@wkly.test') id")).id
 assert.equal((await one('select public.sales_dispatch_test_claim($1) l',[stale])).l,null);assert.equal((await one('select state from private.sales_dispatch_tests where id=$1',[stale])).state,'expired')
})
test('a package addressed only to test addresses is scheduled for the next full hour and keeps that hour',async()=>{
 await db.exec(`update private.sales_sender_readiness set code='ready',can_send=true;update private.test_material set payload=jsonb_set(payload,'{messages}','[{"recipient":"staff@wkly.test"}]')`)
 const m=await material(),at=new Date(m.payload.schedule.at)
 assert.equal(m.payload.test_run,true);assert.equal(at.getUTCMinutes(),0);assert.ok(at.getTime()>Date.now()&&at.getTime()-Date.now()<=3600_000)
 assert.equal(new Date(m.payload.schedule.expires_at).getTime()-at.getTime(),4*3600_000);assert.deepEqual(m.blockers,['다른 차단 사유'])
 const kept=new Date(at.getTime()-3*3600_000).toISOString()
 await db.query('insert into sales_execution_packages values($1,1,$2)',[plan,JSON.stringify({test_run:true,schedule:{at:kept,expires_at:new Date(at.getTime()+3600_000).toISOString()}})])
 assert.equal(new Date((await material()).payload.schedule.at).toISOString(),kept)
 await db.exec(`update private.test_material set payload=jsonb_set(payload,'{messages}','[{"recipient":"staff@wkly.test"},{"recipient":"deal@client.co.kr"}]')`)
 const mixed=await material();assert.equal(mixed.payload.test_run,undefined);assert.equal(mixed.payload.schedule.expires_at,'2026-11-17T05:00:00+00:00')
})
