import {salesReleaseSQL} from '../scripts/sales-release-sql.mjs'
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
 await db.exec(`alter table profiles add column name text default '시험 팀원';create table ai_agents(profile_id uuid primary key,role text,instructions text);`)
 await db.exec(await sql('0115_growth_ai_budget.sql'))
 await db.exec(await sql('0122_sales_strategy.sql'));await db.exec(await sql('0123_sales_strategy_gateway.sql'));await db.exec(await sql('0124_sales_strategy_output.sql'))
 const releaseNames=['sales_evidence_history','sales_desk','sales_g2b_collection','sales_preapproval','sales_execution_packages','sales_dispatch_queue','sales_readiness','sales_contact_evidence','sales_mail_evidence','sales_contact_discovery','sales_reply_crm']
 const sections=await Promise.all(releaseNames.map(async(name,i)=>(await sql(`202611150901${String(i+1).padStart(2,'0')}_${name}.sql`)).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'')))
 const release=salesReleaseSQL(sections)
 // Failure at the end must leave every migration unapplied, including scheduled jobs.
 await assert.rejects(db.exec(release.replace(/commit;\s*$/, 'select nonexistent_release_probe();\ncommit;')),/nonexistent_release_probe/)
 await db.exec('rollback')
 assert.equal((await db.query("select to_regclass('public.sales_source_history') r")).rows[0].r,null)
 assert.equal((await db.query("select count(*) n from cron.job where jobname='wkly_sales_contact_discovery'")).rows[0].n,0)
 await db.exec(release)
 await assert.rejects(db.exec(release),/partially\/already installed/)
 await db.exec('rollback')
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
 assert.match(body,/검토 대기 1건/);assert.match(body,/검증 대기 1건/);assert.match(body,/CRM 접수 0건 · 대조 회신 0건 · 연락 중단 0건/);assert.match(body,/접수는 도착·열람·수주 확인이 아닙니다/)
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

