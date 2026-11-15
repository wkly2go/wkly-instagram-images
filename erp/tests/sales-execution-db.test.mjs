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
 create table mail_index(id text primary key,thread_id text not null,from_addr text,to_addr text,subject text,snippet text,sent_at timestamptz,synced_at timestamptz default now(),labels text[] default '{}');
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
 await db.exec(await sql('20261115090105_sales_execution_packages.sql'))
 await db.exec(await sql('20261115090106_sales_dispatch_queue.sql'))
 await db.exec(await sql('20261115090107_sales_readiness.sql'))
 await db.exec(await sql('20261115090108_sales_contact_evidence.sql'))
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
const execution=id=>asUser(admin,()=>call('sales_execution_get',[id])).then(r=>r.rows[0].r)
const decision=(p,kind='승인')=>asUser(admin,()=>call('sales_execution_decide',[p.id,p.version,p.fingerprint,kind]))
test('preparation automatically creates exact recipient, text, proposal and Korean business-hour material without sending',async()=>{
 const j=await prepared('담당자'),p=await execution(j.id)
 assert.equal(p.version,1);assert.equal(p.status,'준비 중');assert.equal(p.can_approve,false);assert.equal(p.fingerprint.length,64)
 assert.equal(p.payload.messages[0].recipient,'human@example.com');assert.equal(p.payload.messages[0].body,pack.contact_draft)
 assert.equal(p.payload.attachments[0].content,pack.proposal);assert.equal(p.payload.sender,null);assert.equal(p.payload.transport_enabled,false)
 const scheduled=new Date(p.payload.schedule.at),kst=new Date(scheduled.getTime()+9*3600000)
 assert.equal(kst.getUTCHours(),10);assert.ok(kst.getUTCDay()>=1&&kst.getUTCDay()<=5);assert.equal(p.payload.schedule.per_recipient_limit,1)
 assert.equal((await db.query('select count(*) n from net.requests')).rows[0].n,2)
 await assert.rejects(decision(p),/発送|발송 조건/)
})
test('unchanged refresh preserves the exact version and audit count',async()=>{
 const j=await prepared(),before=await execution(j.id)
 for(let i=0;i<3;i++)await db.query('select private.sales_execution_refresh($1)',[j.id])
 const after=await execution(j.id);assert.equal(after.id,before.id);assert.equal(after.events.length,1)
})
test('changed recipient invalidates the old view immediately and stores a new immutable version',async()=>{
 const j=await prepared('담당자'),old=await execution(j.id)
 await db.query("update contacts set email='new@example.com' where id=$1",[person])
 const stale=await execution(j.id);assert.equal(stale.current,false);assert.equal(stale.status,'재검토');assert.equal(stale.can_approve,false)
 await assert.rejects(decision(old),e=>e.code==='PT409')
 await db.query('select private.sales_execution_refresh($1)',[j.id]);const latest=await execution(j.id)
 assert.equal(latest.version,2);assert.equal(latest.payload.messages[0].recipient,'new@example.com')
 const preserved=(await db.query('select payload,status from sales_execution_packages where id=$1',[old.id])).rows[0]
 assert.equal(preserved.payload.messages[0].recipient,'human@example.com');assert.equal(preserved.status,'재검토')
 await assert.rejects(decision(old,'보류'),e=>e.code==='PT409')
})
test('new opt-outs remove recipients and keep a visible system blocker',async()=>{
 const j=await prepared('담당자'),old=await execution(j.id)
 await db.query("insert into brand_contacts(id,email,opt_out) values($1,' HUMAN@example.com ',true)",[randomUUID()])
 assert.equal((await execution(j.id)).current,false)
 await db.query('select private.sales_execution_refresh($1)',[j.id]);const p=await execution(j.id)
 assert.equal(p.payload.messages.length,0);assert.ok(p.blockers.some(b=>b.includes('수신 거부')));await assert.rejects(decision(p),/발송 조건/)
 assert.notEqual(p.fingerprint,old.fingerprint)
})
test('same recipient is deduplicated across evidence and different companies block delivery',async()=>{
 await db.query("update contacts set email='team@example.com' where id=$1",[person]);const j=await prepared('담당자')
 const company=(await db.query("select id from sales_prospects where source='거래처' limit 1")).rows[0].id
 await db.query("update sales_strategies set plan=jsonb_set(plan,'{evidence_ids}',(plan->'evidence_ids')||to_jsonb($2::text)) where id=$1",[j.id,company])
 await db.query('select private.sales_execution_refresh($1)',[j.id]);const p=await execution(j.id)
 assert.equal(p.payload.messages.length,1);assert.equal(p.payload.messages[0].source_ids.length,2)
 const other=randomUUID();await db.query("insert into clients(id,name,email) values($1,'다른 회사','team@example.com')",[other])
 await db.query('update sales_prospects set client_id=$1,contact_id=null where id=$2',[other,company])
 await db.query('select private.sales_execution_refresh($1)',[j.id]);assert.ok((await execution(j.id)).blockers.some(b=>b.includes('여러 회사')))
})
test('body, attachment and scheduling changes require a new version instead of reusing a decision',async()=>{
 const j=await prepared(),p=await execution(j.id);await decision(p,'보류');await decision(p,'보류')
 assert.equal((await execution(j.id)).events.filter(e=>e.kind==='보류').length,1)
 await db.query("update sales_strategies set preparation=jsonb_set(preparation,'{proposal}','\"수정 제안\"') where id=$1",[j.id])
 assert.equal((await execution(j.id)).current,false);await assert.rejects(decision(p),e=>e.code==='PT409')
 await db.query('select private.sales_execution_refresh($1)',[j.id]);const next=await execution(j.id)
 assert.equal(next.version,2);assert.equal(next.status,'보류');assert.equal(next.payload.attachments[0].content,'수정 제안')
})
test('anonymous users and members cannot decide, and clients cannot change content or audit events',async()=>{
 const j=await prepared(),p=await execution(j.id)
 await assert.rejects(asUser(null,()=>call('sales_execution_get',[j.id]),'anon'),e=>e.code==='42501')
 assert.ok((await asUser(member,()=>call('sales_execution_get',[j.id]))).rows[0].r)
 await assert.rejects(asUser(member,()=>call('sales_execution_decide',[p.id,p.version,p.fingerprint,'보류'])),e=>e.code==='42501')
 await assert.rejects(asUser(admin,()=>db.exec("update sales_execution_packages set status='승인'")),e=>e.code==='42501')
 await assert.rejects(asUser(admin,()=>db.exec('delete from sales_execution_events')),e=>e.code==='42501')
})
test('the scheduled refresh discovers changes and keeps old source documents intact',async()=>{
 const j=await prepared(),old=await execution(j.id)
 await db.query("update sales_prospects set evidence='수정된 문의' where id=(select (plan->'evidence_ids'->>0)::uuid from sales_strategies where id=$1)",[j.id])
 await db.exec('select private.sales_execution_schedule()');const p=await execution(j.id)
 assert.equal(p.version,2);assert.notEqual(p.fingerprint,old.fingerprint)
 assert.equal((await db.query('select count(*) n from sales_execution_packages')).rows[0].n,2)
 assert.equal(p.current,true);assert.equal(p.can_approve,false)
})
test('changed sources clear any previous approval metadata and append an audit event',async()=>{
 const j=await prepared(),p=await execution(j.id)
 // Isolate legacy refresh invalidation from dispatch authorization; no provider is called.
 await db.exec('alter table sales_execution_packages disable trigger sales_dispatch_enqueue')
 await db.query("update sales_execution_packages set status='승인',approved_by=$2,approved_at=now() where id=$1",[p.id,admin])
 await db.query("update clients set email='revised@example.com' where id=$1",[client])
 await db.query('select private.sales_execution_refresh($1)',[j.id])
 const old=(await db.query('select status,approved_at,approved_by from sales_execution_packages where id=$1',[p.id])).rows[0]
 assert.equal(old.status,'재검토');assert.equal(old.approved_at,null);assert.equal(old.approved_by,null)
 assert.ok((await execution(j.id)).events.some(e=>e.kind==='재검토'))
})
test('briefing counts only the latest package and leaves unconnected delivery totals unknown',async()=>{
 const j=await prepared();await db.query("update clients set email='updated@example.com' where id=$1",[client]);await db.query('select private.sales_execution_refresh($1)',[j.id])
 const summary=(await db.query('select private.sales_execution_summary() s')).rows[0].s
 assert.equal(summary.total,1);assert.equal(summary.needs_verification,1);assert.equal(summary.sent,null);assert.equal(summary.delivery_connected,false)
 const snapshot=(await db.query("select private.sales_desk_snapshot('영업 자료') s")).rows[0].s
 assert.deepEqual(snapshot.execution,summary)
})
test('daily notifications distinguish unfinished preparation from review-ready plans and actual sends',async()=>{
 await db.exec("alter table notices add column body text;create or replace function notify(u uuid,k text,t text,b text,l text) returns void language sql as $$insert into public.notices(user_id,title,body) values(u,t,b)$$")
 const j=await planned();await db.exec('select private.sales_strategy_brief()')
 let body=(await db.query('select body from notices')).rows[0].body
 assert.match(body,/검토 대기 0건/);assert.match(body,/자동 준비 중 1건/)
 await claim(j.prep);await asUser(admin,()=>call('sales_strategy_prepared',[j.prep,JSON.stringify(pack),'']),'service_role')
 await db.exec('delete from notices;select private.sales_strategy_brief()');body=(await db.query('select body from notices')).rows[0].body
 assert.match(body,/검토 대기 1건/);assert.match(body,/검증 대기 1건/);assert.match(body,/발송·회신 기록은 미연결/)
})

