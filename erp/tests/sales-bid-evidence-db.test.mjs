import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),sql=await readFile(new URL('../supabase/migrations/20261115090129_sales_bid_evidence.sql',import.meta.url),'utf8')
before(async()=>{
 await db.exec(`create schema private;
 create table sales_prospects(id serial primary key,name text,evidence text default '',event_data jsonb default '{}');
 insert into sales_prospects(name,evidence,event_data) values('축제 대행 용역','조달청 공식 입찰 공고','{"eligibility":{"verdict":"자격 확인 필요","note":"등록 여부 확인이 필요한 업종: 기타자유업(행사대행업)/9901"}}'),('브랜드 팝업','보도 근거','{}');
 create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns jsonb language sql as $$
  select jsonb_agg(to_jsonb(x) order by x.id) from (select id,name,left(evidence,1200) evidence from (select p.* from public.sales_prospects p) pool) x $$;`)
 await db.exec(sql);await db.exec(sql)
})
test('a judged notice carries its verdict in the evidence; other records are unchanged',async()=>{
 const rows=(await db.query('select private.sales_strategy_queue(gen_random_uuid(),null,null) r')).rows[0].r
 assert.equal(rows[0].evidence,'조달청 공식 입찰 공고 · 참가 자격 판정: 자격 확인 필요 (등록 여부 확인이 필요한 업종: 기타자유업(행사대행업)/9901)')
 assert.equal(rows[1].evidence,'보도 근거')
})
test('an unexpected planner query stops the change',async()=>{
 const other=new PGlite();await other.exec("create schema private;create function private.sales_strategy_queue(p_id uuid,p_actor uuid,p_feedback text,p_slot integer default null) returns integer language sql as $$select 1$$;")
 await assert.rejects(other.exec(sql),/Unexpected planner evidence query/)
})
