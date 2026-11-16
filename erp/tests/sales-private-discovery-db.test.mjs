import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),one=async q=>(await db.query(q)).rows[0]
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create schema private;
 create table sales_prospects(id serial primary key,source text,name text,blocked boolean default false,assessment text default '확인 필요',reviewed_assessment text,score integer default 50,source_updated_at timestamptz default now(),event_data jsonb default '{}',revision integer default 1);
 create table private.sales_brand_site_jobs(id serial primary key,prospect_id integer,brand text);
 insert into sales_prospects(source,name,event_data,source_updated_at) values
  ('news_brand','메일 있는 브랜드','{"articles":"7","homepage":"https://a.kr/","contact_page":"https://a.kr/c","public_emails":["biz@a.kr"]}',now()),
  ('news_brand','사이트만','{"articles":"1","homepage":"https://b.kr/","site_checked":"x"}',now()-interval '10 days'),
  ('news_brand','개인정보 주소만','{"articles":"2","public_emails":["privacy@c.kr"]}',now()-interval '40 days'),
  ('행사 참여 브랜드','[서울카페쇼 2026] 가치커피','{"site_checked":"x","homepage":""}',now()),
  ('거래처','다른 출처','{"articles":"9"}',now());
 insert into sales_prospects(source,name,assessment,score) values('news_brand','보류된 곳','보류',0);
 insert into private.sales_brand_site_jobs(prospect_id,brand) values(2,'사이트만'),(4,'[서울카페쇼 2026] 가치커피');
 create function private.sales_public_inquiry_email(p jsonb) returns text language sql immutable as $$select (select v from jsonb_array_elements_text(coalesce(p->'public_emails','[]'::jsonb)) v where v not like 'privacy@%' limit 1)$$;
 create function private.sales_news_queue() returns text[] language plpgsql as $$declare word text;out text[]:='{}';begin
  foreach word in array array['팝업스토어 오픈','팝업스토어 예정','브랜드 팝업','플래그십스토어 오픈','브랜드 체험존','체험형 팝업','팝업 부스 운영','브랜드 쇼룸 오픈'] loop out:=out||word;end loop;return out;end $$;
 create function private.sales_brand_site_tick() returns integer language plpgsql as $$declare b record;n integer:=0;begin
  for b in select p.id,p.name from public.sales_prospects p where p.source in ('news_brand','행사 참여 브랜드') and not (p.event_data ? 'site_checked') and not exists(select 1 from private.sales_brand_site_jobs j where j.prospect_id=p.id) loop
   insert into private.sales_brand_site_jobs(prospect_id,brand) values(b.id,b.name);n:=n+1;end loop;return n;end $$;
 create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns jsonb language sql as $$
  select jsonb_agg(name) from (select p.name from public.sales_prospects p where p.source='news_brand' and p.assessment<>'보류' order by p.source_updated_at desc nulls last,p.score desc,p.id) x$$;`)
 const sql=await readFile(new URL('../supabase/migrations/20261115090141_sales_private_discovery.sql',import.meta.url),'utf8')
 await db.exec(sql)
})
test('brands are scored by how ready they are for outreach, and planning takes the best first',async()=>{
 const rows=Object.fromEntries((await db.query('select name,score from sales_prospects')).rows.map(r=>[r.name,r.score]))
 assert.deepEqual(rows,{'메일 있는 브랜드':95,'사이트만':66,'개인정보 주소만':58,'[서울카페쇼 2026] 가치커피':64,'다른 출처':50,'보류된 곳':0})
 assert.deepEqual((await one("select private.sales_strategy_queue(gen_random_uuid(),null,null) r")).r,['메일 있는 브랜드','사이트만','개인정보 주소만'])
})
test('news keywords rotate through three sets of eight',async()=>{
 const words=(await one('select private.sales_news_queue() w')).w;assert.equal(words.length,8)
 const def=(await one("select pg_get_functiondef('private.sales_news_queue()'::regprocedure) d")).d
 for(const w of ['브랜드 팝업','성수 팝업','식음료 팝업'])assert.ok(def.includes(w))
})
test('a participant is searched without the event prefix, and earlier misses are tried again',async()=>{
 assert.deepEqual((await db.query('select prospect_id from private.sales_brand_site_jobs')).rows,[{prospect_id:2}])
 await db.exec('select private.sales_brand_site_tick()')
 assert.deepEqual((await db.query('select brand from private.sales_brand_site_jobs where prospect_id=4')).rows,[{brand:'가치커피'}])
})