// Test-only material adapter. Production remains transport-disabled.
async function connectedFixture(){
 const diagnostic=(await asUser(admin,()=>call('sales_sender_check_begin'),'service_role')).rows[0].r
 await asUser(admin,()=>call('sales_sender_check_finish',[diagnostic,JSON.stringify({code:'ready',email:'sender@example.com',can_send:true,can_read:true,valid_for:900})]),'service_role')
 await db.exec(`alter function private.sales_execution_material(uuid) rename to execution_test_original;
 create function private.sales_execution_material(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
 declare m jsonb; payload jsonb; proofs jsonb; blockers jsonb;
 begin
 m:=private.execution_test_original(p_id);if m is null then return null;end if;
 select coalesce(jsonb_object_agg(value->>'recipient',jsonb_build_object('status','verified','evidence','test-only permitted contact record','purpose','test proposal','valid_until',now()+interval '2 hours')),'{}') into proofs from jsonb_array_elements(m->'payload'->'messages');
 payload:=(m->'payload')||jsonb_build_object('sender','sender@example.com','transport_enabled',true,'recipient_verification',proofs,'schedule',jsonb_build_object('at',now()-interval '1 minute','expires_at',now()+interval '1 hour','per_recipient_limit',1));
 select coalesce(jsonb_agg(value),'[]') into blockers from jsonb_array_elements_text(m->'blockers') where value not in ('발신 계정·이메일 발송 권한과 전송 처리가 아직 연결되지 않았습니다.','시스템의 수신 자격·문안·제안 범위 검증이 완료되지 않았습니다.');
 return jsonb_build_object('payload',payload,'blockers',blockers,'fingerprint',encode(sha256(convert_to(jsonb_build_array(payload,blockers)::text,'UTF8')),'hex'));
 end $$;`)
 const j=await prepared('담당자'),p=await execution(j.id)
 return {j,p}
}
async function dispatchFixture(){const {j,p}=await connectedFixture();await decision(p);const job=(await db.query('select * from private.sales_dispatch_jobs where package_id=$1',[p.id])).rows[0];return {j,p,job}}
const dispatchClaim=id=>asUser(admin,()=>call('sales_dispatch_claim',[id]),'service_role').then(r=>r.rows[0].r)
const dispatchFinish=(id,token,outcome,receipt=null)=>asUser(admin,()=>call('sales_dispatch_finish',[id,token,outcome,receipt]),'service_role')

