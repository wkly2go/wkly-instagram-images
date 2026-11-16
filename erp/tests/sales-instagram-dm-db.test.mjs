import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile(new URL('../supabase/migrations/20261116120100_sales_instagram_dm.sql',import.meta.url),'utf8')
const S='11111111-1111-4111-8111-111111111111',P='22222222-2222-4222-8222-222222222222',A='00000000-0000-0000-0000-000000000001'
const base=`create role anon;create role authenticated;create role service_role;create schema private;create schema vault;create schema auth;
 create function auth.uid() returns uuid language sql as $$select current_setting('t.uid',true)::uuid$$;
 create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text);
 create view vault.decrypted_secrets as select id,name,secret decrypted_secret from vault.secrets;
 create function vault.create_secret(v text,n text,d text) returns uuid language sql as $$insert into vault.secrets(name,secret) values(n,v) returning id$$;
 create function vault.update_secret(i uuid,v text) returns void language sql as $$update vault.secrets set secret=v where id=i$$;
 create table public.profiles(id uuid primary key,active boolean,role text,is_agent boolean default false);
 create function public.is_admin() returns boolean language sql as $$select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin')$$;
 create table public.sales_prospects(id uuid primary key default gen_random_uuid(),source text,source_key text,name text,entity_kind text,contact text default '',evidence text default '',event_data jsonb default '{}',source_updated_at timestamptz,blocked boolean default false,next_action text default '',unique(source,source_key));
 create table base_material(id uuid primary key,m jsonb);
 create function private.sales_execution_material(p_id uuid) returns jsonb language sql stable as $$select m from public.base_material where id=p_id$$;
 create table public.sales_execution_packages(id uuid primary key,strategy_id uuid,payload jsonb,status text);
 create function private.sales_dispatch_blocker_before_readiness(p public.sales_execution_packages) returns text language plpgsql stable set search_path='' as $f$
declare msg jsonb; recipient text;
begin
 for msg in select value from jsonb_array_elements(p.payload->'messages') loop
  recipient:=lower(btrim(msg->>'recipient'));
  if recipient is null or recipient !~ '^[a-z]+@[a-z.]+$' then return '수신 주소 형식·중복 확인 필요';end if;
  if msg->>'channel' is distinct from 'email' or length(btrim(coalesce(msg->>'subject',''))) not between 1 and 200 then return '연락 문안·채널 검증 필요';end if;
 end loop;
 return null;
end $f$;
 create table private.sales_dispatch_jobs(id uuid primary key default gen_random_uuid(),state text,reason text,recipient text,message jsonb,scheduled_at timestamptz default now()-interval '1 minute',finished_at timestamptz);
 create table private.sales_dispatch_events(job_id uuid,state text,note text);
 create function public.sales_dispatch_claim(p_id uuid) returns jsonb language sql as $$update private.sales_dispatch_jobs set state='claimed' where id=p_id and state='queued' returning jsonb_build_object('id',id)$$;
 insert into public.profiles values('${A}',true,'admin'),('00000000-0000-0000-0000-000000000002',true,'member');`
async function setup(){const db=new PGlite();await db.exec(base);await db.exec(sql);await db.exec(sql);return db}
const ev=(mid,who,text,ms=Date.now())=>({mid,ig_user:who,text,timestamp:ms,username:'popup_brand'})

test('received DMs are stored once and the sender becomes a sales lead; opt-out blocks',async()=>{
 const db=await setup()
 const n=(await db.query('select public.sales_dm_receive($1) n',[JSON.stringify([ev('m1','1784000000000001','성수 팝업 공간 대관 문의'),ev('m1','1784000000000001','dup'),ev('x','bad','x')])])).rows[0].n
 assert.equal(n,1)
 const p=(await db.query("select name,contact,blocked,next_action from public.sales_prospects where source='Instagram DM'")).rows[0]
 assert.deepEqual(p,{name:'@popup_brand',contact:'ig:1784000000000001',blocked:false,next_action:'받은 DM 24시간 안에 답장 기획'})
 assert.ok((await db.query("select private.sales_dm_window('1784000000000001') w")).rows[0].w>new Date())
 await db.exec(`select public.sales_dm_receive('${JSON.stringify([ev('m2','1784000000000001','수신거부 합니다')])}')`)
 assert.equal((await db.query("select private.sales_dm_window('1784000000000001') w")).rows[0].w,null)
 assert.equal((await db.query("select blocked from public.sales_prospects where source='Instagram DM'")).rows[0].blocked,true)
})

