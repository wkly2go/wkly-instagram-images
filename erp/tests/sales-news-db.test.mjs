import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),member=randomUUID()
const one=async(q,p=[])=>(await db.query(q,p)).rows[0]
const row=(over={})=>({id:'a'.repeat(32),title:'성수 팝업스토어 오픈',summary:'브랜드 팝업 소식',url:'https://news.example.com/a/1',published:new Date(Date.now()-3600000).toISOString().replace(/\.\d+Z$/,'Z'),...over})
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','k');
 create schema private;create schema net;create schema cron;
 create table sales_collection_runs(id uuid primary key default gen_random_uuid(),report_date date not null default (now() at time zone 'Asia/Seoul')::date,source text not null,status text not null,count integer not null default 0,scanned integer,total integer,source_at timestamptz,note text not null default '',started_at timestamptz not null default now(),finished_at timestamptz);
 create table sales_prospects(id uuid primary key default gen_random_uuid(),source text not null,source_key text not null,name text not null,entity_kind text not null,organization text not null default '',contact text not null default '',source_url text not null default '',evidence text not null default '',source_updated_at timestamptz,
  client_id uuid,contact_id uuid,assessment text not null default '확인 필요',score integer not null default 0,reasons text not null default '',next_action text not null default '',blocked boolean not null default false,event_data jsonb not null default '{}',revision integer not null default 1,unique(source,source_key));
 create function private.sales_index(p_source text,p_key text,p_data jsonb) returns void language sql as $$
  insert into public.sales_prospects(source,source_key,name,entity_kind,organization,contact,source_url,evidence,source_updated_at,blocked,event_data,assessment,score)
  values(p_source,p_key,p_data->>'name',p_data->>'entity_kind',p_data->>'organization',p_data->>'contact',p_data->>'source_url',p_data->>'evidence',(p_data->>'source_updated_at')::timestamptz,(p_data->>'blocked')::boolean,p_data->'event_data','우선 검토',65)
  on conflict(source,source_key) do update set name=excluded.name,organization=excluded.organization,contact=excluded.contact,evidence=excluded.evidence,blocked=excluded.blocked,event_data=excluded.event_data,revision=sales_prospects.revision+1$$;
 create table cron.job(jobid bigserial,jobname text primary key,schedule text,active boolean);
 create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.job(jobname,schedule,active) values(n,s,true);return 1;end$$;
 create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
 create table net.requests(id bigserial primary key,url text,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.requests(url,body) values(url,body) returning id$$;`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090117_sales_news.sql',import.meta.url),'utf8'))
})
test('schedule is created switched off and the queue opens one run per keyword per day',async()=>{
 assert.deepEqual(await one("select schedule,active from cron.job where jobname='wkly_sales_news'"),{schedule:'10 22,4 * * *',active:false})
 assert.equal((await one('select private.sales_news_queue() n')).n,8);assert.equal((await one('select private.sales_news_queue() n')).n,0)
 assert.equal((await one("select count(*)::int n from sales_collection_runs where status='수집 중' and source like '네이버 뉴스 · %'")).n,8)
 assert.equal((await one("select count(*)::int n from net.requests where url like '%/functions/v1/sales-news'")).n,8)
})
test('claim needs the exact token once; save validates rows and keeps earlier links',async()=>{
 const sent=(await one('select body from net.requests order by id limit 1')).body
 assert.equal((await one('select public.sales_news_claim($1,$2) j',[sent.id,randomUUID()])).j,null)
 await assert.rejects(db.query('select public.sales_news_save($1,$2,1,now())',[sent.id,JSON.stringify([row()])]))
 assert.deepEqual((await one('select public.sales_news_claim($1,$2) j',[sent.id,sent.token])).j,{keyword:'팝업스토어 오픈',days:3})
 assert.equal((await one('select public.sales_news_claim($1,$2) j',[sent.id,sent.token])).j,null)
 await assert.rejects(db.query("select public.sales_news_finish($1,'완료','x')",[sent.id]))
 for(const bad of [row({id:'zz'}),row({url:'javascript:alert(1)'}),row({title:''}),row({published:'2020-01-01T00:00:00Z'}),row({published:'yesterday'})])
  await assert.rejects(db.query('select public.sales_news_save($1,$2,1,now())',[sent.id,JSON.stringify([bad])]))
 await db.query("insert into sales_prospects(source,source_key,name,entity_kind,organization,contact,blocked) values('네이버 뉴스',$1,'old','영업 기회','모노커피','pr@example.com',true)",['b'.repeat(32)])
 await db.query('select public.sales_news_save($1,$2,7,now())',[sent.id,JSON.stringify([row(),row({id:'b'.repeat(32),url:'https://news.example.com/a/2'})])])
 await assert.rejects(db.query('select public.sales_news_save($1,$2,7,now())',[sent.id,JSON.stringify([row()])]))
 const saved=(await db.query("select source_key,name,organization,contact,blocked,source_url,evidence,event_data from sales_prospects where source='네이버 뉴스' order by source_key")).rows
 assert.equal(saved.length,2);assert.deepEqual(await one("select assessment,score from sales_prospects where source_key=$1",['a'.repeat(32)]),{assessment:'확인 필요',score:50});assert.equal(saved[0].source_url,'https://news.example.com/a/1');assert.match(saved[0].evidence,/네이버 뉴스 검색 · 팝업스토어 오픈 · 보도 \d{4}-\d{2}-\d{2}/);assert.equal(saved[0].event_data.keyword,'팝업스토어 오픈')
 assert.deepEqual([saved[1].organization,saved[1].contact,saved[1].blocked],['모노커피','pr@example.com',true])
 await db.query("select public.sales_news_finish($1,'완료','done')",[sent.id])
 assert.deepEqual(await one('select status,count,total,note from sales_collection_runs where id=$1',[sent.id]),{status:'완료',count:2,total:7,note:'done'})
 await db.query("select public.sales_news_finish($1,'실패','late')",[sent.id]);assert.equal((await one('select note from sales_collection_runs where id=$1',[sent.id])).note,'done')
})
test('stale runs are closed, old articles are retired, and only the server role may call the worker functions',async()=>{
 await db.exec("update sales_collection_runs set started_at=now()-interval '20 minutes' where status='수집 중';insert into sales_prospects(source,source_key,name,entity_kind,source_updated_at) values('네이버 뉴스','old','지난 보도','영업 기회',now()-interval '90 days')")
 await db.query('select private.sales_news_queue()')
 assert.equal((await one("select count(*)::int n from sales_collection_runs where status='실패' and note like '네이버 뉴스 수집 시간 초과%'")).n,7)
 assert.equal((await one("select assessment from sales_prospects where source_key='old'")).assessment,'보류')
 const grants=(await db.query("select has_function_privilege('authenticated','public.sales_news_save(uuid,jsonb,integer,timestamptz)','execute') a,has_function_privilege('anon','public.sales_news_claim(uuid,uuid)','execute') b,has_function_privilege('service_role','public.sales_news_finish(uuid,text,text)','execute') c")).rows[0]
 assert.deepEqual(grants,{a:false,b:false,c:true})
})