test('preparation and transport-blocked approval never queue a message',async()=>{
 const j=await prepared(),p=await execution(j.id);await assert.rejects(decision(p),/발송 조건/)
 assert.equal((await db.query('select count(*) n from private.sales_dispatch_jobs')).rows[0].n,0)
 assert.equal(p.dispatch.connected,false);assert.deepEqual(p.dispatch.jobs,[])
})
test('exact approved package queues once and does not expose worker credentials',async()=>{
 const {j,p,job}=await dispatchFixture();await decision(p)
 assert.equal(job.recipient,'human@example.com');assert.equal(job.fingerprint,p.fingerprint);assert.deepEqual(job.message,p.payload.messages[0])
 assert.equal((await db.query('select count(*) n from private.sales_dispatch_jobs')).rows[0].n,1)
 await assert.rejects(asUser(admin,()=>call('sales_dispatch_claim',[job.id])),e=>e.code==='42501')
 await assert.rejects(asUser(admin,()=>db.query('select * from private.sales_dispatch_jobs')),e=>e.code==='42501')
 const visible=(await execution(j.id)).dispatch.jobs[0];assert.equal(visible.state,'queued');assert.equal('claim_token' in visible,false)
})
test('single-use claim, receipt validation and idempotent completion prevent duplicate processing',async()=>{
 const {job}=await dispatchFixture(),lease=await dispatchClaim(job.id)
 assert.ok(lease.token);assert.equal(lease.sender,'sender@example.com');assert.equal(await dispatchClaim(job.id),null)
 await assert.rejects(dispatchFinish(job.id,randomUUID(),'accepted','receipt'),e=>e.code==='42501')
 await assert.rejects(dispatchFinish(job.id,lease.token,'accepted',''),/접수 식별자/)
 await dispatchFinish(job.id,lease.token,'accepted','receipt-1');await dispatchFinish(job.id,lease.token,'accepted','receipt-1')
 await assert.rejects(dispatchFinish(job.id,lease.token,'rejected'),e=>e.code==='PT409')
 const row=(await db.query('select * from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0]
 assert.equal(row.state,'accepted');assert.match(row.reason,/수신함 도착·열람 확인 아님/)
 assert.equal((await db.query("select count(*) n from private.sales_dispatch_events where job_id=$1 and state='accepted'",[job.id])).rows[0].n,1)
})
test('a hold invalidates dispatch before a worker can claim it',async()=>{
 const {p,job}=await dispatchFixture();await decision(p,'보류');assert.equal(await dispatchClaim(job.id),null)
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'cancelled')
})
test('opt-out after approval is rechecked before releasing message material',async()=>{
 const {job}=await dispatchFixture();await db.query("insert into brand_contacts(id,email,opt_out) values($1,' HUMAN@example.com ',true)",[randomUUID()])
 assert.equal(await dispatchClaim(job.id),null)
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'cancelled')
})
test('future and expired jobs cannot be claimed',async()=>{
 const {job}=await dispatchFixture()
 await db.query("update private.sales_dispatch_jobs set scheduled_at=now()+interval '10 minutes' where id=$1",[job.id]);assert.equal(await dispatchClaim(job.id),null)
 await db.query("update private.sales_dispatch_jobs set scheduled_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1",[job.id]);await db.exec('select private.sales_dispatch_watchdog()')
 assert.equal(await dispatchClaim(job.id),null)
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'expired')
})
test('lost response blocks retries and new versions until a late provider receipt reconciles it',async()=>{
 const {j,job}=await dispatchFixture(),lease=await dispatchClaim(job.id)
 await db.query("update private.sales_dispatch_jobs set claimed_at=now()-interval '6 minutes' where id=$1",[job.id]);await db.exec('select private.sales_dispatch_watchdog()')
 assert.equal(await dispatchClaim(job.id),null)
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'unknown')
 await db.query("update sales_strategies set preparation=jsonb_set(preparation,'{proposal}','\"updated test proposal\"') where id=$1",[j.id]);await db.query('select private.sales_execution_refresh($1)',[j.id])
 await assert.rejects(decision(await execution(j.id)),/중복 실행/)
 await dispatchFinish(job.id,lease.token,'accepted','late-receipt')
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'accepted')
})
test('missing eligibility evidence rolls back approval and its audit event',async()=>{
 const {j,p}=await connectedFixture()
 await db.exec(`alter function private.sales_execution_material(uuid) rename to execution_test_connected;
 create function private.sales_execution_material(p_id uuid) returns jsonb language sql stable as $$select jsonb_set(private.execution_test_connected(p_id),'{payload,recipient_verification}','{}')$$`)
 await db.query("update sales_execution_packages set payload=jsonb_set(payload,'{recipient_verification}','{}') where id=$1",[p.id])
 await assert.rejects(decision(p),/수신 자격/)
 assert.equal((await execution(j.id)).status,'승인 대기')
 assert.equal((await db.query("select count(*) n from sales_execution_events where package_id=$1 and kind='승인'",[p.id])).rows[0].n,0)
})
test('approval window remains stable across report refreshes instead of moving to tomorrow',async()=>{
 const j=await prepared(),p=await execution(j.id)
 await db.query("update sales_execution_packages set payload=jsonb_set(payload,'{schedule}',jsonb_build_object('at',now()-interval '1 hour','expires_at',now()+interval '3 hours','timezone','Asia/Seoul','per_recipient_limit',1,'followups','없음 · 회신 시 재접촉 중단')) where id=$1",[p.id])
 const stored=(await db.query("select payload->'schedule' s from sales_execution_packages where id=$1",[p.id])).rows[0].s
 const material=(await db.query("select private.sales_execution_material($1)->'payload'->'schedule' s",[j.id])).rows[0].s
 assert.deepEqual(material,stored)
})
test('changed queued versions are cancelled atomically before the new version can be approved',async()=>{
 const {j,job}=await dispatchFixture()
 await db.query("update sales_strategies set preparation=jsonb_set(preparation,'{proposal}','\"changed proposal\"') where id=$1",[j.id]);await db.query('select private.sales_execution_refresh($1)',[j.id])
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'cancelled')
 await decision(await execution(j.id))
 assert.equal((await db.query("select count(*) n from private.sales_dispatch_jobs where state='queued'")).rows[0].n,1)
})
test('expired jobs are rechecked even without the watchdog',async()=>{
 const {job}=await dispatchFixture()
 await db.query("update private.sales_dispatch_jobs set scheduled_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1",[job.id]);assert.equal(await dispatchClaim(job.id),null)
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'expired')
})
test('revoked administrator access prevents a previously approved queued send',async()=>{
 const {job}=await dispatchFixture();await db.query('update profiles set active=false where id=$1',[admin])
 assert.equal(await dispatchClaim(job.id),null)
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'cancelled')
})

