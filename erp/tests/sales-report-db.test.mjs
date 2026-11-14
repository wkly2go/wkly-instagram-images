import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(), admin=randomUUID(), member=randomUUID(), client=randomUUID(), person=randomUUID()
const sql=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema private;create schema net;create schema cron;
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
 await db.query('insert into clients values($1,$2,$3,$4,$5,$6,$7,now())',[client,'테스트 브랜드','클라이언트','팝업 전시 기획','team@example.com','02-000-0000','https://example.com'])
 await db.query('insert into contacts values($1,$2,$3,$4,$5,$6,$7,now())',[person,client,'동명 담당자','마케팅 팀장','','human@example.com','팝업 문의'])
})
after(()=>db.close())
async function asUser(id,fn,role='authenticated'){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`);try{return await fn()}finally{await db.exec('reset role')}}
async function prospect(source='거래처'){return(await db.query('select * from sales_prospects where source=$1 limit 1',[source])).rows[0]}
test('company/person stay separate with real affiliation; repeat collection preserves identity and manual review',async()=>{
 await db.query('select private.sales_collect_internal()');const company=await prospect(),human=await prospect('담당자');assert.equal(company.entity_kind,'회사');assert.equal(human.entity_kind,'사람');assert.equal(human.client_id,company.client_id);assert.equal(company.assessment,'우선 검토');
 await asUser(admin,()=>db.query("select sales_prospect_review($1,$2,'회사','보류','다음 분기 협의')",[company.id,company.revision]));
 await db.query('select private.sales_collect_internal()');const again=await prospect();assert.equal(again.id,company.id);assert.equal(again.reviewed_assessment,'보류');assert.equal(again.review_note,'다음 분기 협의');assert.equal((await db.query('select count(*) n from sales_prospects')).rows[0].n,2);
 await assert.rejects(asUser(admin,()=>db.query("select sales_prospect_review($1,$2,'회사','우선 검토','갱신 충돌')",[company.id,company.revision])),e=>e.code==='40001');
})
test('permission boundaries protect report, classification, and server collection',async()=>{
 await assert.rejects(asUser(null,()=>db.query('select sales_report()'),'anon'),e=>e.code==='42501');
 await assert.rejects(asUser(member,()=>db.query('select sales_collect_now()')),e=>e.code==='42501');
 await assert.rejects(asUser(member,async()=>db.query("select sales_prospect_review($1,1,'회사','제외','검토')",[(await prospect()).id])),e=>e.code==='42501');
 await assert.rejects(asUser(admin,()=>db.query('select private.sales_collect()')),e=>e.code==='42501');
 await assert.rejects(asUser(member,()=>db.query("update sales_prospects set score=100")),e=>e.code==='42501');
})
test('opt-out overrides suitability and manual classification and prevents new pipeline',async()=>{
 const key=randomUUID();await db.query('select private.sales_index($1,$2,$3)', ['브랜드 연락처',key,JSON.stringify({name:'거절 브랜드',entity_kind:'회사',contact:'no@example.com',evidence:'팝업 행사',source_updated_at:new Date().toISOString(),source_url:'https://example.com',blocked:true})]);const p=await prospect('브랜드 연락처');assert.equal(p.assessment,'제외');
 await assert.rejects(asUser(member,()=>db.query('select sales_prospect_start($1)',[p.id])),/제외/);
 await assert.rejects(asUser(admin,()=>db.query("select sales_prospect_review($1,$2,'회사','우선 검토','우회')",[p.id,p.revision])),/수신 거부/);
})
test('starting sales is idempotent, preserves company/contact links, and starts in discovery',async()=>{
 const p=await prospect('담당자');const start=()=>asUser(member,()=>db.query('select sales_prospect_start($1) id',[p.id]));const a=(await start()).rows[0].id,b=(await start()).rows[0].id;assert.equal(a,b);
 const saved=(await db.query('select * from sales_opportunities where id=$1',[a])).rows[0];assert.equal(saved.stage,'발굴');assert.equal(saved.owner_id,member);assert.equal(saved.client_id,client);assert.equal(saved.contact_id,person);assert.equal(saved.expected_amount,null);
})
test('collection deduplicates requests, official API worker claims once, fallback is used only for COEX',async()=>{
 await db.query('select private.sales_collect()');await db.query('select private.sales_collect()');assert.equal((await db.query('select count(*) n from net.requests')).rows[0].n,2);
 const job=(await db.query('select * from private.sales_seoul_jobs')).rows[0];
 await assert.rejects(asUser(member,()=>db.query('select sales_seoul_claim($1,$2)',[job.run_id,job.token])),e=>e.code==='42501');
 assert.equal((await db.query('select sales_seoul_claim($1,$2) ok',[job.run_id,randomUUID()])).rows[0].ok,false);
 assert.equal((await db.query('select sales_seoul_claim($1,$2) ok',[job.run_id,job.token])).rows[0].ok,true);
 assert.equal((await db.query('select sales_seoul_claim($1,$2) ok',[job.run_id,job.token])).rows[0].ok,false);
 const event={id:'event-1',title:'공식 전시',organization:'공식 주최사',start:'2099-01-01',end:'2099-01-02',url:'https://example.com/event'};
 for(let i=0;i<2;i++)await db.query('select sales_seoul_page($1,$2,now())',[job.run_id,JSON.stringify([event])]);
 await db.query("select sales_seoul_finish($1,'완료',1,1000,1000,'공식 API 전체 조회',now())",[job.run_id]);
 assert.equal((await db.query("select count(*) n from sales_prospects where source='서울시 문화행사'")).rows[0].n,1);
 const coex=(await db.query('select * from private.sales_collection_requests')).rows[0];
 await db.query('insert into net._http_response values($1,502,null,null,false)',[coex.request_id]);await db.query('select private.sales_receive()');
 const retry=(await db.query('select * from private.sales_collection_requests')).rows[0];assert.equal(retry.fallback,true);
 const payload={rows:[event],fetchedAt:'2020-01-01T00:00:00Z',limited:true};
 await db.query('insert into net._http_response values($1,200,$2,null,false)',[retry.request_id,JSON.stringify(payload)]);await db.query('select private.sales_receive()');
 const run=(await db.query('select * from sales_collection_runs where id=$1',[coex.run_id])).rows[0];assert.equal(run.status,'일부 수집');assert.match(run.note,/최신 수집 아님/);assert.ok(await prospect('담당자'));
 await db.query('select private.sales_receive()');
 assert.equal((await db.query("select count(*) n from sales_prospects where source='코엑스 행사'")).rows[0].n,1);
})
test('daily briefing is exactly once, flags stale coverage, retains source evidence and scheduled KST hours',async()=>{
 await db.query('select private.sales_brief()');await db.query('select private.sales_brief()');assert.equal((await db.query('select count(*) n from sales_briefings')).rows[0].n,1);
 const b=(await db.query('select * from sales_briefings')).rows[0];assert.match(b.summary,/확인하지 못한 출처/);assert.ok(b.actions.length);assert.ok(b.direction.length);assert.equal((await db.query('select count(*) n from notices')).rows[0].n,2);
 const schedules=(await db.query('select * from cron.job')).rows;assert.equal(schedules.find(s=>s.jobname==='wkly_sales_collect').schedule,'0,20,40 23 * * *');assert.equal(schedules.find(s=>s.jobname==='wkly_sales_brief').schedule,'0 0 * * *');
 const report=(await asUser(member,()=>db.query("select sales_report('', '사람', '', 0) r"))).rows[0].r;assert.equal(report.total,1);assert.equal(report.prospects[0].entity_kind,'사람');assert.equal(report.counts.companies,2);
})
