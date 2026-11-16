import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile(new URL('../supabase/migrations/20261116120600_sales_followups_upcoming.sql',import.meta.url),'utf8')
const S='11111111-1111-4111-8111-111111111111',P='22222222-2222-4222-8222-222222222222',J='33333333-3333-4333-8333-333333333333'
const base=`create role anon;create role authenticated;create role service_role;create schema private;create schema vault;create schema net;
 create table vault.secrets(name text,secret text);create view vault.decrypted_secrets as select name,secret decrypted_secret from vault.secrets;insert into vault.secrets values('WKLY_EDGE_ANON_KEY','k');
 create table posts(body jsonb);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into public.posts values(body);select 1::bigint$$;
 create table switch(on_ boolean);insert into switch values(true);create function public.sales_dispatch_enabled() returns boolean language sql as $$select on_ from public.switch$$;
 create table private.sales_ops_steps(step text primary key,label text,call text,every_min integer,grace_min integer);
 create table sales_collection_runs(x int);
 create function private.sales_news_queue() returns integer language plpgsql as $f$declare w text[];begin w:=(case (extract(hour from now() at time zone 'Asia/Seoul')::integer/3)%3 when 0 then array['a'] when 1 then array['b'] else array['팝업스토어 운영','식음료 팝업'] end);return array_length(w,1);end $f$;
 create table base_material(m jsonb);create function private.sales_execution_material(p uuid) returns jsonb language sql stable as $$select m from public.base_material$$;
 create table public.sales_execution_packages(id uuid primary key,strategy_id uuid,status text,payload jsonb);
 create table private.sales_dispatch_jobs(id uuid primary key,package_id uuid,strategy_id uuid,recipient text,state text,message jsonb,provider_id text,finished_at timestamptz);
 create table private.sales_crm_threads(dispatch_id uuid,stage text default '접수 확인',last_reply_at timestamptz);
 create table private.sales_contact_suppressions(recipient text);
 create table public.brand_contacts(email text,opt_out boolean);
 create table public.mail_index(id text,thread_id text);`
async function setup(){const db=new PGlite();await db.exec(base);await db.exec(sql);await db.exec(sql);return db}
const material={payload:{title:'폴뉴아 연말 팝업 수행 계획',messages:[{channel:'email',recipient:'a@brand.com',subject:'폴뉴아 제안'}],schedule:{at:'2026-11-17T01:00:00Z'}},blockers:[],fingerprint:'x'}
async function sent(db){
 await db.query(`insert into public.sales_execution_packages values($1,$2,'승인',$3)`,[P,S,JSON.stringify({sender:'info@thewklyn.com',followups:(await db.query("select private.sales_followup_texts('폴뉴아 연말 팝업 수행 계획') f")).rows[0].f})])
 await db.query(`insert into private.sales_dispatch_jobs values($1,$2,$3,'a@brand.com','claimed','{"channel":"email","subject":"폴뉴아 제안"}','abc',now())`,[J,P,S])
 await db.query(`insert into public.mail_index values('abc','t1')`)
 await db.query(`update private.sales_dispatch_jobs set state='accepted' where id=$1`,[J])
}
test('the approved package carries two follow-up texts and a changed fingerprint',async()=>{
 const db=await setup();await db.query('insert into base_material values($1)',[JSON.stringify(material)])
 const m=(await db.query(`select private.sales_execution_material('${S}') m`)).rows[0].m
 assert.equal(m.payload.followups.length,2);assert.match(m.payload.followups[0].body,/폴뉴아 연말 팝업 수행 계획/);assert.match(m.payload.followups[0].body,/원치 않으시면/)
 assert.match(m.payload.schedule.followups,/4·10영업일/);assert.notEqual(m.fingerprint,'x')
 await db.exec(`update base_material set m=jsonb_set(m,'{payload,test_run}','true')`)
 assert.equal((await db.query(`select private.sales_execution_material('${S}') m`)).rows[0].m.payload.followups,undefined)
})
test('accepting the first mail schedules follow-ups on business days, which are sent in the same thread',async()=>{
 const db=await setup();await sent(db)
 const rows=(await db.query(`select seq,subject,extract(isodow from scheduled_at at time zone 'Asia/Seoul') dow,to_char(scheduled_at at time zone 'Asia/Seoul','HH24:MI') hm from private.sales_followups order by seq`)).rows
 assert.equal(rows.length,2);assert.equal(rows[0].subject,'Re: 폴뉴아 제안');for(const r of rows){assert.ok(Number(r.dow)<6);assert.equal(r.hm,'10:00')}
 await db.exec("update private.sales_followups set scheduled_at=now()-interval '1 minute' where seq=1")
 assert.equal((await db.query('select private.sales_followup_send_tick() n')).rows[0].n,1)
 const id=(await db.query('select id from private.sales_followups where seq=1')).rows[0].id
 const lease=(await db.query('select public.sales_followup_send_claim($1) l',[id])).rows[0].l
 assert.equal(lease.message.thread_id,'t1');assert.equal(lease.message.in_reply_to,J);assert.equal(lease.followup,true)
 await db.query("select public.sales_followup_send_finish($1,$2,'accepted','def')",[id,lease.token])
 assert.equal((await db.query('select state from private.sales_followups where seq=1')).rows[0].state,'accepted')
})
test('a reply, an opt-out or a held package cancels the follow-up; a switched-off sender waits',async()=>{
 for(const stop of ["update private.sales_crm_threads set last_reply_at=now()","insert into private.sales_contact_suppressions values('a@brand.com')","update public.sales_execution_packages set status='보류'"]){
  const db=await setup();await sent(db);await db.query(`insert into private.sales_crm_threads(dispatch_id) values($1)`,[J]);await db.exec(stop)
  await db.exec("update private.sales_followups set scheduled_at=now()-interval '1 minute' where seq=1")
  await db.exec('select private.sales_followup_send_tick()')
  assert.equal((await db.query('select state from private.sales_followups where seq=1')).rows[0].state,'cancelled',stop)
  assert.equal((await db.query('select count(*)::int n from posts')).rows[0].n,0)
 }
 const db=await setup();await sent(db);await db.exec('update switch set on_=false')
 await db.exec("update private.sales_followups set scheduled_at=now()-interval '1 minute' where seq=1")
 assert.equal((await db.query('select private.sales_followup_send_tick() n')).rows[0].n,0)
 assert.equal((await db.query('select state from private.sales_followups where seq=1')).rows[0].state,'queued')
 // the last follow-up never goes out before the first one did
 await db.exec("update switch set on_=true;update private.sales_followups set scheduled_at=now()-interval '1 minute',state='queued'")
 await db.exec("update private.sales_followups set state='rejected' where seq=1")
 await db.exec('select private.sales_followup_send_tick()')
 assert.equal((await db.query('select state from private.sales_followups where seq=2')).rows[0].state,'cancelled')
})
test('news search rotates through a fourth set looking for upcoming events and open calls',async()=>{
 const db=await setup()
 const def=(await db.query("select pg_get_functiondef('private.sales_news_queue()'::regprocedure) d")).rows[0].d
 assert.match(def,/%4 when 0/);assert.match(def,/행사 대행사 선정/);assert.match(def,/when 2 then array\['팝업스토어 운영'/)
})