test('sender diagnostics are service-owned and single-flight; credentials cannot be persisted',async()=>{
 await assert.rejects(asUser(admin,()=>call('sales_sender_check_begin')),e=>e.code==='42501')
 const run=(await asUser(admin,()=>call('sales_sender_check_begin'),'service_role')).rows[0].r
 assert.ok(run);assert.equal((await asUser(admin,()=>call('sales_sender_check_begin'),'service_role')).rows[0].r,null)
 const result={code:'read_only',email:'sender@example.com',can_send:false,can_read:true,valid_for:900}
 await assert.rejects(asUser(admin,()=>call('sales_sender_check_finish',[run,JSON.stringify({...result,access_token:'do-not-store'})]),'service_role'),/Invalid diagnostic/)
 await asUser(admin,()=>call('sales_sender_check_finish',[run,JSON.stringify(result)]),'service_role')
 const j=await prepared(),p=await execution(j.id)
 assert.equal(p.readiness.sender.code,'read_only');assert.equal(p.readiness.sender.can_send,false);assert.equal(p.can_approve,false)
 assert.equal('run_id' in p.readiness.sender,false)
 await assert.rejects(asUser(admin,()=>db.exec('select * from private.sales_sender_readiness')),e=>e.code==='42501')
})
test('old diagnostic response cannot overwrite a newer run and expired capability cannot authorize a send',async()=>{
 const {job}=await dispatchFixture()
 await db.exec("update private.sales_sender_readiness set valid_until=now()-interval '1 second',checked_at=now()-interval '2 minutes'")
 const old=(await db.query('select run_id from private.sales_sender_readiness')).rows[0].run_id
 const next=(await asUser(admin,()=>call('sales_sender_check_begin'),'service_role')).rows[0].r;assert.notEqual(old,next)
 const result={code:'ready',email:'sender@example.com',can_send:true,can_read:true,valid_for:900}
 await assert.rejects(asUser(admin,()=>call('sales_sender_check_finish',[old,JSON.stringify(result)]),'service_role'),e=>e.code==='PT409')
 assert.equal(await dispatchClaim(job.id),null)
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'cancelled')
})
test('unresponsive diagnostic leases expire and sender identity mismatch prevents dispatch',async()=>{
 const {job,j}=await dispatchFixture();await db.exec("update private.sales_sender_readiness set email='other@example.com'")
 assert.equal(await dispatchClaim(job.id),null)
 await db.exec("update private.sales_sender_readiness set code='checking',started_at=now()-interval '3 minutes'")
 assert.equal((await execution(j.id)).readiness.sender.code,'stale')
 assert.ok((await asUser(admin,()=>call('sales_sender_check_begin'),'service_role')).rows[0].r)
})
test('recipient checks distinguish actual DB gaps without assuming permission from an email address',async()=>{
 const j=await prepared('담당자');let p=await execution(j.id)
 assert.equal(p.readiness.recipients[0].code,'permission_unverified')
 await db.query("insert into brand_contacts(id,email,opt_out) values($1,'human@example.com',true)",[randomUUID()]);p=await execution(j.id)
 assert.equal(p.readiness.recipients[0].code,'excluded')
 await db.exec('delete from brand_contacts');await db.query("update contacts set email='' where id=$1",[person]);p=await execution(j.id)
 assert.equal(p.readiness.recipients[0].code,'missing_contact')
 assert.equal(p.payload.transport_enabled,false)
})
test('one mailbox linked to different companies is flagged automatically',async()=>{
 const j=await prepared('담당자'),company=(await db.query("select id from sales_prospects where source='거래처' limit 1")).rows[0].id
 const other=randomUUID();await db.query("insert into clients(id,name,email) values($1,'다른 회사','human@example.com')",[other]);await db.query('update sales_prospects set client_id=$1 where id=$2',[other,company])
 await db.query("update sales_strategies set plan=jsonb_set(plan,'{evidence_ids}',(plan->'evidence_ids')||to_jsonb($2::text)) where id=$1",[j.id,company])
 const p=await execution(j.id);assert.equal(p.readiness.recipients.length,2);assert.ok(p.readiness.recipients.every(r=>r.code==='ambiguous_company'))
})

