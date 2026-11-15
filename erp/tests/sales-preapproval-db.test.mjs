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
 await db.exec(await sql('20261115090101_sales_evidence_history.sql'))
 await db.exec(`alter table profiles add column name text default '시험 팀원';create table ai_agents(profile_id uuid primary key,role text,instructions text);`)
 await db.exec(await sql('0115_growth_ai_budget.sql'))
 await db.exec(await sql('0122_sales_strategy.sql'));await db.exec(await sql('0123_sales_strategy_gateway.sql'));await db.exec(await sql('0124_sales_strategy_output.sql'))
 await db.exec(await sql('20261115090102_sales_desk.sql'))
 await db.exec(await sql('20261115090103_sales_g2b_collection.sql'))
 await db.exec(await sql('20261115090104_sales_preapproval.sql'))
 await db.exec("insert into growth_ai_models values('standard','작성','test-model',3,15,true);insert into growth_ai_budgets(id,starts_at,ends_at,limit_usd,enabled) values(gen_random_uuid(),now()-interval '1 day',now()+interval '1 day',1,true);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','test-gateway');grant usage on schema public,auth to service_role;")
})
after(()=>db.close())
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'))
async function asUser(id,fn,role='authenticated'){await db.exec('savepoint actor');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`);try{return await fn()}catch(e){await db.exec('rollback to actor');throw e}finally{await db.exec('reset role;release actor')}}
const call=(name,args=[])=>db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)
const strategy=id=>db.query('select * from sales_strategies where id=$1',[id]).then(r=>r.rows[0])
async function claim(id){const j=(await db.query('select token from private.sales_strategy_jobs where id=$1 union all select token from private.sales_strategy_preparations where id=$1',[id])).rows[0];return(await asUser(admin,()=>call('sales_strategy_claim',[id,j.token]),'service_role')).rows[0].r}
const pack={research:'저장 근거에서 확인한 사실과 미확인 항목',proposal:'팝업 운영 제안 초안',contact_draft:'담당 범위를 확인하는 연락 초안',checks:['수신 자격과 실제 수요 자동 검증 대상']}
async function planned(source='거래처'){
 const id=randomUUID();await asUser(admin,()=>call('sales_strategy_request',[id,'다양한 영업 방법']))
 const job=await claim(id),sid=job.sources.find(s=>s.source===source).id
 const plan={title:'브랜드 체험 프로그램',category:'공동 체험',customer:'기존 연결 기업',opportunity:'팝업 운영 가설',offer:'행사 운영',why_now:'저장 문의 단서',approach:'담당 역할 확인',effect:'의향 확인 가설',resources:'범위 산정 필요',stop_rule:'수요 없으면 중단',first_message:'운영 제안 초안',evidence_ids:[sid],questions:['구체 범위 확인'],metrics:['회신 건수'],steps:[{action:'공식 자료 조사',output:'근거 목록',day:0},{action:'제안 준비',output:'제안 초안',day:1},{action:'대상 검증',output:'수신 자격 검증',day:2}]}
 await asUser(admin,()=>call('sales_strategy_finish',[id,JSON.stringify(plan),'']),'service_role')
 const prep=(await db.query('select id from private.sales_strategy_preparations where strategy_id=$1',[id])).rows[0].id
 return {id,prep,plan}
}
async function prepared(source='거래처'){const j=await planned(source);await claim(j.prep);await asUser(admin,()=>call('sales_strategy_prepared',[j.prep,JSON.stringify(pack),'']),'service_role');return j}
const decide=(j,revision,decision='승인',feedback='')=>asUser(admin,()=>call('sales_strategy_decide',[j.id,revision,decision,feedback]))
test('new plans prepare before a decision; incomplete material cannot be approved and paid work remains authenticated',async()=>{
 const j=await planned(),s=await strategy(j.id)
 assert.equal(s.preparation_before_approval,true);assert.equal(s.preparation_status,'준비 중');assert.equal(s.status,'승인 대기');assert.equal(s.revision,2)
 await assert.rejects(decide(j,2),/준비/)
 const job=await claim(j.prep);assert.equal(job.actor,admin);assert.equal(job.phase,'prepare');assert.equal(await claim(j.prep),null)
 const reservation=(await asUser(admin,()=>call('sales_strategy_ai_reserve',[j.prep,admin,'write','a'.repeat(64),'standard',1000]),'service_role')).rows[0].r
 assert.equal(reservation.execute,true)
 assert.equal((await db.query('select count(*) n from sales_strategy_tasks')).rows[0].n,0)
})
test('completed drafts, sources and targets are frozen by an idempotent decision; new tasks are system-owned',async()=>{
 const j=await prepared(),s=await strategy(j.id);assert.equal(s.revision,3);assert.equal(s.preparation.proposal,pack.proposal)
 await assert.rejects(decide(j,2),e=>e.code==='PT409');await decide(j,3);await decide(j,3)
 const approved=await strategy(j.id);assert.deepEqual(approved.approval_snapshot.targets,s.targets);assert.deepEqual(approved.approval_snapshot.preparation,pack);assert.equal(approved.approval_snapshot.outreach_enabled,false)
 const tasks=(await db.query('select * from sales_strategy_tasks')).rows;assert.equal(tasks.length,3);assert.ok(tasks.every(t=>t.executor==='system'&&t.owner_id===null&&t.status==='대기'))
 await assert.rejects(asUser(admin,()=>call('sales_strategy_task_update',[tasks[0].id,1,'완료','임의 완료 처리'])),e=>e.code==='42501')
 assert.equal((await db.query('select count(*) n from private.sales_strategy_preparations')).rows[0].n,1)
})
test('target database separates companies and people using existing IDs and never guesses emails from prose',async()=>{
 const a=await prepared('담당자'),s=await strategy(a.id),target=s.targets[0]
 assert.equal(target.person_id,person);assert.equal(target.company_id,client);assert.equal(target.email,'human@example.com');assert.equal(target.email_origin,'담당자 DB');assert.equal(target.outreach_ready,false)
 await db.query("update contacts set email='',memo='추측할 이메일 forged@example.com' where id=$1",[person])
 const b=await prepared('담당자');assert.equal((await strategy(b.id)).targets[0].email,'');assert.equal((await strategy(b.id)).targets[0].status,'연락처 자동 보완 대상')
})
test('changed contact data, new opt-out and evidence changes invalidate approval without changing the saved packet',async()=>{
 const j=await prepared('담당자'),before=(await strategy(j.id)).targets
 await db.query("update contacts set email='new@example.com' where id=$1",[person]);await assert.rejects(decide(j,3),e=>e.code==='PT409')
 assert.deepEqual((await strategy(j.id)).targets,before)
 await db.query("update contacts set email='human@example.com' where id=$1",[person])
 await db.query("insert into brand_contacts(id,email,opt_out) values($1,' HUMAN@example.com ',true)",[randomUUID()]);await assert.rejects(decide(j,3),e=>e.code==='PT409')
 await db.exec('delete from brand_contacts');await db.exec("update sales_prospects set evidence='내용 변경'");await assert.rejects(decide(j,3),e=>e.code==='PT409')
})
test('hold or revision while preparation runs cannot be overwritten by a late worker result',async()=>{
 const j=await planned();await claim(j.prep);await decide(j,2,'보류','방향을 다시 검토')
 await asUser(admin,()=>call('sales_strategy_prepared',[j.prep,JSON.stringify(pack),'']),'service_role')
 const saved=await strategy(j.id);assert.equal(saved.status,'보류');assert.equal(saved.preparation,null);assert.equal(saved.preparation_status,'확인 필요')
 await assert.rejects(asUser(admin,()=>call('sales_strategy_ai_reserve',[j.prep,admin,'write','b'.repeat(64),'standard',1000]),'service_role'),e=>e.code==='42501')
 assert.equal((await db.query('select done from private.sales_strategy_preparations where id=$1',[j.prep])).rows[0].done,true)
})
test('timeouts and provider errors preserve plans, reject approval and never require humans to prepare the missing data',async()=>{
 const j=await planned();await db.exec("update private.sales_strategy_preparations set started_at=now()-interval '6 minutes'")
 await db.exec('select private.sales_strategy_receive()');const saved=await strategy(j.id)
 assert.equal(saved.preparation_status,'확인 필요');assert.ok(saved.plan);assert.match(saved.preparation_error,/시스템 복구/)
 await assert.rejects(decide(j,saved.revision),/준비/)
 assert.equal((await db.query('select count(*) n from net.requests')).rows[0].n,2)
})
test('members can read complete reports but cannot mutate preparation, recipient data or decision snapshots',async()=>{
 const j=await prepared()
 const listing=(await asUser(member,()=>call('sales_strategies',[0]))).rows[0].r.items[0]
 assert.equal(listing.preparation_before_approval,true);assert.equal(listing.targets[0].company_id,client)
 await assert.rejects(asUser(member,()=>call('sales_strategy_decide',[j.id,3,'승인',''])),e=>e.code==='42501')
 await assert.rejects(asUser(admin,()=>db.exec("update sales_strategies set targets='[]'")),e=>e.code==='42501')
 await assert.rejects(asUser(admin,()=>call('sales_strategy_prepared',[j.prep,JSON.stringify(pack),''])),e=>e.code==='42501')
})