async function mailReadFixture(){
 await mail('abc123');await db.exec("update mail_index set thread_id='def456' where id='abc123';update private.sales_sender_readiness set code='read_only',email='sender@example.com',can_read=true,can_send=false,valid_until=now()+interval '15 minutes'")
 const j=await prepared('담당자');await db.exec('select private.sales_mail_evidence_tick()')
 const job=(await db.query('select * from private.sales_mail_evidence_jobs where strategy_id=$1',[j.id])).rows[0];return {j,job}
}
const mailReadClaim=job=>asUser(admin,()=>call('sales_mail_evidence_claim',[job.id,job.token]),'service_role').then(r=>r.rows[0].r)
const mailReadFinish=(job,result)=>asUser(admin,()=>call('sales_mail_evidence_finish',[job.id,JSON.stringify(result)]),'service_role')
const mailResult={status:'complete',messages:[{id:'abc123',status:'retrieved',text:'이번 달 팝업 행사 운영 범위와 견적을 요청합니다.',truncated:false,direction:'inbound'}]}
test('mail evidence scheduler queues only exact eligible stored IDs and claims are single-use',async()=>{
 const {j,job}=await mailReadFixture();assert.ok(job);assert.deepEqual(job.messages,[{id:'abc123',thread_id:'def456',emails:['human@example.com']}])
 await db.exec('select private.sales_mail_evidence_tick()');assert.equal((await db.query('select count(*) n from private.sales_mail_evidence_jobs')).rows[0].n,1)
 await assert.rejects(asUser(admin,()=>call('sales_mail_evidence_claim',[job.id,job.token])),e=>e.code==='42501')
 assert.equal((await asUser(admin,()=>call('sales_mail_evidence_claim',[job.id,randomUUID()]),'service_role')).rows[0].r,null)
 assert.equal((await mailReadClaim(job)).mailbox,'sender@example.com');assert.equal(await mailReadClaim(job),null)
 assert.match((await execution(j.id)).mail_evidence.note,/대기·처리 중/)
 await assert.rejects(asUser(admin,()=>db.exec('select * from private.sales_mail_evidence_jobs')),e=>e.code==='42501')
})
test('retrieved body enters immutable evidence and triggers bounded draft refresh without outreach permission',async()=>{
 const {j,job}=await mailReadFixture(),old=await execution(j.id);await mailReadClaim(job);await mailReadFinish(job,mailResult)
 const evidence=(await db.query('select private.sales_contact_evidence($1) r',[j.id])).rows[0].r
 assert.equal(evidence.contacts[0].mail[0].body.text,mailResult.messages[0].text);assert.equal(evidence.contacts[0].outreach_authorized,false);assert.equal((await execution(j.id)).current,false)
 await db.exec('select private.sales_contact_evidence_tick()');assert.equal((await strategy(j.id)).preparation_status,'준비 중')
 assert.equal((await db.query('select payload from sales_execution_packages where id=$1',[old.id])).rows[0].payload.contact_evidence.contacts[0].mail[0].body,null)
 await db.exec("update private.sales_mail_evidence_jobs set created_at=now()-interval '16 minutes';select private.sales_mail_evidence_tick()")
 assert.equal((await db.query('select count(*) n from private.sales_mail_evidence_jobs')).rows[0].n,1)
})
test('mail evidence result rejects extra fields, mismatched IDs and false completion',async()=>{
 const {job}=await mailReadFixture();await mailReadClaim(job)
 for(const r of [{...mailResult,token:'secret'},{...mailResult,messages:[]},{...mailResult,messages:[{...mailResult.messages[0],id:'other'}]},{...mailResult,messages:[{...mailResult.messages[0],truncated:true}]},{status:'partial',messages:[{...mailResult.messages[0],status:'mismatch'}]}])await assert.rejects(mailReadFinish(job,r),/Invalid|Incomplete|Unexpected/)
 await mailReadFinish(job,mailResult);await assert.rejects(mailReadFinish(job,mailResult),e=>e.code==='PT409')
})
test('opt-out during retrieval discards output and expiring leases cannot write late evidence',async()=>{
 const {job}=await mailReadFixture();await mailReadClaim(job);await db.query("insert into brand_contacts(id,email,opt_out) values($1,'human@example.com',true)",[randomUUID()]);await mailReadFinish(job,mailResult)
 assert.equal((await db.query('select state,result from private.sales_mail_evidence_jobs where id=$1',[job.id])).rows[0].state,'expired')
 assert.equal((await db.query('select result from private.sales_mail_evidence_jobs where id=$1',[job.id])).rows[0].result,null)
 await db.query("update private.sales_mail_evidence_jobs set state='claimed',created_at=now()-interval '4 minutes' where id=$1",[job.id]);await assert.rejects(mailReadFinish(job,mailResult),e=>e.code==='PT409')
})
test('failed reads retry at fifteen-minute spacing with three attempts per rolling day',async()=>{
 const {job}=await mailReadFixture();let current=job
 for(let attempt=1;attempt<=3;attempt++){
  await mailReadClaim(current);await mailReadFinish(current,{status:'account_unavailable',messages:[]});await db.exec('select private.sales_mail_evidence_tick()')
  assert.equal((await db.query('select count(*) n from private.sales_mail_evidence_jobs')).rows[0].n,attempt)
  await db.exec("update private.sales_mail_evidence_jobs set created_at=created_at-interval '16 minutes';select private.sales_mail_evidence_tick()")
  current=(await db.query('select * from private.sales_mail_evidence_jobs order by created_at desc limit 1')).rows[0]
 }
 assert.equal((await db.query('select count(*) n from private.sales_mail_evidence_jobs')).rows[0].n,3)
})
test('scheduler waits for read capability and skips opt-outs and unsupported provider IDs',async()=>{
 await mail('invalid');const j=await prepared('담당자');await db.exec('select private.sales_mail_evidence_tick()');assert.equal((await db.query('select count(*) n from private.sales_mail_evidence_jobs')).rows[0].n,0)
 assert.match((await execution(j.id)).mail_evidence.note,/읽기 권한/)
 await db.exec("update private.sales_sender_readiness set code='read_only',email='sender@example.com',can_read=true,valid_until=now()+interval '15 minutes';select private.sales_mail_evidence_tick()")
 assert.equal((await db.query('select count(*) n from private.sales_mail_evidence_jobs')).rows[0].n,0)
})
test('scheduled reads work after diagnostic expiry; worker still must verify live account and unchanged text stays stable',async()=>{
 const {j,job}=await mailReadFixture();await db.exec("update private.sales_sender_readiness set valid_until=now()-interval '1 hour'")
 assert.ok(await mailReadClaim(job));await mailReadFinish(job,mailResult)
 const original=(await db.query('select private.sales_contact_evidence($1) r',[j.id])).rows[0].r
 // A subsequent read of identical material retains its first observation in the immutable snapshot.
 const second=randomUUID();await db.query("insert into private.sales_mail_evidence_jobs(id,strategy_id,input_hash,mailbox,messages,state,created_at,claimed_at) select $1,strategy_id,input_hash,mailbox,messages,'claimed',now(),now() from private.sales_mail_evidence_jobs where id=$2",[second,job.id]);await mailReadFinish({id:second},mailResult)
 assert.deepEqual((await db.query('select private.sales_contact_evidence($1) r',[j.id])).rows[0].r,original)
})
test('mail retrieval selects at most five messages and starts at most three new plans per tick',async()=>{
 await db.exec("update private.sales_sender_readiness set code='read_only',email='sender@example.com',can_read=true,valid_until=now()+interval '15 minutes'")
 for(let i=0;i<8;i++){await mail('a'+i);await db.query("update mail_index set thread_id='def456' where id=$1",['a'+i])}
 for(let i=0;i<4;i++)await prepared('담당자')
 await db.exec('select private.sales_mail_evidence_tick()');let jobs=(await db.query('select * from private.sales_mail_evidence_jobs')).rows
 assert.equal(jobs.length,3);assert.ok(jobs.every(j=>j.messages.length===5));await db.exec('select private.sales_mail_evidence_tick()');jobs=(await db.query('select * from private.sales_mail_evidence_jobs')).rows;assert.equal(jobs.length,4)
})

