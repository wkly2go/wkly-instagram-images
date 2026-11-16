import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),one=async q=>(await db.query(q)).rows[0]
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create schema private;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','k');create schema net;
 create table sales_collection_runs(id uuid primary key default gen_random_uuid(),report_date date default (now() at time zone 'Asia/Seoul')::date,source text,status text,note text default '',count integer default 0,started_at timestamptz default now(),finished_at timestamptz);
 create table private.sales_g2b_jobs(run_id uuid primary key,token uuid default gen_random_uuid(),category text,keyword text,start_date date,end_date date);
 create function private.sales_g2b_watchdog() returns void language sql as $$select$$;
 create table net.requests(id bigserial primary key,url text);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.requests(url) values(url) returning id$$;
 create table sales_prospects(id uuid primary key default gen_random_uuid(),source text,name text,assessment text default '확인 필요',score integer default 60,reasons text default '',next_action text default '',event_data jsonb default '{}',reviewed_assessment text,revision integer default 1);
 insert into sales_prospects(source,name,event_data) values('나라장터 공식 API','전시장 조성 공사','{"category":"construction"}'),('나라장터 공식 API','청사 인테리어 공사 용역','{"category":"service"}'),('나라장터 공식 API','지역 축제 행사 대행 용역','{"category":"service"}'),('네이버 뉴스','인테리어 공사 소식','{}');
 insert into sales_prospects(source,name,event_data,reviewed_assessment,assessment) values('나라장터 공식 API','전시관 리모델링 공사','{"category":"construction"}','우선 검토','우선 검토');`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090120_sales_license_scope.sql',import.meta.url),'utf8'))
})
test('saved construction and licence-bound notices are excluded; service notices and other sources stay',async()=>{
 const rows=(await db.query('select name,assessment,score from sales_prospects order by name')).rows
 assert.deepEqual(rows,[{name:'인테리어 공사 소식',assessment:'확인 필요',score:60},{name:'전시관 리모델링 공사',assessment:'우선 검토',score:60},{name:'전시장 조성 공사',assessment:'제외',score:0},{name:'지역 축제 행사 대행 용역',assessment:'확인 필요',score:60},{name:'청사 인테리어 공사 용역',assessment:'제외',score:0}])
 assert.match((await one("select reasons from sales_prospects where name='전시장 조성 공사'")).reasons,/면허/)
})
test('a re-collected construction notice stays excluded and only service searches are queued',async()=>{
 await db.exec("update sales_prospects set assessment='우선 검토',score=80 where name='전시장 조성 공사';insert into sales_prospects(source,name,event_data,assessment) values('나라장터 공식 API','박물관 실내건축 공사',jsonb_build_object('category','service'),'우선 검토')")
 assert.equal((await one("select count(*)::int n from sales_prospects where assessment='제외'")).n,3)
 assert.equal((await one('select private.sales_g2b_queue() n')).n,8)
 assert.deepEqual((await db.query('select distinct category from private.sales_g2b_jobs')).rows,[{category:'service'}])
 assert.equal((await one("select count(*)::int n from sales_collection_runs where source like '나라장터 공사%'")).n,0)
})
