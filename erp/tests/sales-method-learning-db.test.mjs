import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),sql=await readFile(new URL('../supabase/migrations/20261115090124_sales_method_learning.sql',import.meta.url),'utf8'),one=async q=>(await db.query(q)).rows[0]
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create schema private;
 create table sales_strategies(id serial primary key,plan jsonb,status text,feedback text default '',created_at timestamptz default now(),decided_at timestamptz default now());
 insert into sales_strategies(plan,status,feedback,decided_at) values('{"category":"팝업 오픈 브랜드 후속 제안"}','승인','',now()),('{"category":"팝업 오픈 브랜드 후속 제안"}','수정 요청','대상이 너무 넓다',now()-interval '2 days'),('{"category":"팝업 오픈 브랜드 후속 제안"}','보류','근거가 약하다',now()-interval '1 day'),('{"category":"팝업 오픈 브랜드 후속 제안"}','보류','오래된 사유',now()-interval '9 days'),
  ('{"category":"공공 용역 입찰 참여"}','보류','용역비를 포함해서',now()),('{"category":"공공 용역 입찰 참여"}','승인 대기','',now()),(null,'생성 실패','',now());
 insert into sales_strategies(plan,status,created_at) values('{"category":"옛 방법"}','승인',now()-interval '200 days');
 create function sales_strategy_claim_stub(phase text) returns jsonb language sql as $$select case when phase is null then null else jsonb_build_object('phase',phase,'id',1) end$$;
 create function sales_strategy_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql as $$declare job jsonb;begin job:=public.sales_strategy_claim_stub(nullif(current_setting('test.phase',true),'')); if job is null or job->>'phase' is distinct from 'prepare' then return job;end if; return job||jsonb_build_object('contact_evidence','x');end $$;`)
 await db.exec(sql);await db.exec(sql)
})
test('learning counts decisions per method with the two latest rejection reasons',async()=>{
 assert.deepEqual((await one('select private.sales_method_learning() l')).l,[{category:'팝업 오픈 브랜드 후속 제안',approved:1,rejected:3,reasons:['근거가 약하다','대상이 너무 넓다']},{category:'공공 용역 입찰 참여',approved:0,rejected:1,reasons:['용역비를 포함해서']}])
})
test('only a new plan receives learning; preparation and missing jobs are unchanged',async()=>{
 const claim=async phase=>{await db.exec(phase===null?"select set_config('test.phase','',false)":`select set_config('test.phase','${phase}',false)`);return (await one("select public.sales_strategy_claim(gen_random_uuid(),gen_random_uuid()) j")).j}
 assert.equal((await claim('plan')).learning.length,2);assert.deepEqual(await claim('prepare'),{phase:'prepare',id:1,contact_evidence:'x'})
 assert.equal(await claim(null),null)
})
