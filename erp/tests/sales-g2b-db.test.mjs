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
 await db.exec(await sql('20261115090102_sales_desk.sql'))
 await db.exec(await sql('20261115090103_sales_g2b_collection.sql'))
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
async function queue(){await db.exec('select private.sales_g2b_queue()');return(await db.query('select j.*,r.source from private.sales_g2b_jobs j join sales_collection_runs r on r.id=j.run_id order by r.source')).rows}
async function gclaim(j){return(await asUser(admin,()=>call('sales_g2b_claim',[j.run_id,j.token]),'service_role')).rows[0].r}
const notice=(override={})=>({number:'R26TEST001',round:'000',title:'박람회 행사 운영',agency:'시험 기관',deadline:'2099-11-20T17:00:00+09:00',amount:12000000,source_url:'https://www.g2b.go.kr/example?bid=R26TEST001',notice_date:new Date().toISOString(),warnings:[],...override})
async function page(j,rows=[notice()],pageNo=1,total=rows.length,omitted=0){await asUser(admin,()=>call('sales_g2b_page',[j.run_id,pageNo,JSON.stringify(rows),total,omitted,new Date().toISOString()]),'service_role')}
async function finish(j,status='완료'){await asUser(admin,()=>call('sales_g2b_finish',[j.run_id,status,'시험 조회 결과']),'service_role')}
async function run(j){return(await db.query('select * from sales_collection_runs where id=$1',[j.run_id])).rows[0]}
test('bounded searches use seven KST days, queue once, and require one-time service authentication',async()=>{
 const jobs=await queue();assert.equal(jobs.length,8)
 assert.equal((Date.parse(jobs[0].end_date)-Date.parse(jobs[0].start_date))/86400000,6)
 await queue();assert.equal((await db.query('select count(*) n from private.sales_g2b_jobs')).rows[0].n,8)
 const j=jobs[0]
 await assert.rejects(asUser(admin,()=>call('sales_g2b_claim',[j.run_id,j.token])),e=>e.code==='42501')
 assert.equal((await asUser(admin,()=>call('sales_g2b_claim',[j.run_id,randomUUID()]),'service_role')).rows[0].r,null)
 assert.equal((await gclaim(j)).keyword,j.keyword);assert.equal(await gclaim(j),null)
})
test('page persistence is idempotent across repeats and keywords; source changes preserve versions and exclusions',async()=>{
 const jobs=(await queue()).filter(j=>j.category==='service'),a=jobs[0],b=jobs[1],c=jobs[2]
 await gclaim(a);const row=notice();await page(a,[row]);await page(a,[row]);await finish(a)
 assert.equal((await run(a)).count,1)
 await gclaim(b);await page(b,[row]);await finish(b)
 const prospects=(await db.query("select * from sales_prospects where source='나라장터 공식 API'")).rows
 assert.equal(prospects.length,1);assert.equal(prospects[0].entity_kind,'영업 기회');assert.equal(prospects[0].organization,'시험 기관');assert.equal(prospects[0].client_id,null)
 assert.equal((await db.query('select count(*) n from sales_source_history where prospect_id=$1',[prospects[0].id])).rows[0].n,1)
 await db.query("update sales_prospects set blocked=true,reviewed_assessment='제외',review_note='제외 유지' where id=$1",[prospects[0].id])
 await gclaim(c);await page(c,[{...row,title:'정정된 행사 운영',amount:14000000}]);await finish(c)
 const p=(await db.query('select * from sales_prospects where id=$1',[prospects[0].id])).rows[0]
 assert.equal(p.blocked,true);assert.equal(p.review_note,'제외 유지');assert.equal(p.name,'정정된 행사 운영')
 assert.ok((await db.query('select count(*) n from sales_source_history where prospect_id=$1',[p.id])).rows[0].n>=2)
})
test('page gaps, changed replays and false complete statuses are rejected without inflating counts',async()=>{
 const j=(await queue())[0];await gclaim(j)
 await assert.rejects(page(j,[notice()],2,31),/수집 순서/)
 await assert.rejects(finish(j),/전체 조회/)
 const rows=Array.from({length:30},(_,i)=>notice({number:'R26TEST'+i}));await page(j,rows,1,31)
 await assert.rejects(page(j,[...rows.slice(0,29),notice({number:'other'})],1,31),/이미 저장/)
 await assert.rejects(finish(j),/전체 조회/);assert.equal((await run(j)).count,30)
 await page(j,[notice({number:'R26LAST'})],2,31);await finish(j);assert.equal((await run(j)).count,31)
 await assert.rejects(page(j,[],3,31),/만료/)
})
test('failure and successful zero results remain distinct; omitted rows cannot be called complete',async()=>{
 const jobs=await queue(),a=jobs[0],b=jobs[1],c=jobs[2]
 await gclaim(a);await page(a,[],1,0);await finish(a);assert.equal((await run(a)).status,'완료');assert.equal((await run(a)).count,0)
 await gclaim(b);await finish(b,'실패');assert.equal((await run(b)).status,'실패');assert.equal((await run(b)).source_at,null)
 await gclaim(c);await page(c,[notice()],1,2,1);await assert.rejects(finish(c),/전체 조회/);await finish(c,'일부 수집');assert.equal((await run(c)).scanned,2)
})
test('existing collection requests enqueue procurement automatically and reports read the stored candidates',async()=>{
 await submit('수집','나라장터 자료 취합');assert.equal((await db.query('select count(*) n from private.sales_g2b_jobs')).rows[0].n,8)
 const j=(await db.query('select * from private.sales_g2b_jobs limit 1')).rows[0];await gclaim(j);await page(j);await finish(j)
 await submit('조회','박람회 분석');const m=(await messages()).at(-1)
 assert.ok(m.snapshot.sources.some(s=>s.source==='나라장터 공식 API'));assert.ok(m.snapshot.coverage.some(s=>s.source.startsWith('나라장터')))
})
test('stalled jobs close with saved progress; retries stop after three attempts per route/day',async()=>{
 const jobs=await queue(),j=jobs[0];await gclaim(j);await page(j)
 await db.exec("update sales_collection_runs set started_at=now()-interval '16 minutes'")
 await db.exec('select private.sales_g2b_watchdog()');assert.equal((await run(j)).status,'일부 수집')
 await queue();assert.equal((await db.query('select count(*) n from private.sales_g2b_jobs')).rows[0].n,16)
 await db.exec("update sales_collection_runs set started_at=now()-interval '16 minutes'");await queue()
 await db.exec("update sales_collection_runs set started_at=now()-interval '16 minutes'");await queue()
 assert.equal((await db.query('select count(*) n from private.sales_g2b_jobs')).rows[0].n,24)
})
test('API saves do not invent contacts, outreach or eligibility, and expired notices leave active assessment',async()=>{
 const j=(await queue())[0];await gclaim(j);await page(j,[notice({deadline:'2020-01-01T09:00:00+09:00'})]);await finish(j)
 const p=(await db.query("select * from sales_prospects where source='나라장터 공식 API'")).rows[0]
 assert.equal(p.contact,'');assert.equal(p.contact_id,null);assert.equal(p.assessment,'보류')
 assert.equal((await db.query('select count(*) n from sales_opportunities')).rows[0].n,0)
 assert.equal((await asUser(admin,()=>call('sales_automation_readiness'))).rows[0].r.counts.content_verified,0)
})
test('expired runs and duplicates across pages cannot be marked fully collected',async()=>{
 const jobs=await queue(),a=jobs[0],b=jobs[1];await gclaim(a);await page(a)
 await db.query("update sales_collection_runs set started_at=now()-interval '16 minutes' where id=$1",[a.run_id])
 await assert.rejects(finish(a),/전체 조회/)
 await gclaim(b);const rows=Array.from({length:30},(_,i)=>notice({number:'R26DUP'+i}));await page(b,rows,1,31);await page(b,[rows[0]],2,31)
 assert.equal((await run(b)).count,30);await assert.rejects(finish(b),/전체 조회/);await finish(b,'일부 수집')
})
