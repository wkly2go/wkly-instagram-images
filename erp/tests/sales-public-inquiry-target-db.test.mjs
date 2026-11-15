import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),sql=await readFile(new URL('../supabase/migrations/20261115090130_sales_public_inquiry_target.sql',import.meta.url),'utf8')
const original=(await readFile(new URL('../supabase/migrations/20261115090104_sales_preapproval.sql',import.meta.url),'utf8')).match(/create function private\.sales_strategy_targets[\s\S]*?\n\$\$;/)[0]
const plan=randomUUID(),client=randomUUID(),ids=Object.fromEntries(['brand','privacyOnly','linked','none','other'].map(k=>[k,randomUUID()]))
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create schema private;
 create table clients(id uuid primary key,name text,email text);insert into clients values('${client}','거래처','deal@client.co.kr');
 create table contacts(id uuid primary key,client_id uuid,name text,email text);
 create table brand_contacts(id uuid primary key default gen_random_uuid(),contact_name text,email text,opt_out boolean default false);
 create table sales_prospects(id uuid primary key,source text,source_key text default '',name text,entity_kind text default '회사',reviewed_kind text,organization text default '',source_url text default '',client_id uuid,contact_id uuid,assessment text default '확인 필요',reviewed_assessment text,end_date date,event_data jsonb default '{}');
 create function private.sales_prospect_signature(p public.sales_prospects) returns text language sql as $$select 'sig'$$;
 create function private.sales_prospect_blocked(p public.sales_prospects) returns boolean language sql as $$select false$$;
 create table sales_strategies(id uuid primary key,plan jsonb);
 insert into sales_prospects(id,source,name,client_id,event_data) values
  ('${ids.brand}','news_brand','피지오겔',null,'{"public_emails":["Privacy@lghnh.com","physiogel@lghnh.com","second@lghnh.com"]}'),
  ('${ids.privacyOnly}','news_brand','개인정보만',null,'{"public_emails":["privacy@a.co.kr","no-reply@a.co.kr","recruit.team@a.co.kr","깨진 주소"]}'),
  ('${ids.linked}','news_brand','거래처 브랜드','${client}','{"public_emails":["hello@brand.co.kr"]}'),
  ('${ids.none}','news_brand','주소 없음',null,'{}'),
  ('${ids.other}','네이버 뉴스','다른 출처',null,'{"public_emails":["x@y.co.kr"]}');
 insert into sales_strategies values('${plan}','${JSON.stringify({evidence_ids:Object.values(ids)})}');`)
 await db.exec(original);await db.exec(sql);await db.exec(sql)
})
test('a reported brand gets its public inquiry address as a candidate; privacy and automated addresses never do',async()=>{
 const rows=(await db.query(`select private.sales_strategy_targets('${plan}') t`)).rows[0].t,by=Object.fromEntries(rows.map(r=>[r.name,r]))
 assert.deepEqual([by['피지오겔'].email,by['피지오겔'].email_origin,by['피지오겔'].status,by['피지오겔'].outreach_ready],['physiogel@lghnh.com','공식 사이트 공개 주소','공식 공개 창구 확보',false])
 assert.deepEqual([by['개인정보만'].email,by['개인정보만'].status],['','연락처 자동 보완 대상'])
 assert.deepEqual([by['거래처 브랜드'].email,by['거래처 브랜드'].email_origin,by['거래처 브랜드'].status],['deal@client.co.kr','거래처 DB','저장 연락처 연결'])
 assert.deepEqual([by['주소 없음'].email,by['주소 없음'].email_origin],['','연결 없음'])
 assert.equal(by['다른 출처'].email,'')
})
test('an unexpected target query stops the change',async()=>{
 const other=new PGlite();await other.exec("create role authenticated;create role anon;create schema private;create function private.sales_strategy_targets(p_id uuid) returns jsonb language sql as $$select '[]'::jsonb$$;")
 await assert.rejects(other.exec(sql),/Unexpected target query/)
})
