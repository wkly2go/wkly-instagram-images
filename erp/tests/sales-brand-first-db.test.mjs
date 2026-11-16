import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),sql=await readFile(new URL('../supabase/migrations/20261115090122_sales_brand_first_planning.sql',import.meta.url),'utf8')
before(async()=>{
 await db.exec(`create schema private;
 create table sales_prospects(id serial primary key,source text,name text,assessment text default '확인 필요',score integer default 40,reasons text default '',next_action text default '',reviewed_assessment text,revision integer default 1);
 insert into sales_prospects(source,name) select 'news_brand','브랜드'||g from generate_series(1,7) g;
 insert into sales_prospects(source,name) select '거래처','거래처'||g from generate_series(1,9) g;
 insert into sales_prospects(source,name) select '리서치','자료'||g from generate_series(1,9) g;
 insert into sales_prospects(source,name) values('news_brand','해남군'),('news_brand','KOTRA'),('news_brand','서울디자인재단'),('거래처','강남구청');
 insert into sales_prospects(source,name,reviewed_assessment) values('news_brand','이세계아이돌','우선 검토');
 create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('source',source,'name',name)) from (select * from (select p.*,row_number() over(partition by p.source order by p.id) n from public.sales_prospects p where p.assessment<>'보류') pool where n<=8 order by md5(id::text||p_id::text) limit 10) x $$;`)
 await db.exec(sql)
})
test('half of the planning sources are newly reported brands; applying twice changes nothing',async()=>{
 await db.exec(sql)
 for(const id of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']){
  const rows=(await db.query('select private.sales_strategy_queue($1,null,null) r',[id])).rows[0].r
  assert.equal(rows.length,10);assert.equal(rows.filter(r=>r.source==='news_brand').length>=5,true);assert.equal(rows.filter(r=>r.source!=='news_brand').length>=2,true)
 }
})
test('performers, local governments and agencies are set aside unless reviewed by a person',async()=>{
 const held=(await db.query("select name from sales_prospects where assessment='보류' order by name")).rows.map(r=>r.name)
 assert.deepEqual(held,['KOTRA','서울디자인재단','해남군'])
})
test('an unexpected planner query stops the change instead of guessing',async()=>{
 const other=new PGlite();await other.exec("create schema private;create table sales_prospects(source text,name text,assessment text,score integer,reasons text,next_action text,reviewed_assessment text,revision integer);create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns integer language sql as $$select 1$$;")
 await assert.rejects(other.exec(sql),/Unexpected planner source query/)
})
