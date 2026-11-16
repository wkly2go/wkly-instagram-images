import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await readFile(new URL('../supabase/migrations/20261116120000_sales_ops_pulse.sql',import.meta.url),'utf8')
const names=['sales_receive','sales_desk_watchdog','sales_g2b_watchdog','sales_dispatch_tick','sales_dispatch_watchdog','sales_execution_schedule','sales_strategy_receive','sales_contact_evidence_tick','sales_followup_research_tick','sales_reply_tick','sales_brand_site_tick','sales_contact_discovery_tick','sales_news_brands_tick','sales_ai_budget_roll','sales_news_queue','sales_collect','sales_brief','sales_strategy_brief','sales_strategy_schedule','sales_method_review_tick']
const base=`create role anon;create role authenticated;create schema private;create schema cron;create schema auth;
 create function auth.uid() returns uuid language sql as $$select current_setting('t.uid',true)::uuid$$;
 create table cron.job(jobname text primary key,schedule text,command text);
 create function cron.schedule(n text,s text,c text) returns bigint language sql as $$insert into cron.job values(n,s,c) on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command;select 1::bigint$$;
 create function cron.unschedule(n text) returns boolean language sql as $$delete from cron.job where jobname=n;select true$$;
 create table public.profiles(id uuid primary key,active boolean,role text);
 create function public.is_admin() returns boolean language sql as $$select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin')$$;
 create table public.notifications(id serial primary key,user_id uuid,kind text,title text,body text,link text,created_at timestamptz default now());
 create table calls(name text,at timestamptz default now());
 create table broken(name text primary key);
 ${names.map(n=>`create function private.${n}() returns void language plpgsql as $$begin if exists(select 1 from public.broken where name='${n}') then raise exception '${n} 실패'; end if; insert into public.calls(name) values('${n}'); end $$;`).join('\n')}
 insert into cron.job values('wkly_sales_receive','* * * * *','x'),('wkly_sales_dispatch','* * * * *','x'),('wkly_sales_brief','0 0 * * *','x'),('wkly_sales_news','10 */3 * * *','x'),('other_job','* * * * *','x');
 insert into public.profiles values('00000000-0000-0000-0000-000000000001',true,'admin'),('00000000-0000-0000-0000-000000000002',true,'member');`
async function setup(){const db=new PGlite();await db.exec(base);await db.exec(sql);await db.exec(sql);return db}

test('one pulse job replaces the separate sales jobs and leaves others alone',async()=>{
 const db=await setup()
 const jobs=(await db.query('select jobname from cron.job order by 1')).rows.map(r=>r.jobname)
 assert.ok(jobs.includes('wkly_sales_pulse'));assert.ok(jobs.includes('other_job'))
 assert.ok(!jobs.includes('wkly_sales_receive'));assert.ok(!jobs.includes('wkly_sales_dispatch'));assert.ok(!jobs.includes('wkly_sales_brief'))
})

test('slots follow every-N-minute and fixed schedules',async()=>{
 const db=await setup()
 const slot=async(step,at)=>(await db.query(`select private.sales_ops_slot(s,$1::timestamptz) t from private.sales_ops_steps s where step=$2`,[at,step])).rows[0].t.toISOString()
 assert.equal(await slot('brand_site','2026-11-16T03:47:30Z'),'2026-11-16T03:40:00.000Z')
 assert.equal(await slot('strategy_prepare','2026-11-16T03:40:00Z'),'2026-11-15T23:45:00.000Z')
 assert.equal(await slot('strategy_prepare','2026-11-16T03:46:00Z'),'2026-11-16T03:45:00.000Z')
 assert.equal(await slot('method_review','2026-11-17T01:00:00Z'),'2026-11-15T23:30:00.000Z')
})

