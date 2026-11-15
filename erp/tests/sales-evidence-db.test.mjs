import {before,after,test} from 'node:test'
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
 await db.exec(await sql('0131_sales_evidence_history.sql'))
})
after(()=>db.close())
async function asUser(id,fn,role='authenticated'){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`);try{return await fn()}finally{await db.exec('reset role')}}
async function prospect(source='거래처'){return(await db.query('select * from sales_prospects where source=$1 limit 1',[source])).rows[0]}
test('baseline preserves company/person links without counting them as new discovery',async()=>{
 const rows=(await db.query('select * from sales_source_history')).rows
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.origin==='baseline'&&r.version===1))
 const c=rows.find(r=>r.snapshot.entity_kind==='회사'),h=rows.find(r=>r.snapshot.entity_kind==='사람')
 assert.equal(c.snapshot.client_id,h.snapshot.client_id);assert.equal(h.snapshot.contact_id,person)
 const r=(await asUser(member,()=>db.query('select sales_automation_readiness() r'))).rows[0].r
 assert.equal(r.baseline,2);assert.equal(r.new_today,0);assert.equal(r.sending_enabled,false)
})
test('repeat collection deduplicates while A to B to A retains three versions',async()=>{
 const p=await prospect();await db.query('select private.sales_collect_internal()')
 assert.equal((await db.query('select count(*) n from sales_source_history where prospect_id=$1',[p.id])).rows[0].n,1)
 await db.query("update clients set memo='새 전시' where id=$1",[client]);await db.query('select private.sales_collect_internal()')
 await db.query("update clients set memo='팝업 전시 기획' where id=$1",[client]);await db.query('select private.sales_collect_internal()')
 const v=(await asUser(member,()=>db.query('select sales_source_versions($1) r',[p.id]))).rows[0].r
 assert.deepEqual(v.map(x=>x.version),[3,2,1]);assert.deepEqual(v[0].snapshot,v[2].snapshot)
 assert.notEqual(v[0].snapshot.evidence,v[1].snapshot.evidence)
 assert.equal((await asUser(member,()=>db.query('select sales_source_versions($1,2) r',[p.id]))).rows[0].r.length,1)
})
test('human review does not fabricate a new source observation',async()=>{
 const p=await prospect(),n=(await db.query('select count(*) n from sales_source_history')).rows[0].n
 await asUser(admin,()=>db.query("select sales_prospect_review($1,$2,'회사','보류','다음 분기 검토')",[p.id,p.revision]))
 assert.equal((await db.query('select count(*) n from sales_source_history')).rows[0].n,n)
 assert.equal((await prospect()).review_note,'다음 분기 검토')
})
test('new discovery counted once; exclusion changes remain in evidence history',async()=>{
 const key=randomUUID(),data={name:'새 기업',entity_kind:'회사',contact:'stop@example.com',evidence:'행사 참가',source_url:'https://example.com/event'}
 await db.query('select private.sales_index($1,$2,$3)',['공식 참가사',key,JSON.stringify(data)])
 await db.query('select private.sales_index($1,$2,$3)',['공식 참가사',key,JSON.stringify({...data,blocked:true})])
 const r=(await asUser(member,()=>db.query('select sales_automation_readiness() r'))).rows[0].r
 assert.equal(r.new_today,1);assert.equal(r.counts.blocked,1);assert.equal(r.sending_enabled,false)
 const h=(await db.query("select snapshot->>'blocked' b from sales_source_history where snapshot->>'source_key'=$1 order by version",[key])).rows
 assert.deepEqual(h.map(x=>x.b),['false','true'])
})
test('clients may read but cannot mutate history; anonymous and inactive access denied',async()=>{
 const p=await prospect()
 await assert.rejects(asUser(null,()=>db.query('select sales_source_versions($1)',[p.id]),'anon'),e=>e.code==='42501')
 await assert.rejects(asUser(null,()=>db.query('select sales_automation_readiness()')),e=>e.code==='42501')
 await assert.rejects(asUser(admin,()=>db.query("update sales_source_history set snapshot='{}'")),e=>e.code==='42501')
 await assert.rejects(asUser(member,()=>db.query('delete from sales_source_history')),e=>e.code==='42501')
 assert.ok((await asUser(member,()=>db.query('select * from sales_source_history'))).rows.length>0)
})
