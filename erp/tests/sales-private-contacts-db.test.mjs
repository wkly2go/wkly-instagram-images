import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),sql=await readFile(new URL('../supabase/migrations/20261115090134_sales_private_contacts.sql',import.meta.url),'utf8'),one=async q=>(await db.query(q)).rows[0]
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create schema private;
 create table sales_prospects(id serial primary key,source text,name text,contact text default '',blocked boolean default false,event_data jsonb default '{}',revision integer default 1);
 create table private.sales_brand_site_jobs(id serial primary key,prospect_id integer);
 insert into sales_prospects(source,name,event_data) values('news_brand','찾음','{"site_checked":"x","homepage":"https://a.com/"}'),('news_brand','못 찾음','{"site_checked":"x","homepage":""}'),('행사 참여 브랜드','참가사','{}'),('거래처','다른 출처','{}');
 insert into private.sales_brand_site_jobs(prospect_id) values(1),(2),(2),(3);
 create function private.sales_brand_site_tick() returns jsonb language sql as $$select '[]'::jsonb$$;
 create function private.sales_strategy_targets(p_id uuid) returns jsonb language sql as $$select jsonb_agg(p.name order by p.id) from public.sales_prospects p where p.source='news_brand'$$;`)
})
test('an unexpected queue stops the change before anything is cleared',async()=>{
 await assert.rejects(db.exec(sql),/Unexpected site queue/)
 await db.exec('rollback')
 assert.equal((await one('select count(*)::int n from private.sales_brand_site_jobs')).n,4)
})
test('participant brands join the search, unfound brands are tried again, found ones are kept',async()=>{
 await db.exec("create or replace function private.sales_brand_site_tick() returns jsonb language plpgsql as $$declare b record;out jsonb:='[]';begin for b in select p.id,p.name from public.sales_prospects p where p.source='news_brand' and not p.blocked and not (p.event_data ? 'site_checked') order by p.id limit 2 loop out:=out||to_jsonb(b.name);end loop;return out;end $$")
 await db.exec(sql);await db.exec(sql)
 assert.deepEqual((await one('select private.sales_brand_site_tick() t')).t,['못 찾음','참가사'])
 assert.deepEqual((await db.query('select prospect_id from private.sales_brand_site_jobs')).rows,[{prospect_id:1}])
 assert.deepEqual((await one("select private.sales_strategy_targets(gen_random_uuid()) t")).t,['찾음','못 찾음','참가사'])
 assert.equal((await one("select event_data->>'homepage' h from sales_prospects where name='찾음'")).h,'https://a.com/')
})
test('the officer a tender notice names becomes its contact; an existing contact is kept',async()=>{
 await db.exec(`insert into sales_prospects(source,name,event_data) values('나라장터 공식 API','공고 A','{"officer":{"name":"홍길동","phone":"02-123-4567","email":"officer@korea.kr"}}'),('나라장터 공식 API','공고 B','{"officer":{"email":"bad address"}}'),('나라장터 공식 API','공고 C','{}');
 insert into sales_prospects(source,name,contact,event_data) values('나라장터 공식 API','공고 D','기존 연락처','{"officer":{"name":"김담당"}}'),('거래처','다른 출처 2','','{"officer":{"name":"x"}}')`)
 assert.deepEqual((await db.query("select name,contact from sales_prospects where name like '공고 %' or name='다른 출처 2' order by name")).rows,[{name:'공고 A',contact:'공고 담당 홍길동 · 02-123-4567 · officer@korea.kr'},{name:'공고 B',contact:''},{name:'공고 C',contact:''},{name:'공고 D',contact:'기존 연락처'},{name:'다른 출처 2',contact:''}])
})