async function discoveryFixture(){const j=await prepared('담당자');await db.exec('select private.sales_contact_discovery_tick()');const job=(await db.query('select * from private.sales_contact_discovery_jobs where company_id=$1',[client])).rows[0];return {j,job}}
const discoveryClaim=job=>asUser(admin,()=>call('sales_contact_discovery_claim',[job.id,job.token]),'service_role').then(r=>r.rows[0].r)
const discoveryFinish=(job,result)=>asUser(admin,()=>call('sales_contact_discovery_finish',[job.id,JSON.stringify(result)]),'service_role')
const discoveryResult={status:'complete',pages:[{url:'https://example.com/contact',status:'read'}],candidates:[{email:'biz@example.com',url:'https://example.com/contact',excerpt:'사업 제휴 biz@example.com',role:'partnership',domain_match:true}],limited:false}
test('website discovery is one-use and deduplicates the same company across plans',async()=>{
 const {job}=await discoveryFixture();assert.ok(job);await prepared('거래처');await db.exec('select private.sales_contact_discovery_tick()');assert.equal((await db.query('select count(*) n from private.sales_contact_discovery_jobs')).rows[0].n,1)
 await assert.rejects(asUser(admin,()=>call('sales_contact_discovery_claim',[job.id,job.token])),e=>e.code==='42501');assert.equal((await discoveryClaim(job)).company_id,client);assert.equal(await discoveryClaim(job),null)
 await assert.rejects(asUser(admin,()=>db.exec('select * from private.sales_contact_discovery_jobs')),e=>e.code==='42501')
})
test('website candidates preserve sources without overwriting shared contacts or granting permission',async()=>{
 const {j,job}=await discoveryFixture();await discoveryClaim(job);await discoveryFinish(job,discoveryResult)
 const p=await execution(j.id),company=p.contact_discovery.companies[0],candidate=company.candidates[0]
 assert.equal(candidate.email,'biz@example.com');assert.equal(candidate.outreach_authorized,false);assert.equal(candidate.excluded,false);assert.equal(company.attempts,1)
 assert.equal((await db.query('select email from clients where id=$1',[client])).rows[0].email,'team@example.com');assert.equal((await db.query('select email from contacts where id=$1',[person])).rows[0].email,'human@example.com');assert.equal(p.payload.messages[0].recipient,'human@example.com')
 await db.query("insert into brand_contacts(id,email,opt_out) values($1,' BIZ@example.com ',true)",[randomUUID()]);assert.equal((await execution(j.id)).contact_discovery.companies[0].candidates[0].excluded,true)
 await db.exec("update private.sales_contact_discovery_jobs set created_at=now()-interval '16 minutes';select private.sales_contact_discovery_tick()");assert.equal((await db.query('select count(*) n from private.sales_contact_discovery_jobs')).rows[0].n,1)
})
test('changing website or withdrawing active targets invalidates pending and stored discoveries',async()=>{
 const {j,job}=await discoveryFixture();await discoveryClaim(job);await db.query("update clients set website='https://other.com' where id=$1",[client]);await discoveryFinish(job,discoveryResult)
 assert.equal((await db.query('select state,result from private.sales_contact_discovery_jobs where id=$1',[job.id])).rows[0].state,'expired');assert.equal((await execution(j.id)).contact_discovery.companies[0].candidates.length,0)
 await db.exec("update private.sales_contact_discovery_jobs set created_at=now()-interval '16 minutes';select private.sales_contact_discovery_tick()");const next=(await db.query("select * from private.sales_contact_discovery_jobs where state='queued'")).rows[0]
 await db.query("insert into brand_contacts(id,email,opt_out) values($1,'human@example.com',true)",[randomUUID()]);assert.equal(await discoveryClaim(next),null)
})
test('discovery rejects off-site sources, duplicate candidates, excess bounds and false completion',async()=>{
 const {job}=await discoveryFixture();await discoveryClaim(job)
 for(const result of [{...discoveryResult,secret:'no'},{...discoveryResult,pages:[{url:'https://example.com.evil.com/contact',status:'read'}]},{...discoveryResult,candidates:[...discoveryResult.candidates,...discoveryResult.candidates]},{...discoveryResult,candidates:[{...discoveryResult.candidates[0],domain_match:false}]},{...discoveryResult,pages:[]},{...discoveryResult,limited:true}])await assert.rejects(discoveryFinish(job,result),/Invalid|Inconsistent/)
 await discoveryFinish(job,discoveryResult);await assert.rejects(discoveryFinish(job,discoveryResult),e=>e.code==='PT409')
})
test('failed website discovery retries twice per rolling day and expired claims cannot finish',async()=>{
 const {j,job}=await discoveryFixture();await discoveryClaim(job);await discoveryFinish(job,{status:'unavailable',pages:[],candidates:[],limited:false})
 await db.exec('select private.sales_contact_discovery_tick()');assert.equal((await db.query('select count(*) n from private.sales_contact_discovery_jobs')).rows[0].n,1)
 await db.exec("update private.sales_contact_discovery_jobs set created_at=now()-interval '16 minutes';select private.sales_contact_discovery_tick()");const next=(await db.query("select * from private.sales_contact_discovery_jobs where state='queued'")).rows[0];assert.ok(await discoveryClaim(next))
 await db.query("update private.sales_contact_discovery_jobs set created_at=now()-interval '4 minutes' where id=$1",[next.id]);assert.equal((await execution(j.id)).contact_discovery.companies[0].state,'expired');await assert.rejects(discoveryFinish(next,discoveryResult),e=>e.code==='PT409')
 await db.exec("update private.sales_contact_discovery_jobs set created_at=created_at-interval '16 minutes';select private.sales_contact_discovery_tick()");assert.equal((await db.query('select count(*) n from private.sales_contact_discovery_jobs')).rows[0].n,2)
})
test('missing company websites are reported as system research gaps instead of human data tasks',async()=>{
 await db.query("update clients set website=null where id=$1",[client]);const j=await prepared('담당자');await db.exec('select private.sales_contact_discovery_tick()');assert.equal((await db.query('select count(*) n from private.sales_contact_discovery_jobs')).rows[0].n,0)
 const p=await execution(j.id);assert.match(p.contact_discovery.companies[0].note,/시스템의 회사 도메인 추가 조사/);assert.equal(p.contact_discovery.companies[0].website,null)
})

