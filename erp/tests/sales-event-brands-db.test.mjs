import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),member=randomUUID(),event=randomUUID(),old=randomUUID(),client=randomUUID(),twinA=randomUUID(),twinB=randomUUID()
const one=async(q,p=[])=>(await db.query(q,p)).rows[0]
const page='https://festival.example.com/view.do?id=2026&tab=1'
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','k');
 create schema auth;create schema private;create schema net;create schema cron;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,active boolean);insert into profiles values('${member}','member',true);
 create function is_active_member() returns boolean language sql security definer stable as $$select exists(select 1 from public.profiles where id=auth.uid() and active)$$;
 create table clients(id uuid primary key,name text);insert into clients values('${client}','주식회사 모노커피'),('${twinA}','새벽'),('${twinB}','(주)새벽');
 create table sales_prospects(id uuid primary key default gen_random_uuid(),source text not null,source_key text not null,name text not null,entity_kind text not null,organization text not null default '',contact text not null default '',source_url text not null default '',
  evidence text not null default '',collected_at timestamptz not null default now(),client_id uuid references clients(id),assessment text not null default '확인 필요',score integer not null default 0,next_action text not null default '',blocked boolean not null default false,end_date date,event_data jsonb not null default '{}',reviewed_kind text,reviewed_assessment text,unique(source,source_key));
 insert into sales_prospects(id,source,source_key,name,entity_kind,source_url,end_date,score) values('${event}','서울시 문화행사','a','시험 페스티벌','영업 기회','${page}',current_date+30,80),('${old}','서울시 문화행사','b','지난 행사','영업 기회','https://old.example.com/',current_date-1,90);
 insert into sales_prospects(source,source_key,name,entity_kind,source_url) values('서울시 문화행사','c','주소 없는 행사','영업 기회','http://plain.example.com/'),('g2b','d','회사 대상','회사','https://co.example.com/'),('리서치','e','잡지 기사','영업 기회','https://magazine.example.com/article/1');
 create table cron.job(jobname text primary key,schedule text,active boolean);
 create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.job values(n,s,true);return 1;end$$;
 create table net.requests(id bigserial primary key,url text,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.requests(url,body) values(url,body) returning id$$;
 grant usage on schema public,auth to authenticated,anon;`)
 for(const f of ['20261115090115_sales_event_brands.sql','20261115090116_sales_event_sources.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'))
})
const result=(over={})=>({status:'complete',limited:false,pages:[{url:page,status:'read'}],brands:[{name:'모노 커피',role:'participant',url:page,excerpt:'참가 브랜드 · 모노 커피'},{name:'새벽',role:'sponsor',url:page,excerpt:'후원 · 새벽'},{name:'루프 스튜디오',role:'participant',url:page,excerpt:'참가 브랜드 · 루프 스튜디오'}],...over})
test('tick queues only open event prospects with a plain HTTPS page, once',async()=>{
 await db.exec('select private.sales_event_brands_tick();select private.sales_event_brands_tick()')
 const jobs=(await db.query('select event_id,state from private.sales_event_brand_jobs')).rows
 assert.deepEqual(jobs,[{event_id:event,state:'queued'}]);assert.equal((await one('select count(*)::int n from net.requests')).n,1)
 assert.equal((await one("select schedule from cron.job where jobname='wkly_sales_event_brands'")).schedule,'*/10 * * * *')
})
test('claim needs the exact token and hands out the job once',async()=>{
 const sent=(await one('select body from net.requests')).body
 assert.equal((await one('select public.sales_event_brands_claim($1,$2) j',[sent.id,randomUUID()])).j,null)
 assert.deepEqual((await one('select public.sales_event_brands_claim($1,$2) j',[sent.id,sent.token])).j,{event_id:event,title:'시험 페스티벌',url:page})
 assert.equal((await one('select public.sales_event_brands_claim($1,$2) j',[sent.id,sent.token])).j,null)
})
test('finish rejects off-site pages, unknown fields, duplicate or unsafe names and inconsistent states',async()=>{
 const id=(await one('select body from net.requests')).body.id
 const bad=[result({pages:[{url:'https://evil.example.com/x',status:'read'}]}),result({extra:1}),result({brands:[{name:'모노 커피',role:'participant',url:page,excerpt:'a'},{name:'(주)모노커피',role:'participant',url:page,excerpt:'b'}]}),
  result({brands:[{name:'<b>x</b>',role:'participant',url:page,excerpt:'a'}]}),result({brands:[{name:'가나',role:'owner',url:page,excerpt:'a'}]}),result({status:'no_list'}),result({status:'complete',brands:[]}),result({brands:[{name:'가나',role:'participant',url:'https://festival.example.com/other',excerpt:'a'}]}),result({pages:[{url:'https://festival.example.com/x?next=https://evil.example.com',status:'read'}]})]
 for(const r of bad)await assert.rejects(db.query('select public.sales_event_brands_finish($1,$2)',[id,JSON.stringify(r)]))
 assert.equal((await one("select count(*)::int n from sales_prospects where source='event_participant'")).n,0)
})
test('finish records brands as company prospects with source, links one exact client only, and is repeat-safe',async()=>{
 const id=(await one('select body from net.requests')).body.id
 await db.query('select public.sales_event_brands_finish($1,$2)',[id,JSON.stringify(result())])
 const rows=(await db.query("select name,entity_kind,organization,source_url,client_id,event_data->>'event_role' role,evidence,end_date is not null dated from sales_prospects where source='event_participant' order by name")).rows
 assert.deepEqual(rows.map(r=>[r.name,r.entity_kind,r.organization,r.role,r.client_id]),[['루프 스튜디오','회사','시험 페스티벌','participant',null],['모노 커피','회사','시험 페스티벌','participant',client],['새벽','회사','시험 페스티벌','sponsor',null]])
 assert.ok(rows[1].evidence.includes('「시험 페스티벌」')&&rows[1].evidence.includes('참가 브랜드 · 모노 커피'));assert.equal(rows[1].source_url,page);assert.ok(rows.every(r=>r.dated))
 await assert.rejects(db.query('select public.sales_event_brands_finish($1,$2)',[id,JSON.stringify(result())]))
 await db.exec('select private.sales_event_brands_tick()')
 assert.equal((await one('select count(*)::int n from private.sales_event_brand_jobs')).n,1,'fresh result is not re-read for 7 days')
})
test('overview is for signed-in members and shows state, note and brands; workers RPCs are not callable by users',async()=>{
 await assert.rejects(db.query('select public.sales_event_brands_overview()'))
 await db.exec(`set request.jwt.claim.sub='${member}'`)
 const o=(await one('select public.sales_event_brands_overview() o')).o
 assert.equal(o.brand_total,3);const ev=o.events.find(e=>e.id===event)
 assert.equal(ev.state,'complete');assert.equal(ev.brands.length,3);assert.equal(ev.brands.find(b=>b.name==='모노 커피').known_client,true)
 assert.equal(o.events.find(e=>e.title==='주소 없는 행사').state,'no_page');assert.ok(!o.events.some(e=>['지난 행사','회사 대상','잡지 기사'].includes(e.title)))
 const grants=(await db.query("select routine_name,grantee from information_schema.routine_privileges where routine_name like 'sales_event_brands_%' and grantee in ('authenticated','anon')")).rows
 assert.deepEqual(grants,[{routine_name:'sales_event_brands_overview',grantee:'authenticated'}])
})