const mail=async(id,from='human@example.com',to='sender@example.com',age='1 day',labels=[])=>db.query("insert into mail_index(id,thread_id,from_addr,to_addr,subject,snippet,sent_at,labels) values($1,$2,$3,$4,'팝업 운영 문의','시험 자료: 범위와 일정 확인 요청',now()-$5::interval,$6)",[id,'thread-'+id,from,to,age,labels])
test('contact evidence uses exact normalized addresses and excludes drafts, spam, trash, old and future mail',async()=>{
 await mail('exact',' HUMAN@example.com ');await mail('suffix','otherhuman@example.com');await mail('multi','other@example.com','human@example.com, other@example.com')
 await mail('old',undefined,undefined,'181 days');await mail('future',undefined,undefined,'-1 day');await mail('spam',undefined,undefined,'1 day',['SPAM']);await mail('trash',undefined,undefined,'1 day',['TRASH']);await mail('draft',undefined,undefined,'1 day',['DRAFT'])
 const j=await prepared('담당자'),report=(await execution(j.id)).payload.contact_evidence
 assert.equal(report.contacts.length,1);assert.equal(report.contacts[0].mail.length,1);assert.equal(report.contacts[0].mail[0].id,'exact')
 assert.equal(report.contacts[0].outreach_authorized,false);assert.match(report.contacts[0].assessment,/검증 전/);assert.ok(report.contacts[0].sources[0].signature)
})
test('evidence is bounded, deduplicates contacts and reports its scope honestly',async()=>{
 for(let i=0;i<7;i++)await mail('mail-'+i,undefined,undefined,`${i+1} days`)
 const j=await prepared('담당자'),company=(await db.query("select id from sales_prospects where source='거래처' limit 1")).rows[0].id
 await db.query("update clients set email='human@example.com' where id=$1",[client]);await db.query("update sales_strategies set plan=jsonb_set(plan,'{evidence_ids}',(plan->'evidence_ids')||to_jsonb($2::text)) where id=$1",[j.id,company]);await db.query('select private.sales_execution_refresh($1)',[j.id])
 const report=(await execution(j.id)).payload.contact_evidence
 assert.equal(report.contacts.length,1);assert.equal(report.contacts[0].sources.length,2);assert.equal(report.contacts[0].sampled_matches,7);assert.equal(report.contacts[0].mail.length,5)
 assert.equal(report.contacts[0].mail[0].id,'mail-0');assert.equal(report.mail_truncated,false);assert.match(report.scope,/CC\/BCC/)
})
test('new relevant mail invalidates approved material; unrelated mail does not churn versions',async()=>{
 const {j,p,job}=await dispatchFixture();await mail('unrelated','different@example.com','else@example.com')
 assert.equal((await execution(j.id)).current,true)
 await mail('relevant');assert.equal((await execution(j.id)).current,false);assert.equal(await dispatchClaim(job.id),null)
 await db.query('select private.sales_execution_refresh($1)',[j.id]);const next=await execution(j.id)
 assert.equal(next.version,p.version+1);assert.equal(next.payload.contact_evidence.contacts[0].mail[0].id,'relevant')
 const old=(await db.query('select payload from sales_execution_packages where id=$1',[p.id])).rows[0].payload
 assert.equal(old.contact_evidence.contacts[0].mail.length,0)
})
test('changed or withdrawn source messages invalidate the old saved excerpts without deleting them',async()=>{
 await mail('evidence');const j=await prepared('담당자'),p=await execution(j.id)
 await db.exec("update mail_index set snippet='수정된 요청 범위' where id='evidence'");assert.equal((await execution(j.id)).current,false)
 await db.query('select private.sales_execution_refresh($1)',[j.id]);let next=await execution(j.id);assert.equal(next.payload.contact_evidence.contacts[0].mail[0].excerpt,'수정된 요청 범위')
 await db.exec("update mail_index set labels=array['TRASH'] where id='evidence'");assert.equal((await execution(j.id)).current,false)
 await db.query('select private.sales_execution_refresh($1)',[j.id]);next=await execution(j.id);assert.equal(next.payload.contact_evidence.contacts[0].mail.length,0)
 assert.match((await db.query('select payload from sales_execution_packages where id=$1',[p.id])).rows[0].payload.contact_evidence.contacts[0].mail[0].excerpt,/시험 자료/)
})
test('excluded recipients remain excluded despite matching contact history',async()=>{
 await mail('past');const j=await prepared('담당자');await db.query("insert into brand_contacts(id,email,opt_out) values($1,'human@example.com',true)",[randomUUID()])
 await db.query('select private.sales_execution_refresh($1)',[j.id]);const report=(await execution(j.id)).payload.contact_evidence
 assert.equal(report.contacts[0].excluded,true);assert.equal(report.contacts[0].mail.length,1);assert.equal(report.contacts[0].outreach_authorized,false);assert.match(report.contacts[0].assessment,/발송 중단/)
})
test('matching scan cap is explicit and clients cannot invoke the private evidence collector',async()=>{
 await db.exec("insert into mail_index(id,thread_id,from_addr,to_addr,subject,snippet,sent_at) select 'bulk-'||n,'thread-'||n,'human@example.com','sender@example.com','fixture','fixture',now()-n*interval '1 minute' from generate_series(1,1002) n")
 const j=await prepared('담당자'),report=(await execution(j.id)).payload.contact_evidence
 assert.equal(report.mail_truncated,true);assert.equal(report.contacts[0].sampled_matches,1000);assert.equal(report.contacts[0].mail.length,5)
 await assert.rejects(asUser(admin,()=>call('private.sales_contact_evidence',[j.id])),e=>e.code==='42501')
})
test('contact report cap is explicit without silently presenting a partial target list as complete',async()=>{
 const j=await prepared()
 await db.exec(`create or replace function private.sales_strategy_targets(p_id uuid) returns jsonb language sql stable as $$select jsonb_agg(jsonb_build_object('source_id',gen_random_uuid(),'email','contact-'||n||'@example.com','company','시험 회사','person','','status','저장 연락처 연결')) from generate_series(1,52) n$$`)
 const report=(await db.query('select private.sales_contact_evidence($1) r',[j.id])).rows[0].r
 assert.equal(report.contact_total,52);assert.equal(report.contacts.length,50);assert.equal(report.contacts_truncated,true)
})
test('preparation worker receives saved contact evidence and rejects stale output with one bounded automatic retry',async()=>{
 await mail('first');const j=await planned('담당자'),job=await claim(j.prep)
 assert.equal(job.contact_evidence.contacts[0].mail[0].id,'first')
 await mail('second',undefined,undefined,'1 hour')
 await asUser(admin,()=>call('sales_strategy_prepared',[j.prep,JSON.stringify(pack),'']),'service_role')
 let state=await strategy(j.id);assert.equal(state.preparation_status,'준비 중');assert.equal(state.preparation,null)
 const next=(await db.query('select * from private.sales_strategy_preparations where strategy_id=$1',[j.id])).rows[0]
 assert.notEqual(next.id,j.prep);assert.equal(next.evidence_retries,1);assert.equal(next.claimed,false)
 await asUser(admin,()=>call('sales_strategy_prepared',[j.prep,JSON.stringify(pack),'']),'service_role');assert.equal((await strategy(j.id)).preparation_status,'준비 중')
 const retry=await claim(next.id);assert.equal(retry.contact_evidence.contacts[0].mail[0].id,'second')
 await mail('third',undefined,undefined,'1 minute')
 await asUser(admin,()=>call('sales_strategy_prepared',[next.id,JSON.stringify(pack),'']),'service_role')
 state=await strategy(j.id);assert.equal(state.preparation_status,'확인 필요');assert.equal(state.preparation,null)
 assert.equal((await db.query('select evidence_retries from private.sales_strategy_preparations where strategy_id=$1',[j.id])).rows[0].evidence_retries,1)
})
test('new mail after completion triggers one automatic rewrite and cancels old queued work',async()=>{
 const {j,p,job}=await dispatchFixture();await mail('late-evidence',undefined,undefined,'1 minute')
 await db.exec('select private.sales_contact_evidence_tick()')
 assert.equal((await strategy(j.id)).preparation_status,'준비 중')
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[job.id])).rows[0].state,'cancelled')
 assert.equal((await db.query('select approved_at from sales_execution_packages where id=$1',[p.id])).rows[0].approved_at,null)
 const retry=(await db.query('select * from private.sales_strategy_preparations where strategy_id=$1',[j.id])).rows[0]
 const fresh=await claim(retry.id);assert.equal(fresh.contact_evidence.contacts[0].mail[0].id,'late-evidence')
 await asUser(admin,()=>call('sales_strategy_prepared',[retry.id,JSON.stringify({...pack,proposal:'최신 근거를 반영한 제안'}),'']),'service_role')
 assert.equal((await execution(j.id)).payload.contact_evidence_prepared,true)
 await mail('later-evidence',undefined,undefined,'30 seconds');await db.exec('select private.sales_contact_evidence_tick()')
 assert.equal((await strategy(j.id)).preparation_status,'확인 필요')
 assert.equal((await db.query('select evidence_retries from private.sales_strategy_preparations where strategy_id=$1',[j.id])).rows[0].evidence_retries,1)
})
test('automatic evidence refresh preserves a deliberate execution hold',async()=>{
 const j=await prepared('담당자'),p=await execution(j.id);await decision(p,'보류');await mail('new-held-evidence')
 await db.exec('select private.sales_contact_evidence_tick()')
 const retry=(await db.query('select id from private.sales_strategy_preparations where strategy_id=$1',[j.id])).rows[0]
 await claim(retry.id);await asUser(admin,()=>call('sales_strategy_prepared',[retry.id,JSON.stringify(pack),'']),'service_role')
 assert.equal((await execution(j.id)).status,'보류');assert.equal((await execution(j.id)).can_approve,false)
})
