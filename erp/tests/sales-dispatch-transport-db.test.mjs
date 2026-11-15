import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),one=async q=>(await db.query(q)).rows[0]
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema private;create schema net;create schema cron;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','k');
 create table private.sales_dispatch_jobs(id uuid primary key default gen_random_uuid(),state text not null default 'queued',scheduled_at timestamptz not null,expires_at timestamptz not null);
 insert into private.sales_dispatch_jobs(state,scheduled_at,expires_at) values('queued',now()-interval '1 minute',now()+interval '1 hour'),('queued',now()+interval '1 hour',now()+interval '2 hours'),('queued',now()-interval '2 hours',now()-interval '1 hour'),('accepted',now()-interval '1 minute',now()+interval '1 hour');
 create table cron.job(jobname text primary key,schedule text);create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.job values(n,s);return 1;end$$;
 create table net.requests(id bigserial primary key,url text,body jsonb);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.requests(url,body) values(url,body) returning id$$;`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090121_sales_dispatch_transport.sql',import.meta.url),'utf8'))
})
test('nothing is handed to the sender while the switch is off',async()=>{
 assert.equal((await one('select public.sales_dispatch_enabled() e')).e,false)
 assert.equal((await one('select private.sales_dispatch_tick() n')).n,0);assert.equal((await one('select count(*)::int n from net.requests')).n,0)
})
test('only due, unexpired, queued jobs are handed over, once per ten minutes',async()=>{
 await db.exec('update private.sales_dispatch_switch set enabled=true')
 assert.equal((await one('select private.sales_dispatch_tick() n')).n,1);assert.equal((await one('select private.sales_dispatch_tick() n')).n,0)
 const sent=(await db.query('select url,body from net.requests')).rows
 assert.equal(sent.length,1);assert.match(sent[0].url,/\/functions\/v1\/sales-dispatch$/);assert.deepEqual(Object.keys(sent[0].body),['id'])
 await db.exec("update private.sales_dispatch_jobs set handed_at=now()-interval '11 minutes' where handed_at is not null")
 assert.equal((await one('select private.sales_dispatch_tick() n')).n,1)
 const g=await one("select has_function_privilege('authenticated','public.sales_dispatch_enabled()','execute') a,has_function_privilege('service_role','public.sales_dispatch_enabled()','execute') s");assert.deepEqual(g,{a:false,s:true})
})
