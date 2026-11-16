import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create schema private;
 create function is_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'')='1'$$;
 create table profiles(email text);insert into profiles values('jay@thewklyn.com'),('owner@gmail.com');
 create table contacts(email text,phone text);insert into contacts values('Kim@Brand.co.kr','010-1234-5678'),('kim@brand.co.kr',null),('깨진 주소','010');
 create table clients(email text,phone text);insert into clients values('deal@client.co.kr','02-123-4567'),('kim@brand.co.kr','031-000-0000'),('info@thewklyn.com',null),('support@figma.com',null),('team@supabase.com',null);
 create table brand_contacts(email text,phone text,opt_out boolean default false,collected_by_agent uuid);
 insert into brand_contacts values('direct@shop.kr',null,false,null),('scraped@shop.kr',null,false,gen_random_uuid()),('stop@shop.kr',null,true,null);
 create table sales_prospects(source text,contact text,blocked boolean default false,assessment text default '확인 필요',reviewed_assessment text);
 insert into sales_prospects(source,contact) values('민간 영업 후보','문의 hello@enquiry.kr'),('민간 영업 후보','stop@shop.kr'),('민간 영업 후보','owner@gmail.com'),('민간 영업 후보','friend@gmail.com'),('news_brand','public@brand.com');
 insert into sales_prospects(source,contact,assessment) values('민간 영업 후보','held@ad.kr','보류');`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090131_sales_mail_noise.sql',import.meta.url),'utf8').then(s=>s.replace(/create trigger[\s\S]*?;\nupdate[\s\S]*?;\n/,'')))
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090135_sales_ad_audience.sql',import.meta.url),'utf8'))
})
test('only the administrator gets the list',async()=>{await assert.rejects(db.query('select * from public.sales_ad_audience()'))})
test('the list holds direct contacts once each, with phones in international form, and leaves out everything else',async()=>{
 await db.exec("select set_config('test.admin','1',false)")
 assert.deepEqual((await db.query('select * from public.sales_ad_audience()')).rows,[
  {email:'deal@client.co.kr',phone:'+8221234567',segment:'거래처'},{email:'direct@shop.kr',phone:'',segment:'브랜드 연락처'},{email:'friend@gmail.com',phone:'',segment:'문의'},
  {email:'hello@enquiry.kr',phone:'',segment:'문의'},{email:'kim@brand.co.kr',phone:'+821012345678',segment:'담당자'}])
})