test('read-only release diagnostics find all expected functions and tables, without anonymous execution',async()=>{
 const diagnostics=await readFile(new URL('../supabase/diagnostics/sales_release_readonly.sql',import.meta.url),'utf8')
 const results=await db.exec(diagnostics)
 assert.ok(results[0].rows.length>=8);assert.ok(results[1].rows.length>=19)
 for(const row of [...results[0].rows,...results[1].rows])assert.equal(row.present,true,row.object)
 for(const row of results[1].rows)assert.equal(row.anon_execute,false,row.object)
 assert.equal(results[2].rows.length,3)
})

async function replyFixture(){
 const fixture=await dispatchFixture(),lease=await dispatchClaim(fixture.job.id)
 await dispatchFinish(fixture.job.id,lease.token,'accepted','aa11')
 await db.exec("update private.sales_sender_readiness set can_read=true;insert into mail_index(id,thread_id,from_addr,to_addr,sent_at,labels) values('aa11','ee55','sender@example.com','human@example.com',now(),array['SENT']),('bb22','ee55','human@example.com','sender@example.com',now(),array['INBOX'])")
 await db.exec('select private.sales_reply_tick()')
 const job=(await db.query('select * from private.sales_reply_jobs where dispatch_id=$1',[fixture.job.id])).rows[0]
 const packet=(await asUser(admin,()=>call('sales_reply_claim',[job.id,job.token]),'service_role')).rows[0].r
 return {...fixture,replyJob:job,packet}
}
const finishReply=(id,text,truncated=false)=>asUser(admin,()=>call('sales_reply_finish',[id,JSON.stringify({status:truncated?'partial':'complete',messages:[{id:'bb22',status:'retrieved',text,truncated,direction:'inbound'}]})]),'service_role')
test('accepted receipts create one automatic CRM record; unknown delivery does not become a contact',async()=>{
 const {job}=await dispatchFixture(),lease=await dispatchClaim(job.id)
 await dispatchFinish(job.id,lease.token,'unknown');assert.equal((await db.query('select count(*) n from private.sales_crm_threads')).rows[0].n,0)
 await dispatchFinish(job.id,lease.token,'accepted','aa11');await dispatchFinish(job.id,lease.token,'accepted','aa11');await db.exec('select private.sales_reply_tick()')
 const rows=(await db.query('select * from private.sales_crm_threads')).rows;assert.equal(rows.length,1);assert.equal(rows[0].stage,'접수 확인');assert.equal(rows[0].recipient,'human@example.com')
})
test('reply jobs bind exact recipient, outbound thread, reference and time before one-use retrieval',async()=>{
 const f=await replyFixture();assert.equal(f.packet.mailbox,'sender@example.com');assert.deepEqual(f.packet.messages[0].emails,['human@example.com']);assert.match(f.packet.messages[0].reply_to,/^<wkly-sales-.*@example.com>$/);assert.equal(typeof f.packet.messages[0].not_before,'number')
 assert.equal((await asUser(admin,()=>call('sales_reply_claim',[f.replyJob.id,f.replyJob.token]),'service_role')).rows[0].r,null)
 await assert.rejects(asUser(admin,()=>call('sales_reply_finish',[f.replyJob.id,'{}'])),e=>e.code==='42501')
})
test('matched replies create an idempotent visible CRM history without inventing demand or revenue',async()=>{
 const f=await replyFixture();await finishReply(f.replyJob.id,'자료를 확인했습니다. 내부 검토 예정입니다.')
 const crm=(await execution(f.j.id)).crm;assert.equal(crm.threads.length,1);assert.equal(crm.threads[0].stage,'회신 확인');assert.equal(crm.threads[0].reply_count,1);assert.match(crm.threads[0].next_action,/수주 확정 아님/)
 await db.exec('select private.sales_reply_tick()');assert.equal((await db.query('select count(*) n from private.sales_crm_replies')).rows[0].n,1)
 await assert.rejects(finishReply(f.replyJob.id,'changed'),/Reply lease expired/)
 assert.equal((await db.query('select count(*) n from sales_opportunities')).rows[0].n,0)
})
test('stop expressions suppress the exact recipient and block future approved versions without editing contact DB',async()=>{
 const f=await replyFixture();await finishReply(f.replyJob.id,'메일 보내지 마세요. 수신 거부합니다.')
 assert.equal((await execution(f.j.id)).crm.threads[0].stage,'연락 중단')
 assert.equal((await db.query('select recipient from private.sales_contact_suppressions')).rows[0].recipient,'human@example.com')
 assert.match((await db.query('select private.sales_dispatch_blocker(p) r from sales_execution_packages p where id=$1',[f.p.id])).rows[0].r,/발송 차단/)
 assert.equal((await db.query('select count(*) n from brand_contacts where opt_out')).rows[0].n,0)
})
test('quoted opt-outs do not become new stop requests; truncated evidence remains limited',async()=>{
 const f=await replyFixture();await finishReply(f.replyJob.id,'Thank you.\nOn yesterday, Sales wrote:\nUnsubscribe',true)
 const row=(await db.query('select * from private.sales_crm_replies')).rows[0];assert.equal(row.signal,'limited');assert.equal((await db.query('select count(*) n from private.sales_contact_suppressions')).rows[0].n,0)
 assert.match((await execution(f.j.id)).crm.threads[0].next_action,/일부만 확보/)
})
test('index or mailbox changes discard in-flight reply results and expired leases cannot write',async()=>{
 const f=await replyFixture();await db.exec("update mail_index set labels=array['TRASH'] where id='bb22'");await finishReply(f.replyJob.id,'수신 거부')
 assert.equal((await db.query('select count(*) n from private.sales_crm_replies')).rows[0].n,0)
 assert.equal((await db.query('select state from private.sales_reply_jobs where id=$1',[f.replyJob.id])).rows[0].state,'expired')
})
test('forged inbound directions and result fields fail atomically without CRM or suppression writes',async()=>{
 const f=await replyFixture()
 for(const message of [{id:'bb22',status:'retrieved',text:'unsubscribe',truncated:false,direction:'outbound'},{id:'bad1',status:'retrieved',text:'unsubscribe',truncated:false,direction:'inbound'}]){
 await assert.rejects(asUser(admin,()=>call('sales_reply_finish',[f.replyJob.id,JSON.stringify({status:'complete',messages:[message]})]),'service_role'),/Inbound reply required|Invalid reply evidence/)
 }
 assert.equal((await db.query('select count(*) n from private.sales_crm_replies')).rows[0].n,0)
})

