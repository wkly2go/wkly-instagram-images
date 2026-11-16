import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),a=randomUUID(),one=async(q,p=[])=>(await db.query(q,p)).rows[0]
const found=(over={})=>({status:'found',homepage:'https://www.paulnua.com/',contact_page:'https://www.paulnua.com/contact',emails:['partner@paulnua.com'],note:'확인',...over})
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema private;create schema net;create schema cron;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('WKLY_EDGE_ANON_KEY','k');
 create table sales_prospects(id uuid primary key default gen_random_uuid(),source text,name text,contact text default '',evidence text default '',next_action text default '',assessment text default '확인 필요',reviewed_assessment text,blocked boolean default false,source_updated_at timestamptz default now(),event_data jsonb default '{}',revision integer default 1);
 insert into sales_prospects(id,source,name) values('${a}','news_brand','폴뉴아');insert into sales_prospects(source,name,assessment) values('news_brand','해남군','보류'),('네이버 뉴스','기사','확인 필요');
 create table cron.job(jobid bigserial,jobname text primary key,schedule text,active boolean);create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.job(jobname,schedule,active) values(n,s,true);return 1;end$$;
 create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
 create table net.requests(id bigserial primary key,url text,body jsonb);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.requests(url,body) values(url,body) returning id$$;`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090123_sales_brand_site.sql',import.meta.url),'utf8'))
})
test('starts switched off and queues only usable brands that were not checked yet',async()=>{
 assert.equal((await one("select active from cron.job where jobname='wkly_sales_brand_site'")).active,false)
 assert.equal((await one('select private.sales_brand_site_tick() n')).n,1);assert.equal((await one('select private.sales_brand_site_tick() n')).n,0)
})
test('finish validates the result and stores the site as evidence only',async()=>{
 const sent=(await one('select body from net.requests')).body
 assert.equal((await one('select public.sales_brand_site_claim($1,$2) j',[sent.id,randomUUID()])).j,null)
 assert.deepEqual((await one('select public.sales_brand_site_claim($1,$2) j',[sent.id,sent.token])).j,{id:sent.id,brand:'폴뉴아'})
 for(const bad of [found({homepage:'http://www.paulnua.com/'}),found({homepage:'https://www.paulnua.com/shop'}),found({contact_page:'https://evil.com/contact'}),found({emails:['not-an-address']}),found({emails:['a@b.co','a@b.co']}),found({extra:1}),{status:'not_found',homepage:'https://x.com/',contact_page:'',emails:[],note:''}])
  await assert.rejects(db.query('select public.sales_brand_site_finish($1,$2)',[sent.id,JSON.stringify(bad)]))
 await db.query('select public.sales_brand_site_finish($1,$2)',[sent.id,JSON.stringify(found())])
 const row=await one('select contact,evidence,event_data from sales_prospects where id=$1',[a])
 assert.equal(row.contact,'partner@paulnua.com · https://www.paulnua.com/contact');assert.match(row.evidence,/자체 사이트 확인: https:\/\/www\.paulnua\.com\//);assert.equal(row.event_data.homepage,'https://www.paulnua.com/');assert.deepEqual(row.event_data.public_emails,['partner@paulnua.com'])
 assert.equal((await one('select private.sales_brand_site_tick() n')).n,0)
})
test('repeated outages pause the search',async()=>{
 await db.exec("insert into sales_prospects(source,name) values('news_brand','새 브랜드');insert into private.sales_brand_site_jobs(prospect_id,brand,state,result) select id,name,'done',jsonb_build_object('status','unavailable') from sales_prospects where name='폴뉴아' union all select id,name,'done',jsonb_build_object('status','unavailable') from sales_prospects where name='폴뉴아' union all select id,name,'expired',null::jsonb from sales_prospects where name='폴뉴아'")
 assert.equal((await one('select private.sales_brand_site_tick() n')).n,0)
 const g=await one("select has_function_privilege('authenticated','public.sales_brand_site_finish(uuid,jsonb)','execute') a,has_function_privilege('service_role','public.sales_brand_site_claim(uuid,uuid)','execute') s");assert.deepEqual(g,{a:false,s:true})
})
