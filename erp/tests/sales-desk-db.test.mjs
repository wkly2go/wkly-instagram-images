import {before,beforeEach,afterEach,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(), admin=randomUUID(), member=randomUUID(), client=randomUUID(), person=randomUUID()
const sql=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);create schema auth;create schema private;create schema net;create schema cron;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,active boolean,is_agent boolean default false);
 insert into profiles values('${admin}','admin',true,false),('${member}','member',true,false);
 create function is_active_member() returns boolean language sql security definer stable as $$select exists(select 1 from public.profiles where id=auth.uid() and active)$$;
 create function is_admin() returns boolean language sql security definer stable as $$select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin')$$;
 create table clients(id uuid primary key,name text,category text,memo text,email text,phone text,website text,updated_at timestamptz);
 create table contacts(id uuid primary key,client_id uuid references clients(id),name text,title text,phone text,email text,memo text,created_at timestamptz);
 create table projects(id uuid primary key,client_id uuid,division text);
 create table growth_items(id uuid primary key,kind text,title text,document jsonb,status text,updated_at timestamptz,linked_sales_id uuid);
 create table brand_contacts(id uuid primary key,contact_name text,brand_name text,email text,phone text,source_note text,memo text,source_url text,updated_at timestamptz,client_id uuid,opt_out boolean);
 create table research_items(id uuid primary key,title text,status text,brand_name text,summary text,body text,source_url text,updated_at timestamptz,client_id uuid);
 create table notices(user_id uuid,title text);
 create function notify(u uuid,k text,t text,b text,l text) returns void language sql as $$insert into public.notices values(u,t)$$;
 create function growth_safe_url(v text) returns boolean language sql immutable as $$select v='' or v ~ '^https?://[^ @]+$'$$;
 create table cron.job(jobname text primary key,schedule text,active boolean);
 create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.job values(n,s,true);return 1;end$$;
 create table net.requests(id bigserial primary key,url text);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.requests(url) values(url) returning id$$;
 create table net._http_response(id bigint,status_code integer,content text,error_msg text,timed_out boolean);
 create function net.http_get(url text,timeout_milliseconds int) returns bigint language sql as $$insert into net.requests(url) values(url) returning id$$;
 grant usage on schema public,auth to authenticated,anon;`)
 await db.exec(await sql('0113_sales_pipeline.sql'))
 await db.exec(await sql('0119_sales_briefing.sql'))
 await db.exec(await sql('0120_sales_verification.sql'))
 await db.exec(await sql('0121_sales_verification_fast_path.sql'))
 await db.query('insert into clients values($1,$2,$3,$4,$5,$6,$7,now())',[client,'테스트 브랜드','클라이언트','팝업 전시 기획','team@example.com','02-000-0000','https://example.com'])
 await db.query('insert into contacts values($1,$2,$3,$4,$5,$6,$7,now())',[person,client,'동명 담당자','마케팅 팀장','','human@example.com','팝업 문의'])
 await db.query('select private.sales_collect_internal()')
 await db.exec(await sql('0128_sales_evidence_history.sql'))
 await db.exec(`alter table profiles add column name text default '시험 팀원';create table ai_agents(profile_id uuid primary key,role text,instructions text);`)
 await db.exec(await sql('0115_growth_ai_budget.sql'))
 await db.exec(await sql('0129_sales_desk.sql'))
 await db.exec("insert into growth_ai_models values('standard','작성','test-model',3,15,true);insert into growth_ai_budgets(id,starts_at,ends_at,limit_usd,enabled) values(gen_random_uuid(),now()-interval '1 day',now()+interval '1 day',1,true);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','test-gateway');grant usage on schema public,auth to service_role;")
})
after(()=>db.close())
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'))
async function asUser(id,fn,role='authenticated'){await db.exec('savepoint actor');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`);try{return await fn()}catch(e){await db.exec('rollback to actor');throw e}finally{await db.exec('reset role;release actor')}}
async function prospect(source='거래처'){return(await db.query('select * from sales_prospects where source=$1 limit 1',[source])).rows[0]}

