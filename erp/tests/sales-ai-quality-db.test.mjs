import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),admin=randomUUID(),budget=randomUUID(),job=randomUUID()
const one=async(q,p=[])=>(await db.query(q,p)).rows[0]
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema private;create schema cron;
 create table profiles(id uuid primary key,role text,active boolean,is_agent boolean default false);insert into profiles values('${admin}','admin',true,false);
 create table growth_ai_models(key text primary key,label text,enabled boolean,model_id text,input_rate numeric,output_rate numeric);insert into growth_ai_models values('fast','빠른 분류',true,'haiku',0.1,0.5);
 create table growth_ai_budgets(id uuid primary key,starts_at timestamptz,ends_at timestamptz,limit_usd numeric,enabled boolean default false,spent_usd numeric default 0,reserved_usd numeric default 0);
 insert into growth_ai_budgets values('${budget}',now()-interval '3 days',now()+interval '4 days',3,true,0,0);
 create table growth_ai_usage(id uuid primary key,user_id uuid,budget_id uuid,reserved_usd numeric);
 create function growth_ai_reserve(p_id uuid,p_user uuid,p_task text,p_signature text,p_model text,p_input_tokens integer) returns jsonb language plpgsql as $$
 declare m public.growth_ai_models;amount numeric;begin select * into m from public.growth_ai_models where key=p_model;amount:=ceil(p_input_tokens*m.input_rate+1600*m.output_rate)/1000000;
  insert into public.growth_ai_usage values(p_id,p_user,'${budget}',amount);update public.growth_ai_budgets set reserved_usd=reserved_usd+amount where id='${budget}';
  return jsonb_build_object('execute',true,'input_rate',m.input_rate,'output_rate',m.output_rate);end $$;
 create table private.sales_news_brand_jobs(id uuid primary key,actor uuid,state text,created_at timestamptz default now());insert into private.sales_news_brand_jobs values('${job}','${admin}','claimed');
 create table private.sales_strategy_jobs(id uuid,claimed boolean);create table sales_strategies(id uuid,requested_by uuid,decided_by uuid,status text,preparation_before_approval boolean);create table private.sales_strategy_preparations(id uuid,strategy_id uuid,claimed boolean,done boolean);
 create table sales_desk_messages(id uuid,owner_id uuid,status text,created_at timestamptz);create table private.sales_desk_jobs(id uuid,claimed boolean);
 create table private.sales_followup_jobs(id uuid,actor uuid,state text,created_at timestamptz,input jsonb,dispatch_id uuid);create function private.sales_followup_input(uuid) returns jsonb language sql as $$select null::jsonb$$;
 create table cron.job(jobname text primary key,schedule text);create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.job values(n,s);return 1;end$$;`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090119_sales_ai_quality.sql',import.meta.url),'utf8'))
})
test('the stronger model is enabled and the current weekly limit is raised',async()=>{
 assert.deepEqual(await one("select model_id,enabled,input_rate::float i,output_rate::float o from growth_ai_models where key='standard'"),{model_id:'claude-sonnet-5-5',enabled:true,i:2,o:10})
 assert.equal(Number((await one('select limit_usd from growth_ai_budgets')).limit_usd),15)
})
test('a reservation covers the full output cap and an unaffordable one is rolled back',async()=>{
 await db.query("select public.sales_news_brands_ai_reserve($1,$2,'classify','s','fast',2000)",[job,admin])
 const expected=Math.ceil(2000*0.1+3000*0.5)/1e6
 assert.equal(Number((await one('select reserved_usd from growth_ai_usage where id=$1',[job])).reserved_usd),expected);assert.equal(Number((await one('select reserved_usd from growth_ai_budgets')).reserved_usd),expected)
 await assert.rejects(db.query("select public.sales_news_brands_ai_reserve($1,$2,'write','s','fast',2000)",[job,admin]))
 const desk=randomUUID();await db.query("insert into sales_desk_messages values($1,$2,'처리 중',now())",[desk,admin]);await db.query('insert into private.sales_desk_jobs values($1,true)',[desk])
 await db.exec('update growth_ai_budgets set limit_usd=0.05')
 await assert.rejects(db.query("select public.sales_desk_ai_reserve($1,$2,'write','s','standard',4000)",[desk,admin]),/AI 한도/)
 assert.equal((await one('select count(*)::int n from growth_ai_usage')).n,1);assert.equal(Number((await one('select reserved_usd from growth_ai_budgets')).reserved_usd),expected)
 await db.exec('update growth_ai_budgets set limit_usd=15');await db.query("select public.sales_desk_ai_reserve($1,$2,'write','s','standard',4000)",[desk,admin])
 assert.equal(Number((await one('select reserved_usd from growth_ai_usage where id=$1',[desk])).reserved_usd),(4000*2+12000*10)/1e6)
})
test('the weekly budget renews once with the same limit, and a switched-off period stays off',async()=>{
 await db.exec('select private.sales_ai_budget_roll()');assert.equal((await one('select count(*)::int n from growth_ai_budgets')).n,1)
 await db.exec("update growth_ai_budgets set starts_at=now()-interval '8 days',ends_at=now()-interval '1 day';select private.sales_ai_budget_roll();select private.sales_ai_budget_roll()")
 const rows=(await db.query('select limit_usd::float l,enabled,spent_usd::float s from growth_ai_budgets order by starts_at')).rows
 assert.deepEqual(rows,[{l:15,enabled:true,s:0},{l:15,enabled:true,s:0}])
 await db.exec("delete from growth_ai_usage;delete from growth_ai_budgets where starts_at>now()-interval '1 hour';update growth_ai_budgets set enabled=false;select private.sales_ai_budget_roll()")
 assert.equal((await one('select count(*)::int n from growth_ai_budgets')).n,1)
 assert.equal((await one("select schedule from cron.job where jobname='wkly_sales_ai_budget_roll'")).schedule,'*/15 * * * *')
})