test('a failing step does not stop the others, retries, and alerts admins after 3 failures',async()=>{
 const db=await setup()
 await db.exec("insert into broken values('sales_receive')")
 assert.ok((await db.query('select private.sales_ops_pulse() n')).rows[0].n>=4)
 const called=(await db.query('select distinct name from calls')).rows.map(r=>r.name)
 assert.ok(called.includes('sales_dispatch_tick'));assert.ok(!called.includes('sales_receive'))
 const r=(await db.query("select consecutive_fails,last_error from private.sales_ops_steps where step='receive'")).rows[0]
 assert.equal(r.consecutive_fails,1);assert.match(r.last_error,/sales_receive 실패/)
 // same minute: nothing runs twice
 const before=(await db.query('select count(*)::int n from calls')).rows[0].n
 await db.exec('select private.sales_ops_pulse()')
 assert.equal((await db.query('select count(*)::int n from calls')).rows[0].n,before)
 await db.exec("update private.sales_ops_steps set consecutive_fails=3 where step='receive'")
 await db.exec('select private.sales_ops_check()');await db.exec('select private.sales_ops_check()')
 const notes=(await db.query('select user_id,title from public.notifications')).rows
 assert.equal(notes.length,1);assert.equal(notes[0].user_id,'00000000-0000-0000-0000-000000000001');assert.match(notes[0].title,/AI 작업 결과 받기/)
 assert.doesNotMatch(notes[0].title,/원|\d/)
})

test('missed fixed-time run is caught up within its grace period, at most 3 tries',async()=>{
 const db=await setup()
 await db.exec("insert into broken values('sales_news_queue')")
 await db.exec("update private.sales_ops_steps set at_hours=array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],at_minutes=array[extract(minute from now() at time zone 'UTC')::int],grace_min=50 where step='news'")
 for(let i=0;i<5;i++){await db.exec('select private.sales_ops_pulse()');await db.exec("update private.sales_ops_steps set last_attempt=last_attempt-interval '5 minutes' where step='news'")}
 const s=(await db.query("select slot_attempts,consecutive_fails from private.sales_ops_steps where step='news'")).rows[0]
 assert.equal(s.slot_attempts,3);assert.equal(s.consecutive_fails,3)
 await db.exec("delete from broken");await db.exec("update private.sales_ops_steps set slot_attempts=1 where step='news'")
 await db.exec('select private.sales_ops_pulse()')
 assert.equal((await db.query("select count(*)::int n from calls where name='sales_news_queue'")).rows[0].n,1)
 assert.equal((await db.query("select consecutive_fails from private.sales_ops_steps where step='news'")).rows[0].consecutive_fails,0)
})

test('status is admin only and counts only full healthy days in a row',async()=>{
 const db=await setup()
 await db.exec("update private.sales_ops_meta set started_at=now()-interval '10 days'")
 const today=(await db.query("select (now() at time zone 'Asia/Seoul')::date d")).rows[0].d
 await db.exec(`insert into private.sales_ops_days(day,healthy,final,detail) values
  ($1::date-1,true,true,'{"partial":false}'),($1::date-2,true,true,'{"partial":false}'),($1::date-3,false,true,'{"partial":false}'),($1::date-4,true,true,'{"partial":false}')`.replace(/\$1/g,`'${today.toISOString().slice(0,10)}'`))
 await assert.rejects(db.query('select public.sales_ops_status()'),/관리자만/)
 await db.exec("set t.uid='00000000-0000-0000-0000-000000000001'")
 const st=(await db.query('select public.sales_ops_status() s')).rows[0].s
 assert.equal(st.streak,2);assert.ok(st.days.length>=4);assert.ok(Array.isArray(st.steps))
 await db.exec(`update private.sales_ops_days set detail='{"partial":true}' where day='${today.toISOString().slice(0,10)}'::date-1`)
 assert.equal((await db.query('select public.sales_ops_status() s')).rows[0].s.streak,0)
})

test('day judgement flags a fixed-time step that never succeeded',async()=>{
 const db=await setup()
 await db.exec("update private.sales_ops_meta set started_at=now()-interval '3 days'")
 const day=(await db.query("select ((now() at time zone 'Asia/Seoul')::date-1) d")).rows[0].d.toISOString().slice(0,10)
 const r=(await db.query(`select private.sales_ops_judge('${day}') r`)).rows[0].r
 assert.equal(r.healthy,false);assert.equal(r.partial,false)
 assert.ok(r.problems.some(p=>p.step==='brief'&&p.expected===1&&p.ok===0))
 assert.ok(r.problems.some(p=>p.step==='strategy_prepare'&&p.expected===6))
})
