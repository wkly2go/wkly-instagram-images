import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile(new URL('../supabase/migrations/20261115090138_sales_private_first.sql',import.meta.url),'utf8')
test('five of the six daily plans are asked for private brands, the third for a public tender',async()=>{
 const db=new PGlite();await db.exec(`create schema private;create table asked(slot integer,feedback text);
 create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer) returns void language sql as $$insert into public.asked values(p_slot,p_feedback)$$;
 create function private.sales_strategy_schedule() returns void language plpgsql as $$declare actor uuid; slot integer;begin
  select n into slot from generate_series(1,6) n where not exists(select 1 from public.asked a where a.slot=n) order by n limit 1;
  if slot is not null then perform private.sales_strategy_queue(gen_random_uuid(),actor,'서로 다른 고객군·상품 조합·접근 방식으로 오늘의 새로운 영업 기회를 기획해 주세요.',slot); end if;end $$;`)
 await db.exec(sql);await db.exec(sql)
 for(let i=0;i<6;i++)await db.exec('select private.sales_strategy_schedule()')
 const rows=(await db.query('select slot,feedback from asked order by slot')).rows
 assert.deepEqual(rows.map(r=>/^민간 브랜드/.test(r.feedback)),[true,true,false,true,true,true]);assert.match(rows[2].feedback,/공공 용역 공고/)
})
test('an unexpected schedule stops the change',async()=>{
 const db=new PGlite();await db.exec("create schema private;create function private.sales_strategy_schedule() returns void language sql as $$select$$;")
 await assert.rejects(db.exec(sql),/Unexpected planner schedule/)
})
