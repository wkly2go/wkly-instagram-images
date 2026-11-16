import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),one=async(q,p=[])=>(await db.query(q,p)).rows[0]
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create schema private;
 create function is_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'')='1'$$;
 create table sales_strategies(id uuid primary key,revision integer default 1,status text default '승인 대기',body text default '문안',blocked boolean default false);
 create table sales_execution_packages(id uuid primary key default gen_random_uuid(),strategy_id uuid,version integer,fingerprint text,payload jsonb,blockers jsonb,status text);
 create function private.sales_execution_material(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('payload',pl,'blockers',bl,'fingerprint',md5(pl::text||bl::text)) from (select jsonb_build_object('strategy_revision',revision,'messages',jsonb_build_array(jsonb_build_object('recipient','a@b.kr','body',body))) pl,case when blocked then '["차단"]'::jsonb else '[]'::jsonb end bl from public.sales_strategies where id=p_id) x$$;
 create function private.sales_execution_refresh(p_id uuid) returns uuid language plpgsql as $$declare m jsonb:=private.sales_execution_material(p_id);cur public.sales_execution_packages;nid uuid;begin
  select * into cur from public.sales_execution_packages where strategy_id=p_id order by version desc limit 1;
  if cur.fingerprint=m->>'fingerprint' then return cur.id;end if;
  insert into public.sales_execution_packages(strategy_id,version,fingerprint,payload,blockers,status) values(p_id,coalesce(cur.version,0)+1,m->>'fingerprint',m->'payload',m->'blockers',case when jsonb_array_length(m->'blockers')=0 then '승인 대기' else '준비 중' end) returning id into nid;return nid;end $$;
 create function sales_strategy_decide(p_id uuid,p_revision integer,p_decision text,p_feedback text) returns void language plpgsql as $$begin
  update public.sales_strategies set status=p_decision,revision=revision+1,body=case when current_setting('test.change',true)='1' then '바뀐 문안' else body end where id=p_id and revision=p_revision;if not found then raise exception '기획이 변경되었습니다.';end if;end $$;
 create function sales_execution_decide(p_id uuid,p_version integer,p_fingerprint text,p_decision text) returns void language sql as $$update public.sales_execution_packages set status=p_decision where id=p_id and version=p_version and fingerprint=p_fingerprint$$;`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090140_sales_approve_execute.sql',import.meta.url),'utf8'))
})
const make=async()=>{const id=randomUUID();await db.query('insert into sales_strategies(id) values($1)',[id]);const pkg=(await one('select private.sales_execution_refresh($1) id',[id])).id;return {id,...(await one('select id pkg,version,fingerprint from sales_execution_packages where id=$1',[pkg]))}}
const call=s=>db.query('select public.sales_strategy_approve_execute($1,1,$2,$3,$4) r',[s.id,s.pkg,s.version,s.fingerprint])
test('only the administrator can approve, and only the package that was shown',async()=>{
 const s=await make();await assert.rejects(call(s));await db.exec("select set_config('test.admin','1',false)")
 await assert.rejects(call({...s,fingerprint:'다른 값'}),/변경/);await assert.rejects(call({...s,version:9}),/변경/)
 assert.equal((await one('select status from sales_strategies where id=$1',[s.id])).status,'승인 대기')
})
test('one approval approves the plan and the rebuilt package when its content is unchanged',async()=>{
 const s=await make();assert.equal((await call(s)).rows[0].r,'기획과 실행안 승인 · 예정 시각에 실행')
 assert.equal((await one('select status from sales_strategies where id=$1',[s.id])).status,'승인')
 assert.deepEqual((await db.query('select version,status from sales_execution_packages where strategy_id=$1 order by version',[s.id])).rows,[{version:1,status:'승인 대기'},{version:2,status:'승인'}])
})
test('if the content changes on approval the package is left for review; a blocked package is refused up front',async()=>{
 const s=await make();await db.exec("select set_config('test.change','1',false)")
 assert.match((await call(s)).rows[0].r,/다시 확인 필요/);await db.exec("select set_config('test.change','',false)")
 assert.deepEqual((await db.query('select status from sales_execution_packages where strategy_id=$1 order by version',[s.id])).rows.map(r=>r.status),['승인 대기','승인 대기'])
 const b=await make();await db.query('update sales_strategies set blocked=true where id=$1',[b.id]);await assert.rejects(call(b),/변경/)
 const c=randomUUID();await db.query('insert into sales_strategies(id,blocked) values($1,true)',[c]);const pid=(await one('select private.sales_execution_refresh($1) id',[c])).id,p=await one('select version,fingerprint from sales_execution_packages where id=$1',[pid])
 await assert.rejects(call({id:c,pkg:pid,...p}),/준비가 끝나지/);assert.equal((await one('select status from sales_strategies where id=$1',[c])).status,'승인 대기')
})