test('reply failures retry with spacing and daily caps, while expired workers cannot persist results',async()=>{
 const f=await replyFixture();await asUser(admin,()=>call('sales_reply_finish',[f.replyJob.id,JSON.stringify({status:'account_unavailable',messages:[]})]),'service_role')
 await db.exec('select private.sales_reply_tick()');assert.equal((await db.query('select count(*) n from private.sales_reply_jobs')).rows[0].n,1)
 for(let i=0;i<2;i++){
 await db.exec("update private.sales_reply_jobs set created_at=created_at-interval '16 minutes';select private.sales_reply_tick()")
 const j=(await db.query("select * from private.sales_reply_jobs where state='queued'")).rows[0];assert.ok(j)
 await asUser(admin,()=>call('sales_reply_claim',[j.id,j.token]),'service_role')
 await db.query("update private.sales_reply_jobs set created_at=now()-interval '4 minutes' where id=$1",[j.id])
 await assert.rejects(finishReply(j.id,'reply'),/Reply lease expired/)
 await db.exec('select private.sales_reply_tick()')
 }
 await db.exec("update private.sales_reply_jobs set created_at=created_at-interval '16 minutes';select private.sales_reply_tick()")
 assert.equal((await db.query('select count(*) n from private.sales_reply_jobs')).rows[0].n,3)
 assert.equal((await db.query('select count(*) n from private.sales_crm_replies')).rows[0].n,0)
})
test('contact stop cancels other queued plans for the same address and reports exact CRM counts',async()=>{
 const f=await replyFixture(),other=await prepared('담당자'),p=await execution(other.id);await decision(p)
 const queued=(await db.query("select * from private.sales_dispatch_jobs where strategy_id=$1",[other.id])).rows[0];assert.equal(queued.state,'queued')
 await finishReply(f.replyJob.id,'Please do not contact me again.')
 assert.equal((await db.query('select state from private.sales_dispatch_jobs where id=$1',[queued.id])).rows[0].state,'cancelled')
 assert.equal(await dispatchClaim(queued.id),null)
 const report=(await db.query('select private.sales_execution_summary() r')).rows[0].r
 assert.equal(report.crm.accepted,1);assert.equal(report.crm.replied,1);assert.equal(report.crm.stopped,1);assert.equal(report.sent,null)
})
test('reply index scan ignores different addresses, old messages, drafts and unrelated threads',async()=>{
 const f=await replyFixture()
 await db.exec("insert into mail_index(id,thread_id,from_addr,to_addr,sent_at,labels) values('ab01','ee55','nothuman@example.com','sender@example.com',now(),'{}'),('ab02','ee55','human@example.com','else@example.com',now(),'{}'),('ab03','ee55','human@example.com','sender@example.com',now()-interval '1 hour','{}'),('ab04','ff66','human@example.com','sender@example.com',now(),'{}'),('ab05','ee55','human@example.com','sender@example.com',now(),array['DRAFT'])")
 const input=(await db.query('select private.sales_reply_input($1) r',[f.job.id])).rows[0].r
 assert.deepEqual(input.messages.map(m=>m.id),['bb22'])
})