const call=(name,args=[])=>db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)
async function submit(action='조회',text='팝업 자료 분석해줘',id=randomUUID(),agent=null){await asUser(admin,()=>call('sales_desk_submit',[id,agent,action,text]));return id}
async function claim(id){const j=(await db.query('select token from private.sales_desk_jobs where id=$1',[id])).rows[0];return(await asUser(admin,()=>call('sales_desk_claim',[id,j.token]),'service_role')).rows[0].r}
async function messages(user=admin){return(await asUser(user,()=>call('sales_desk_list',[null]))).rows[0].r}
test('DB instructions are idempotent, owner scoped and cannot be overwritten by clients',async()=>{
 const id=await submit();await submit('조회','팝업 자료 분석해줘',id)
 assert.equal((await messages()).length,1);assert.equal((await messages(member)).length,0)
 assert.equal((await asUser(member,()=>db.query('select * from sales_desk_messages'))).rows.length,0)
 await assert.rejects(submit('조회','다른 지시',id),/동일 요청/)
 await assert.rejects(asUser(member,()=>call('sales_desk_submit',[randomUUID(),null,'조회','팝업 자료'])),e=>e.code==='42501')
 await assert.rejects(asUser(null,()=>call('sales_desk_list',[null]),'anon'),e=>e.code==='42501')
 await assert.rejects(asUser(admin,()=>db.exec('delete from sales_desk_messages')),e=>e.code==='42501')
})
test('database lookup preserves sources, excludes opt-outs and distinguishes no matches',async()=>{
 await submit();let m=(await messages())[0]
 assert.equal(m.status,'완료');assert.equal(m.snapshot.sources.length,2);assert.equal(m.report,null)
 assert.equal((await db.query('select count(*) n from net.requests')).rows[0].n,0)
 await submit('조회','존재하지않는브랜드');m=(await messages()).at(-1)
 assert.equal(m.snapshot.matched_total,0);assert.equal(m.snapshot.sources.length,0)
 await db.exec('update sales_prospects set blocked=true');await submit();assert.equal((await messages()).at(-1).snapshot.sources.length,0)
})
test('AI assignee is a real active AI profile; human and inactive identities fail',async()=>{
 await assert.rejects(submit('조회','팝업 자료',randomUUID(),member),/활성 AI/)
 await db.query("update profiles set is_agent=true,name='분석 팀원' where id=$1",[member]);await db.query("insert into ai_agents values($1,'영업 분석','사실과 추정 분리')",[member])
 await submit('조회','팝업 자료',randomUUID(),member);assert.equal((await messages())[0].agent_name,'분석 팀원')
 await db.query('update profiles set active=false where id=$1',[member]);await assert.rejects(submit('조회','팝업 자료',randomUUID(),member),/활성 AI/)
})
test('report claims are single use, budgeted and source citations are validated server-side',async()=>{
 const id=await submit('보고서'),job=await claim(id);assert.equal(job.actor,admin);assert.equal(job.snapshot.sources.length,2);assert.equal(await claim(id),null)
 await assert.rejects(asUser(admin,()=>call('sales_desk_claim',[id,randomUUID()])),e=>e.code==='42501')
 await assert.rejects(asUser(admin,()=>call('sales_desk_ai_reserve',[id,member,'write','a'.repeat(64),'standard',100]),'service_role'),e=>e.code==='42501')
 const reserve=(await asUser(admin,()=>call('sales_desk_ai_reserve',[id,admin,'write','a'.repeat(64),'standard',100]),'service_role')).rows[0].r
 assert.equal(reserve.execute,true)
 const report={title:'팝업 보고서',summary:'저장 자료 분석',findings:[{text:'공식 근거 확인',evidence_ids:[job.snapshot.sources[0].id]}],recommendations:['시스템 추가 조사'],limitations:['실제 발주 미확인']}
 await assert.rejects(asUser(admin,()=>call('sales_desk_finish',[id,JSON.stringify({...report,findings:[{text:'거짓 근거',evidence_ids:[randomUUID()]}]}),'']),'service_role'),/제공되지 않은 근거/)
 await asUser(admin,()=>call('sales_desk_finish',[id,JSON.stringify(report),'']),'service_role')
 const m=(await messages())[0];assert.equal(m.status,'완료');assert.equal(m.report.title,'팝업 보고서')
 await asUser(admin,()=>call('sales_desk_finish',[id,null,'중복 결과']),'service_role');assert.equal((await messages())[0].status,'완료')
})
test('collection acknowledgment does not claim completion and failed or expired AI jobs preserve inputs',async()=>{
 await submit('수집','자료 취합');assert.match((await messages())[0].reply,/완료를 뜻하지/)
 const id=await submit('보고서');await claim(id)
 await db.query("update sales_desk_messages set created_at=now()-interval '6 minutes' where id=$1",[id]);await db.exec('select private.sales_desk_watchdog()')
 const m=(await messages()).at(-1);assert.equal(m.status,'실패');assert.equal(m.instruction,'팝업 자료 분석해줘');assert.ok(m.snapshot)
 await asUser(admin,()=>call('sales_desk_finish',[id,null,'늦은 응답']),'service_role');assert.match((await messages()).at(-1).reply,/시간이 초과/)
})
test('older conversation pages preserve stable sequence without losing latest records',async()=>{
 for(let i=0;i<32;i++)await submit('조회','팝업 자료 '+i)
 const recent=await messages();assert.equal(recent.length,30)
 const older=(await asUser(admin,()=>call('sales_desk_list',[recent[0].sequence]))).rows[0].r
 assert.equal(older.length,2);assert.equal(new Set([...older,...recent].map(m=>m.id)).size,32)
})
