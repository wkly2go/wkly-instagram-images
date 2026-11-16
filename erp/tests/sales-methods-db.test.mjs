import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),admin=randomUUID(),sql=await readFile(new URL('../supabase/migrations/20261115090126_sales_methods.sql',import.meta.url),'utf8')
const one=async(q,p=[])=>(await db.query(q,p)).rows[0]
const fails=async(q,p=[])=>assert.rejects(db.query(q,p))
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','k');
 create schema private;create schema net;create schema cron;create schema auth;
 create table net.calls(url text,body jsonb);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.calls values(url,body);select 1::bigint$$;
 create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 create table profiles(id uuid primary key,role text,active boolean,is_agent boolean default false);insert into profiles values('${admin}','admin',true,false);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function is_admin() returns boolean language sql as $$select auth.uid() is not null$$;
 create function is_active_member() returns boolean language sql as $$select true$$;
 create table growth_ai_models(key text primary key,enabled boolean);insert into growth_ai_models values('standard',true),('fast',true);
 create function growth_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language sql as $$select jsonb_build_object('execute',true)$$;
 create function private.sales_ai_topup(p_id uuid,p_input_tokens integer,p_cap integer,p_result jsonb) returns jsonb language sql as $$select p_result||jsonb_build_object('cap',p_cap)$$;
 create function private.sales_method_learning() returns jsonb language sql as $$select '[{"category":"공공 용역 입찰 참여","approved":0,"rejected":3,"reasons":["면허 필요"]}]'::jsonb$$;
 create table sales_strategies(id serial primary key,status text,created_at timestamptz default now());
 create table sales_prospects(id serial primary key,source text,event_data jsonb default '{}',collected_at timestamptz default now(),blocked boolean default false);
 insert into sales_prospects(source,event_data) values('news_brand','{"occasion":"팝업"}'),('news_brand','{"occasion":"팝업"}'),('news_brand','{}'),('네이버 뉴스','{}');
 create function sales_strategy_claim(p_id uuid,p_token uuid) returns jsonb language plpgsql as $$declare job jsonb:='{"phase":"plan"}';begin if job is null then return null;end if; if job->>'phase' is distinct from 'prepare' then return job||jsonb_build_object('learning',private.sales_method_learning());end if; return job;end $$;`)
 await db.exec(sql)
})
const propose=async(list,expectDone=true)=>{
 await db.exec("delete from private.sales_method_review_jobs");
 await db.exec(`insert into private.sales_method_review_jobs(actor) values('${admin}')`)
 const j=await one('select id,token from private.sales_method_review_jobs')
 assert.ok((await one('select public.sales_method_review_claim($1,$2) c',[j.id,j.token])).c)
 await db.query('select public.sales_method_review_finish($1,$2::jsonb,$3)',[j.id,JSON.stringify(list),''])
 if(expectDone)assert.equal((await one('select state from private.sales_method_review_jobs')).state,'done')
}
test('the nine built-in methods are stored and the planner receives the active ones',async()=>{
 assert.equal((await one('select count(*)::int n from sales_methods where active')).n,9)
 const job=(await one('select public.sales_strategy_claim(gen_random_uuid(),gen_random_uuid()) j')).j
 assert.equal(job.methods.length,9);assert.deepEqual(Object.keys(job.methods[0]).sort(),['first','name','offer','signal']);assert.equal(job.learning.length,1)
})
test('a review waits for enough decisions, runs once a week and not while proposals wait',async()=>{
 assert.equal((await one('select private.sales_method_review_tick() n')).n,0)
 await db.exec("insert into sales_strategies(status) values('승인'),('보류'),('수정 요청')")
 assert.equal((await one('select private.sales_method_review_tick() n')).n,1)
 assert.equal((await one('select count(*)::int n from net.calls')).n,1)
 assert.equal((await one('select private.sales_method_review_tick() n')).n,0)
})
test('the claim hands over methods, learning and collected signals once',async()=>{
 const j=await one('select id,token from private.sales_method_review_jobs')
 const c=(await one('select public.sales_method_review_claim($1,$2) c',[j.id,j.token])).c
 assert.equal(c.model,'standard');assert.equal(c.methods.length,9);assert.deepEqual(c.signals,[{label:'팝업',count:2},{label:'news_brand',count:1}])
 assert.equal((await one('select public.sales_method_review_claim($1,$2) c',[j.id,j.token])).c,null)
 assert.equal((await one('select public.sales_method_review_ai_reserve($1,$2,$3,$4,$5,100) r',[j.id,admin,'write','s','standard'])).r.cap,6000)
 await fails('select public.sales_method_review_ai_reserve($1,$2,$3,$4,$5,100)',[j.id,admin,'classify','s','standard'])
})
test('malformed proposals are refused whole',async()=>{
 const good={action:'추가',name:'전시 주최사 협력',signal:'박람회 일정 공개',offer:'참가사 부스 묶음 제안',first:'주최사 사무국 문의',reason:'팝업 신호 2건에 맞는 방법 없음'}
 for(const bad of [[{...good,extra:1}],[{...good,name:'매거진 취재 연계'}],[{...good,action:'수정'}],[{...good,signal:''}],[{...good,reason:'<b>'}],[good,good,good]]){
  await db.exec('delete from private.sales_method_review_jobs');await db.exec(`insert into private.sales_method_review_jobs(actor,state) values('${admin}','claimed')`)
  const j=await one('select id from private.sales_method_review_jobs');await fails('select public.sales_method_review_finish($1,$2::jsonb,$3)',[j.id,JSON.stringify(bad),''])
 }
 assert.equal((await one('select count(*)::int n from sales_method_proposals')).n,0)
})
test('a proposal changes the playbook only after the administrator approves it',async()=>{
 await propose([{action:'추가',name:'전시 주최사 협력',signal:'박람회 일정 공개',offer:'참가사 부스 묶음 제안',first:'주최사 사무국 문의',reason:'팝업 신호 2건에 맞는 방법 없음'},{action:'중지',name:'공공 용역 입찰 참여',signal:'x',offer:'',first:'',reason:'반려 3건 승인 0건'}])
 assert.equal((await one('select count(*)::int n from sales_methods where active')).n,9)
 const rows=(await db.query("select id,action from sales_method_proposals order by action")).rows
 await fails('select public.sales_method_decide($1,$2)',[rows[0].id,'승인'])
 await db.exec(`select set_config('test.uid','${admin}',false)`)
 await fails('select public.sales_method_decide($1,$2)',[rows[0].id,'보류'])
 for(const r of rows)await db.query('select public.sales_method_decide($1,$2)',[r.id,r.action==='추가'?'승인':'반려'])
 await fails('select public.sales_method_decide($1,$2)',[rows[0].id,'승인'])
 assert.equal((await one("select origin from sales_methods where name='전시 주최사 협력'")).origin,'AI 제안')
 assert.equal((await one("select active from sales_methods where name='공공 용역 입찰 참여'")).active,true)
 assert.equal((await one('select public.sales_strategy_claim(gen_random_uuid(),gen_random_uuid()) j')).j.methods.length,10)
})
test('approved edits and stops apply; a failed review records its note',async()=>{
 await propose([{action:'수정',name:'매거진 취재 연계',signal:'신규 공간 공개 소식',offer:'취재 뒤 운영 제안',first:'홍보 담당 취재 요청',reason:'반려 사유 반복'},{action:'중지',name:'공공 용역 입찰 참여',signal:'',offer:'',first:'',reason:'반려 3건 승인 0건'}])
 for(const r of (await db.query("select id from sales_method_proposals where status='승인 대기'")).rows)await db.query('select public.sales_method_decide($1,$2)',[r.id,'승인'])
 assert.equal((await one("select signal from sales_methods where name='매거진 취재 연계'")).signal,'신규 공간 공개 소식')
 assert.equal((await one('select count(*)::int n from sales_methods where active')).n,9)
 await db.exec('delete from private.sales_method_review_jobs');await db.exec(`insert into private.sales_method_review_jobs(actor,state) values('${admin}','claimed')`)
 const j=await one('select id from private.sales_method_review_jobs');await db.query('select public.sales_method_review_finish($1,null,$2)',[j.id,'미완료'])
 assert.deepEqual(await one('select state,note from private.sales_method_review_jobs'),{state:'failed',note:'미완료'})
})
