import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile(new URL('../supabase/migrations/20261116120200_sales_target_refresh.sql',import.meta.url),'utf8')+await readFile(new URL('../supabase/migrations/20261116120300_sales_preparation_retry.sql',import.meta.url),'utf8')
const base=`create role anon;create role authenticated;create role service_role;create schema private;
 create table private.sales_ops_steps(step text primary key,label text,call text,every_min integer,grace_min integer);
 create table public.sales_prospects(id uuid primary key,sig text);
 create function private.sales_prospect_signature(p public.sales_prospects) returns text language sql as $$select p.sig$$;
 create table public.sales_strategies(id uuid primary key,status text,preparation_status text,preparation_error text,revision integer default 1,created_at timestamptz default now(),targets jsonb,sources jsonb default '[]',plan jsonb default '{}',live_targets jsonb);
 create function private.sales_strategy_targets(p uuid) returns jsonb language sql stable as $$select live_targets from public.sales_strategies where id=p$$;
 create table private.sales_strategy_preparations(id uuid primary key,strategy_id uuid,done boolean,evidence_retries integer default 0,started_at timestamptz default now()-interval '1 hour');
 create table restarts(prep uuid);
 create function private.sales_contact_restart(p uuid) returns boolean language plpgsql as $$begin
  if (select evidence_retries from private.sales_strategy_preparations where id=p)>=1 then return false;end if;
  insert into public.restarts values(p);update private.sales_strategy_preparations set evidence_retries=evidence_retries+1 where id=p;return true;end $$;`
const S='11111111-1111-4111-8111-111111111111',P='22222222-2222-4222-8222-222222222222'
async function setup(status='승인 대기'){
 const db=new PGlite();await db.exec(base);await db.exec(sql);await db.exec(sql)
 await db.query(`insert into public.sales_strategies(id,status,preparation_status,targets,live_targets) values($1,$2,'완료','[{"email":""}]','[{"email":"brand@example.com"}]')`,[S,status])
 await db.query(`insert into private.sales_strategy_preparations values($1,$2,true,1)`,[P,S]);return db
}
test('a plan whose recipient was found after drafting is re-drafted automatically',async()=>{
 const db=await setup()
 assert.equal((await db.query('select private.sales_target_refresh_tick() n')).rows[0].n,1)
 assert.equal((await db.query('select count(*)::int n from restarts')).rows[0].n,1)
 assert.equal((await db.query('select target_retries from private.sales_strategy_preparations')).rows[0].target_retries,1)
 assert.match((await db.query('select preparation_error e from public.sales_strategies')).rows[0].e,/새로 확보/)
 assert.equal((await db.query("select count(*)::int n from private.sales_ops_steps where step='target_refresh'")).rows[0].n,1)
})
test('after two re-drafts it stops and asks for a check; approved plans are left alone',async()=>{
 const db=await setup()
 await db.exec('update private.sales_strategy_preparations set target_retries=2')
 assert.equal((await db.query('select private.sales_target_refresh_tick() n')).rows[0].n,0)
 assert.equal((await db.query('select preparation_status s from public.sales_strategies')).rows[0].s,'확인 필요')
 const db2=await setup('승인')
 assert.equal((await db2.query('select private.sales_target_refresh_tick() n')).rows[0].n,0)
 assert.equal((await db2.query('select count(*)::int n from restarts')).rows[0].n,0)
})
test('unchanged plans are not touched',async()=>{
 const db=await setup()
 await db.exec(`update public.sales_strategies set targets=live_targets`)
 assert.equal((await db.query('select private.sales_target_refresh_tick() n')).rows[0].n,0)
 assert.equal((await db.query('select count(*)::int n from restarts')).rows[0].n,0)
})
test('a failed draft is retried automatically, but not a limit stop',async()=>{
 const db=await setup()
 await db.exec("update public.sales_strategies set targets=live_targets,preparation_status='확인 필요',preparation_error='실행 자료 필수 내용이 부족합니다.'")
 assert.equal((await db.query('select private.sales_target_refresh_tick() n')).rows[0].n,1)
 assert.match((await db.query('select preparation_error e from public.sales_strategies')).rows[0].e,/자동 재시도/)
 const db2=await setup()
 await db2.exec("update public.sales_strategies set targets=live_targets,preparation_status='확인 필요',preparation_error='주간 AI 한도 도달'")
 assert.equal((await db2.query('select private.sales_target_refresh_tick() n')).rows[0].n,0)
})
