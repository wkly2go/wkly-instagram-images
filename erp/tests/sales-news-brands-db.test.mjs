import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),admin=randomUUID(),client=randomUUID(),a=randomUUID(),b=randomUUID(),c=randomUUID()
const one=async(q,p=[])=>(await db.query(q,p)).rows[0]
const blank={brand:'',event:'',when:'',where:''}
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','k');
 create schema private;create schema net;create schema cron;
 create table profiles(id uuid primary key,role text,active boolean,is_agent boolean default false);insert into profiles values('${admin}','admin',true,false);
 create table clients(id uuid primary key,name text);insert into clients values('${client}','주식회사 폴뉴아');
 create table growth_ai_models(key text primary key,enabled boolean);insert into growth_ai_models values('standard',true),('fast',true);
 create function growth_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language sql as $$select jsonb_build_object('execute',true)$$;
 create function private.sales_brand_key(p_name text) returns text language sql immutable as $$select regexp_replace(lower(p_name),'\\(주\\)|㈜|주식회사|[[:space:]]|[.,·''"()\\[\\]]','','g')$$;
 create table sales_prospects(id uuid primary key default gen_random_uuid(),source text not null,source_key text not null,name text not null,entity_kind text not null,organization text not null default '',contact text not null default '',source_url text not null default '',evidence text not null default '',source_updated_at timestamptz,collected_at timestamptz not null default now(),
  client_id uuid,assessment text not null default '확인 필요',score integer not null default 50,reasons text not null default '',next_action text not null default '',blocked boolean not null default false,event_data jsonb not null default '{}',reviewed_assessment text,revision integer not null default 1,unique(source,source_key));
 insert into sales_prospects(id,source,source_key,name,entity_kind,source_url,source_updated_at,event_data) values
  ('${a}','네이버 뉴스','a','폴뉴아, 서울숲 플래그십 스토어 오픈','영업 기회','https://news.example.com/1',now()-interval '1 hour','{"summary":"폴뉴아가 14일 매장을 연다"}'),
  ('${b}','네이버 뉴스','b','충북음악제 27~29일 개최','영업 기회','https://news.example.com/2',now()-interval '2 hours','{"summary":"클래식"}'),
  ('${c}','네이버 뉴스','c','폴뉴아 성수 팝업 예정','영업 기회','https://news.example.com/3',now()-interval '3 hours','{"summary":""}');
 insert into sales_prospects(source,source_key,name,entity_kind,source_updated_at) values('네이버 뉴스','old','오래된 보도','영업 기회',now()-interval '30 days'),('서울시 문화행사','x','행사','영업 기회',now());
 create table cron.job(jobid bigserial,jobname text primary key,schedule text,active boolean);
 create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.job(jobname,schedule,active) values(n,s,true);return 1;end$$;
 create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
 create table net.requests(id bigserial primary key,url text,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.requests(url,body) values(url,body) returning id$$;`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090118_sales_news_brands.sql',import.meta.url),'utf8'))
})
test('schedule starts off; one batch of recent unchecked articles is queued at a time',async()=>{
 assert.equal((await one("select active from cron.job where jobname='wkly_sales_news_brands'")).active,false)
 assert.equal((await one('select private.sales_news_brands_tick() n')).n,3);assert.equal((await one('select private.sales_news_brands_tick() n')).n,0)
 assert.equal((await one('select count(*)::int n from net.requests')).n,1)
})
test('claim hides row ids; the paid call needs a claimed job; finish validates and saves',async()=>{
 const sent=(await one('select body from net.requests')).body
 await assert.rejects(db.query("select public.sales_news_brands_ai_reserve($1,$2,'classify','s','fast',10)",[sent.id,admin]))
 assert.equal((await one('select public.sales_news_brands_claim($1,$2) j',[sent.id,randomUUID()])).j,null)
 const job=(await one('select public.sales_news_brands_claim($1,$2) j',[sent.id,sent.token])).j
 assert.deepEqual(job.items.map(i=>Object.keys(i).sort()),[['n','summary','title'],['n','summary','title'],['n','summary','title']]);assert.equal(job.model,'fast');assert.equal(job.actor,admin)
 assert.equal((await one('select public.sales_news_brands_claim($1,$2) j',[sent.id,sent.token])).j,null)
 await assert.rejects(db.query("select public.sales_news_brands_ai_reserve($1,$2,'write','s','fast',10)",[sent.id,admin]))
 assert.deepEqual((await one("select public.sales_news_brands_ai_reserve($1,$2,'classify','s','fast',10) r",[sent.id,admin])).r,{execute:true})
 const rows=[{n:1,relevant:true,brand:'폴뉴아',event:'플래그십 스토어 오픈',when:'14일',where:'서울숲'},{n:2,relevant:false,...blank},{n:3,relevant:true,brand:'폴뉴아',event:'팝업',when:'',where:'성수'}]
 for(const bad of [rows.slice(0,2),[{...rows[0],brand:'삼성전자'},rows[1],rows[2]],[{...rows[0],extra:1},rows[1],rows[2]],[rows[0],rows[0],rows[2]],[{...rows[0],where:'<b>'},rows[1],rows[2]]])
  await assert.rejects(db.query('select public.sales_news_brands_finish($1,$2,null)',[sent.id,JSON.stringify(bad)]))
 await db.query('select public.sales_news_brands_finish($1,$2,null)',[sent.id,JSON.stringify(rows)])
 assert.deepEqual(await one('select organization,event_data->>\'ai_relevant\' r,event_data->>\'where\' w from sales_prospects where id=$1',[a]),{organization:'폴뉴아',r:'true',w:'서울숲'})
 assert.deepEqual(await one('select assessment,score,event_data->>\'ai_relevant\' r from sales_prospects where id=$1',[b]),{assessment:'보류',score:0,r:'false'})
 const brand=await one("select name,entity_kind,client_id,source_url,evidence,event_data->>'articles' n from sales_prospects where source='news_brand'")
 assert.equal((await one("select count(*)::int n from sales_prospects where source='news_brand'")).n,1)
 assert.deepEqual([brand.name,brand.entity_kind,brand.client_id,brand.source_url,brand.n],['폴뉴아','회사',client,'https://news.example.com/1','2']);assert.match(brand.evidence,/플래그십 스토어 오픈 · 14일 · 서울숲/)
 await db.query('select public.sales_news_brands_finish($1,$2,null)',[sent.id,JSON.stringify(rows)]);assert.equal((await one("select event_data->>'articles' n from sales_prospects where source='news_brand'")).n,'2')
 assert.equal((await one('select private.sales_news_brands_tick() n')).n,0)
})
test('a failed pass is recorded, retried once per article, and paused after repeated failures',async()=>{
 await db.exec("insert into sales_prospects(source,source_key,name,entity_kind,source_updated_at) values('네이버 뉴스','n1','새 보도','영업 기회',now())")
 for(let i=0;i<2;i++){
  assert.equal((await one('select private.sales_news_brands_tick() n')).n,1)
  const sent=(await one('select body from net.requests order by id desc limit 1')).body
  await db.query('select public.sales_news_brands_claim($1,$2)',[sent.id,sent.token]);await db.query("select public.sales_news_brands_finish($1,null,'판별 미완료')",[sent.id])
 }
 assert.equal((await one('select private.sales_news_brands_tick() n')).n,0)
 assert.equal((await one("select event_data->>'ai_tries' t from sales_prospects where source_key='n1'")).t,'2')
 await db.exec("insert into sales_prospects(source,source_key,name,entity_kind,source_updated_at) values('네이버 뉴스','n2','또 새 보도','영업 기회',now());insert into private.sales_news_brand_jobs(actor,items,state) values('"+admin+"','[]','failed')")
 assert.equal((await one('select private.sales_news_brands_tick() n')).n,0)
 const g=await one("select has_function_privilege('authenticated','public.sales_news_brands_finish(uuid,jsonb,text)','execute') a,has_function_privilege('service_role','public.sales_news_brands_claim(uuid,uuid)','execute') s");assert.deepEqual(g,{a:false,s:true})
})
