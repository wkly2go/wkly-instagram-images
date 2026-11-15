import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile(new URL('../supabase/migrations/20261115090136_sales_round_the_clock.sql',import.meta.url),'utf8')
const base=`create schema private;create schema cron;create table cron.jobs(name text primary key,schedule text);
 create function cron.schedule(n text,s text,c text) returns bigint language sql as $$insert into cron.jobs values(n,s) on conflict(name) do update set schedule=excluded.schedule;select 1::bigint$$;
 create table sales_collection_runs(source text,status text,report_date date default current_date,started_at timestamptz default now());
 create table sales_strategies(id serial primary key,report_date date default current_date,auto_slot integer,constraint sales_strategies_auto_slot_check check(auto_slot between 1 and 3));
 create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns void language plpgsql as $$begin
  if (select count(*) from public.sales_strategies where report_date=current_date)>=6 then raise exception '오늘의 기획 생성 한도 6건에 도달했습니다.'; end if;
  insert into public.sales_strategies(auto_slot) values(p_slot);end $$;
 create function private.sales_strategy_schedule() returns void language plpgsql as $$declare slot integer;begin
  select n into slot from generate_series(1,3) n where not exists(select 1 from public.sales_strategies where report_date=current_date and auto_slot=n) order by n limit 1;
  if slot is not null then perform private.sales_strategy_queue(gen_random_uuid(),null,'x',slot); end if;end $$;`
const news=`create function private.sales_news_queue() returns integer language plpgsql as $$declare day date:=current_date;source_name text:='네이버 뉴스 · 브랜드 팝업';begin
  if exists(select 1 from public.sales_collection_runs where source=source_name and (status='수집 중' or (report_date=day and status in ('완료','일부 수집')) or started_at>now()-interval '15 minutes')) then return 0; end if;
  for i in 1..1 loop if (select count(*) from public.sales_collection_runs where source=source_name and report_date=day)>=3 then continue; end if;
   insert into public.sales_collection_runs(source,status) values(source_name,'완료');return 1;end loop;return 0;end $$;`
test('news runs again after about three hours and plans are made six times a day',async()=>{
 const db=new PGlite();await db.exec(base+news);await db.exec(sql);await db.exec(sql)
 const run=async()=>(await db.query('select private.sales_news_queue() n')).rows[0].n
 assert.equal(await run(),1);assert.equal(await run(),0)
 await db.exec("update sales_collection_runs set started_at=now()-interval '3 hours'");assert.equal(await run(),1)
 for(let i=0;i<8;i++)await db.exec('select private.sales_strategy_schedule()')
 assert.deepEqual((await db.query('select auto_slot from sales_strategies order by 1')).rows.map(r=>r.auto_slot),[1,2,3,4,5,6])
 for(let i=0;i<6;i++)await db.exec("select private.sales_strategy_queue(gen_random_uuid(),null,'수동')")
 await assert.rejects(db.exec("select private.sales_strategy_queue(gen_random_uuid(),null,'수동')"),/한도 12건/)
 assert.deepEqual((await db.query('select * from cron.jobs order by name')).rows,[{name:'wkly_sales_news',schedule:'10 */3 * * *'},{name:'wkly_sales_strategy_prepare',schedule:'45 3,7,11,15,19,23 * * *'}])
})
test('an unexpected function stops the change',async()=>{
 const db=new PGlite();await db.exec(base+"create function private.sales_news_queue() returns integer language sql as $$select 1$$;")
 await assert.rejects(db.exec(sql),/Unexpected news queue/)
})
