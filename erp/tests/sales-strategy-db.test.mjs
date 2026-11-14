import {before,beforeEach,afterEach,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),admin=randomUUID(),member=randomUUID(),sourceId=randomUUID()
const sql=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema private;create schema net;create schema cron;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,active boolean,is_agent boolean default false);
 insert into profiles values('${admin}','admin',true,false),('${member}','member',true,false);
 create function is_active_member() returns boolean language sql security definer stable as $$select exists(select 1 from public.profiles where id=auth.uid() and active)$$;
 create function is_admin() returns boolean language sql security definer stable as $$select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin')$$;
 create table sales_prospects(id uuid primary key,name text,source text,source_key text,evidence text,source_url text,source_updated_at timestamptz,score int,blocked boolean,reviewed_assessment text,assessment text,end_date date,contact text);
 create table brand_contacts(id uuid,email text,opt_out boolean);create table growth_items(id uuid,status text,document jsonb);
 create function private.sales_prospect_signature(p sales_prospects) returns text language sql stable as $$select md5(p.name||p.evidence)$$;
 create function private.sales_prospect_blocked(p sales_prospects) returns boolean language sql stable as $$select p.blocked or exists(select 1 from public.brand_contacts b where b.opt_out and b.email<>'' and strpos(p.contact,b.email)>0)$$;
 create table sales_collection_runs(source text,status text,source_at timestamptz,note text,started_at timestamptz);
 create table notices(user_id uuid,title text);create function notify(u uuid,k text,t text,b text,l text) returns void language sql as $$insert into public.notices values(u,t)$$;
 create table cron.job(jobname text primary key,schedule text,command text);create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.job values(n,s,c);return 1;end$$;
 create table net.requests(id bigserial primary key,url text,body jsonb);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.requests(url,body) values(url,body) returning id$$;
 grant usage on schema public,auth to authenticated,anon,service_role;`)
 await db.exec(await sql('0115_growth_ai_budget.sql'));await db.exec(await sql('0122_sales_strategy.sql'))
 await db.query("insert into sales_prospects values($1,'상권 제휴 자료','리서치','source','공동 판촉 협업','https://example.test',now(),70,false,null,'확인 필요',null,'business@example.test')",[sourceId])
 await db.exec("insert into growth_ai_models values('standard','작성','claude-test',3,15,true);insert into growth_ai_budgets(id,starts_at,ends_at,limit_usd,enabled) values(gen_random_uuid(),now()-interval '1 day',now()+interval '1 day',1,true)")
})
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));after(()=>db.close())
async function asUser(id,fn,role='authenticated'){
 await db.exec('savepoint actor');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`)
 try{return await fn()}catch(e){await db.exec('rollback to actor');throw e}finally{await db.exec('reset role;release actor')}
}
const call=(name,args=[])=>db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)
const request=async()=>{const id=randomUUID();await asUser(admin,()=>call('sales_strategy_request',[id,'새로운 방법']));return id}
const claim=async id=>{const j=(await db.query('select token from private.sales_strategy_jobs where id=$1 union all select token from private.sales_strategy_preparations where id=$1',[id])).rows[0];return(await asUser(admin,()=>call('sales_strategy_claim',[id,j.token]),'service_role')).rows[0].r}
const plan={title:'상권 공동 체험 상품',category:'상권 연합 영업',customer:'상인회·브랜드',opportunity:'공동 판촉 가설',offer:'체험 동선 기획',why_now:'기존 협업 단서',approach:'제휴 담당부서 확인',effect:'방문 참여 증가 가설',resources:'운영비·인력 확인',stop_rule:'비용 부담 주체 미확정시 보류',first_message:'협업 검토 담당부서를 확인하고 싶습니다.',evidence_ids:[sourceId],questions:['참여 가능한 매장은?'],metrics:['의향 확인 건수'],steps:[{action:'원문 조사',output:'공식 출처 목록',day:1},{action:'제안 준비',output:'1쪽 제안',day:2},{action:'접촉 준비',output:'수신자·문안 확인',day:3}]}
async function ready(){const id=await request();await claim(id);await asUser(admin,()=>call('sales_strategy_finish',[id,JSON.stringify(plan),'']),'service_role');return id}
test('queue is idempotent and requires admin; workers require one-time server authentication',async()=>{
 await assert.rejects(asUser(member,()=>call('sales_strategy_request',[randomUUID(),''])),e=>e.code==='42501');await assert.rejects(asUser(null,()=>call('sales_strategies',[0]),'anon'),e=>e.code==='42501')
 const id=await request();await asUser(admin,()=>call('sales_strategy_request',[id,'새로운 방법']));assert.equal((await db.query('select count(*) n from net.requests')).rows[0].n,1)
 await assert.rejects(asUser(member,()=>call('sales_strategy_claim',[id,randomUUID()])),e=>e.code==='42501')
 assert.equal((await asUser(admin,()=>call('sales_strategy_claim',[id,randomUUID()]),'service_role')).rows[0].r,null)
 const job=await claim(id);assert.equal(job.sources[0].id,sourceId);assert.equal(await claim(id),null)
})
test('model failure is explicit and opt-out evidence never enters planning context',async()=>{
 await db.query('insert into brand_contacts values($1,$2,true)',[randomUUID(),'business@example.test'])
 const id=await request(),job=await claim(id);assert.equal(job.sources.length,0)
 await asUser(admin,()=>call('sales_strategy_finish',[id,null,'AI 연결 확인 필요']),'service_role')
 const row=(await asUser(member,()=>call('sales_strategies',[0]))).rows[0].r.items[0];assert.equal(row.status,'생성 실패');assert.match(row.error,/AI 연결/)
 await db.exec('update growth_ai_models set enabled=false');const blocked=await request();assert.equal((await db.query('select status from sales_strategies where id=$1',[blocked])).rows[0].status,'생성 실패')
})
test('new categories stay open but hallucinated sources and invalid plans cannot become approval requests',async()=>{
 const id=await request();await claim(id)
 for(const bad of [{...plan,evidence_ids:[randomUUID()]},{...plan,steps:[]},{...plan,questions:[]},{...plan,send:true}])await assert.rejects(asUser(admin,()=>call('sales_strategy_finish',[id,JSON.stringify(bad),'']),'service_role'))
 await asUser(admin,()=>call('sales_strategy_finish',[id,JSON.stringify(plan),'']),'service_role');assert.equal((await db.query('select status from sales_strategies where id=$1',[id])).rows[0].status,'승인 대기');assert.equal((await db.query('select count(*) n from sales_strategy_tasks')).rows[0].n,0)
})
test('approval creates internal tasks exactly once, preserves proposal and never verifies source demand',async()=>{
 const id=await ready();await assert.rejects(asUser(member,()=>call('sales_strategy_decide',[id,2,'승인',''])),e=>e.code==='42501')
 await assert.rejects(asUser(admin,()=>call('sales_strategy_decide',[id,1,'승인',''])),e=>e.code==='PT409')
 for(let i=0;i<2;i++)await asUser(admin,()=>call('sales_strategy_decide',[id,2,'승인','']))
 const tasks=(await asUser(member,()=>db.query('select * from sales_strategy_tasks order by ordinal'))).rows;assert.equal(tasks.length,3);assert.ok(tasks.every(t=>t.status==='대기'&&t.owner_id===admin&&t.result===''))
 assert.equal((await db.query('select assessment from sales_prospects where id=$1',[sourceId])).rows[0].assessment,'확인 필요')
 await assert.rejects(asUser(admin,()=>call('sales_strategy_task_update',[tasks[0].id,1,'완료',''])),/결과/)
 await asUser(admin,()=>call('sales_strategy_task_update',[tasks[0].id,1,'완료','공식 원문과 담당 창구 확인 결과 기록']))
 await assert.rejects(asUser(admin,()=>call('sales_strategy_task_update',[tasks[0].id,1,'진행','다른 내용'])),e=>e.code==='PT409')
})
test('source changes or opt-outs invalidate approval and revision requests never create tasks',async()=>{
 const id=await ready();await db.exec("update sales_prospects set evidence='협업 취소'")
 await assert.rejects(asUser(admin,()=>call('sales_strategy_decide',[id,2,'승인',''])),e=>e.code==='PT409')
 await asUser(admin,()=>call('sales_strategy_decide',[id,2,'수정 요청','최근 자료로 다시 검토']))
 assert.equal((await db.query('select count(*) n from sales_strategy_tasks')).rows[0].n,0)
 assert.equal((await db.query("select count(*) n from sales_strategies where status='기획 중'")).rows[0].n,1)
})
test('approval queues AI preparation once and draft results never claim external execution was completed',async()=>{
 const id=await ready();await asUser(admin,()=>call('sales_strategy_decide',[id,2,'승인','']))
 const prep=(await db.query('select id from private.sales_strategy_preparations where strategy_id=$1',[id])).rows[0]
 const job=await claim(prep.id);assert.equal(job.phase,'prepare');assert.equal(job.plan.title,plan.title);assert.equal(await claim(prep.id),null)
 await assert.rejects(asUser(member,()=>call('sales_strategy_prepared',[prep.id,{},''])),e=>e.code==='42501')
 const pack={research:'저장 자료 검토 초안',proposal:'1쪽 고객 제안 초안',contact_draft:'첫 연락 초안',checks:['수신자와 과업 확인']}
 await asUser(admin,()=>call('sales_strategy_prepared',[prep.id,JSON.stringify(pack),'']),'service_role')
 const saved=(await db.query('select * from sales_strategies where id=$1',[id])).rows[0];assert.equal(saved.preparation_status,'완료');assert.equal(saved.preparation.proposal,pack.proposal)
 const tasks=(await db.query('select * from sales_strategy_tasks where strategy_id=$1',[id])).rows;assert.ok(tasks.every(t=>t.status==='진행'&&t.result.includes('외부 접촉 미실행')))
 await asUser(admin,()=>call('sales_strategy_prepared',[prep.id,null,'중복 응답']),'service_role');assert.equal((await db.query('select preparation_status from sales_strategies where id=$1',[id])).rows[0].preparation_status,'완료')
})
test('scheduled planning has three daily slots, obeys its toggle and marks stalled jobs without repeating API calls',async()=>{
 await db.query('select private.sales_strategy_schedule()');const id=(await db.query('select id from sales_strategies')).rows[0].id
 await db.exec("update private.sales_strategy_jobs set started_at=now()-interval '6 minutes'");await db.query('select private.sales_strategy_receive()');assert.equal((await db.query('select status from sales_strategies where id=$1',[id])).rows[0].status,'생성 실패')
 await asUser(admin,()=>call('sales_strategy_automatic',[false]));await db.query('select private.sales_strategy_schedule()');assert.equal((await db.query('select count(*) n from sales_strategies')).rows[0].n,1)
 assert.equal((await db.query("select schedule from cron.job where jobname='wkly_sales_strategy_prepare'")).rows[0].schedule,'45,50,55 23 * * *')
 assert.equal((await db.query('select count(*) n from net.requests')).rows[0].n,1)
})