test('an approved package gets one DM only inside the 24-hour reply window, and expiry is capped',async()=>{
 const db=await setup()
 await db.exec(`select public.sales_dm_receive('${JSON.stringify([ev('m1','1784000000000001','팝업 문의',Date.now()-20*3600e3)])}')`)
 const pid=(await db.query("select id from public.sales_prospects where source='Instagram DM'")).rows[0].id
 const m={payload:{plan:{first_message:'문의 감사합니다. 일정 정리해 드릴게요.'},targets:[{source_id:pid,company:'팝업 브랜드'}],messages:[],schedule:{at:new Date().toISOString(),expires_at:new Date(Date.now()+10*3600e3).toISOString()}},blockers:[],fingerprint:'x'}
 await db.query('insert into base_material values($1,$2)',[S,JSON.stringify(m)])
 const out=(await db.query('select private.sales_execution_material($1) m',[S])).rows[0].m
 assert.equal(out.payload.messages.length,1)
 assert.deepEqual({c:out.payload.messages[0].channel,r:out.payload.messages[0].recipient,b:out.payload.messages[0].body},{c:'instagram',r:'ig:1784000000000001',b:'문의 감사합니다. 일정 정리해 드릴게요.'})
 assert.equal(out.payload.recipient_verification['ig:1784000000000001'].status,'verified')
 assert.ok(new Date(out.payload.schedule.expires_at)<new Date(Date.now()+4.1*3600e3))
 assert.notEqual(out.fingerprint,'x')
 // window closed → nothing added
 await db.exec("update private.sales_dm_inbound set received_at=now()-interval '25 hours'")
 assert.equal((await db.query('select private.sales_execution_material($1) m',[S])).rows[0].m.payload.messages.length,0)
})

test('dispatch check accepts ig: recipients on the instagram channel only, email rules unchanged',async()=>{
 const db=await setup()
 const chk=async msgs=>(await db.query('select private.sales_dispatch_blocker_before_readiness(row($1::uuid,$1::uuid,$2::jsonb,$3)::public.sales_execution_packages) b',[P,JSON.stringify({messages:msgs}),'승인'])).rows[0].b
 assert.equal(await chk([{channel:'instagram',recipient:'ig:1784000000000001',body:'안녕하세요'}]),null)
 assert.equal(await chk([{channel:'instagram',recipient:'ig:1784000000000001',body:'가'.repeat(1001)}]),'연락 문안·채널 검증 필요')
 assert.equal(await chk([{channel:'email',recipient:'ig:1784000000000001',subject:'s',body:'b'}]),'수신 주소 형식·중복 확인 필요')
 assert.equal(await chk([{channel:'email',recipient:'a@b.com',subject:'s',body:'b'}]),null)
})

test('claim re-checks the window right before sending',async()=>{
 const db=await setup()
 await db.exec(`select public.sales_dm_receive('${JSON.stringify([ev('m1','1784000000000001','문의',Date.now()-25*3600e3)])}')`)
 const id=(await db.query(`insert into private.sales_dispatch_jobs(state,recipient,message) values('queued','ig:1784000000000001','{"channel":"instagram"}') returning id`)).rows[0].id
 assert.equal((await db.query('select public.sales_dispatch_claim($1) c',[id])).rows[0].c,null)
 assert.match((await db.query('select state,reason from private.sales_dispatch_jobs where id=$1',[id])).rows[0].reason,/24시간/)
 await db.exec(`select public.sales_dm_receive('${JSON.stringify([ev('m9','1784000000000001','다시 문의')])}')`)
 const id2=(await db.query(`insert into private.sales_dispatch_jobs(state,recipient,message) values('queued','ig:1784000000000001','{"channel":"instagram"}') returning id`)).rows[0].id
 assert.ok((await db.query('select public.sales_dispatch_claim($1) c',[id2])).rows[0].c)
})

test('only admins store connection secrets; status never reveals them',async()=>{
 const db=await setup()
 await db.exec("set t.uid='00000000-0000-0000-0000-000000000002'")
 await assert.rejects(db.query("select public.instagram_secret_set('INSTAGRAM_ACCESS_TOKEN','abc')"),/관리자만/)
 await db.exec(`set t.uid='${A}'`)
 await assert.rejects(db.query("select public.instagram_secret_set('GOOGLE_CLIENT_SECRET','abc')"),/not allowed/)
 await db.exec("select public.instagram_secret_set('INSTAGRAM_ACCESS_TOKEN','abc123')")
 const st=(await db.query('select public.sales_instagram_status() s')).rows[0].s
 assert.equal(st.token,true);assert.equal(st.app_secret,false);assert.match(st.verify_token,/^[0-9a-f]{32}$/)
 assert.ok(!JSON.stringify(st).includes('abc123'))
 assert.equal((await db.query("select public.instagram_secret_get('INSTAGRAM_ACCESS_TOKEN') v")).rows[0].v,'abc123')
})
