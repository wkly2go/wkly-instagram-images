import {before,test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),one=async q=>(await db.query(q)).rows[0]
const add=async(name,terms,extra='')=>{await db.query(`insert into sales_prospects(source,name,event_data${extra?',reviewed_assessment,assessment':''}) values('나라장터 공식 API',$1,$2${extra?",'우선 검토','우선 검토'":''})`,[name,JSON.stringify({category:'service',...(terms?{terms}:{})})])}
const row=async name=>one(`select assessment,next_action,reasons,event_data->'eligibility' e from sales_prospects where name='${name}'`)
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create schema private;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);create schema net;
 create table sales_collection_runs(id uuid primary key default gen_random_uuid(),report_date date default current_date,source text,status text,note text default '',count integer default 0,started_at timestamptz default now(),finished_at timestamptz);
 create table private.sales_g2b_jobs(run_id uuid primary key,token uuid default gen_random_uuid(),category text,keyword text,start_date date,end_date date);
 create function private.sales_g2b_watchdog() returns void language sql as $$select$$;
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$select 1::bigint$$;
 create function is_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'')='1'$$;
 create table sales_prospects(id uuid primary key default gen_random_uuid(),source text,name text,assessment text default '확인 필요',score integer default 60,reasons text default '',next_action text default '원래 조치',event_data jsonb default '{}',reviewed_assessment text,revision integer default 1,end_date date);`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090120_sales_license_scope.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090127_sales_bid_eligibility.sql',import.meta.url),'utf8'))
 await db.exec(`create role service_role;create table sales_collection_runs2(id int);alter table private.sales_g2b_jobs add column claimed boolean default false;`)
 await db.exec(await readFile(new URL('../supabase/migrations/20261115090128_sales_bid_lookup_reuse.sql',import.meta.url),'utf8'))
})
const event='기타자유업(행사대행업)/9901'
test('unlimited notices can be joined; unknown licences and regions wait for confirmation',async()=>{
 await add('제한 없는 행사',{industry_limited:false,region_limited:false})
 await add('행사대행업 제한',{industry_limited:true,region_limited:false,licenses:[event]})
 await add('대구 제한',{industry_limited:true,region_limited:true,licenses:[event],regions:['대구광역시']})
 await add('조회 실패',{industry_limited:true,region_limited:false})
 await add('조건 없는 옛 공고',null)
 assert.deepEqual(await row('제한 없는 행사'),{assessment:'확인 필요',next_action:'원래 조치',reasons:'',e:{verdict:'참여 가능',note:'업종 · 지역 제한 없음 또는 보유 자격으로 충족'}})
 const limited=await row('행사대행업 제한');assert.equal(limited.e.verdict,'자격 확인 필요');assert.match(limited.next_action,/참가 자격 확인: 등록 여부 확인이 필요한 업종: 기타자유업\(행사대행업\)/)
 assert.match((await row('대구 제한')).e.note,/본사 소재지 미등록/);assert.match((await row('조회 실패')).e.note,/조회 전/)
 assert.equal((await row('조건 없는 옛 공고')).e,null)
 assert.deepEqual(await one("select status from sales_bid_qualifications where kind='업종'"),{status:'확인 필요'})
})
test('construction licences are not held, the design-firm qualification is',async()=>{
 await add('건설 면허 용역',{industry_limited:true,region_limited:false,licenses:['실내건축공사업/0037']})
 await add('디자인 용역',{industry_limited:true,region_limited:false,licenses:['산업디자인전문회사(환경디자인)/4440']})
 await add('섞인 제한',{industry_limited:true,region_limited:false,licenses:['실내건축공사업/0037','산업디자인전문회사(환경디자인)/4440']})
 await add('대표가 살린 공고',{industry_limited:true,region_limited:false,licenses:['실내건축공사업/0037']},'reviewed')
 const no=await row('건설 면허 용역');assert.equal(no.assessment,'제외');assert.match(no.reasons,/참여 불가: 미보유 업종: 실내건축공사업/)
 assert.equal((await row('디자인 용역')).e.verdict,'참여 가능')
 assert.equal((await row('섞인 제한')).e.verdict,'자격 확인 필요')
 const kept=await row('대표가 살린 공고');assert.equal(kept.assessment,'우선 검토');assert.equal(kept.e.verdict,'참여 불가')
})
test('only the administrator sets qualifications, and saved notices are judged again',async()=>{
 await assert.rejects(db.query("select public.sales_bid_qualification_set('업종',$1,'보유')",[event]))
 await db.exec("select set_config('test.admin','1',false)")
 await assert.rejects(db.query("select public.sales_bid_qualification_set('업종','없는 업종','보유')"))
 await assert.rejects(db.query("select public.sales_bid_qualification_set('지역','화성','보유')"))
 await assert.rejects(db.query("select public.sales_bid_qualification_set('업종',$1,'아마도')",[event]))
 await db.query("select public.sales_bid_qualification_set('업종',$1,'보유')",[event])
 assert.equal((await row('행사대행업 제한')).e.verdict,'참여 가능')
 assert.match((await row('대구 제한')).e.note,/본사 소재지 미등록/)
 await db.exec("select public.sales_bid_qualification_set('지역','서울특별시','보유')")
 const daegu=await row('대구 제한');assert.equal(daegu.assessment,'제외');assert.match(daegu.reasons,/본사 소재지 아님/)
 assert.deepEqual(await one("select count(*) filter(where status='보유')::int held,count(*) filter(where status='미보유')::int other from sales_bid_qualifications where kind='지역'"),{held:1,other:16})
 await add('서울 제한',{industry_limited:false,region_limited:true,regions:['서울특별시 강남구']});assert.equal((await row('서울 제한')).e.verdict,'참여 가능')
 await db.query("select public.sales_bid_qualification_set('업종',$1,'미보유')",[event])
 assert.equal((await row('행사대행업 제한')).assessment,'제외')
 await db.query("select public.sales_bid_qualification_set('업종',$1,'보유')",[event])
 const back=await row('행사대행업 제한');assert.equal(back.assessment,'확인 필요');assert.equal(back.next_action,'공고 원문 검토');assert.equal(back.e.verdict,'참여 가능')
 assert.equal((await row('건설 면허 용역')).assessment,'제외')
})
test('a notice collected again without a lookup keeps its stored limits, and the collector is told what is known',async()=>{
 await db.exec("alter table sales_prospects add column if not exists collected_at timestamptz default now()")
 await db.query("insert into sales_prospects(source,name,event_data) values('나라장터 공식 API','다시 수집',$1)",[JSON.stringify({category:'service',number:'R1',round:'000',terms:{industry_limited:true,region_limited:false,licenses:['실내건축공사업/0037']}})])
 await db.query("insert into sales_prospects(source,name,event_data) values('나라장터 공식 API','조회 못 함',$1)",[JSON.stringify({category:'service',number:'R2',round:'000',terms:{industry_limited:true,region_limited:false}})])
 await db.query("update sales_prospects set event_data=$1 where name='다시 수집'",[JSON.stringify({category:'service',number:'R1',round:'000',terms:{industry_limited:true,region_limited:false,contract:'일반경쟁'}})])
 const again=await one("select event_data->'terms' t,assessment from sales_prospects where name='다시 수집'")
 assert.deepEqual(again.t.licenses,['실내건축공사업/0037']);assert.equal(again.t.contract,'일반경쟁');assert.equal(again.assessment,'제외')
 const run=(await one("insert into sales_collection_runs(source,status) values('나라장터 용역 · 행사','수집 중') returning id")).id
 const token=(await one(`insert into private.sales_g2b_jobs(run_id,category,keyword,start_date,end_date) values('${run}','service','행사',current_date-6,current_date) returning token`)).token
 const job=(await one(`select public.sales_g2b_claim('${run}','${token}') j`)).j
 assert.deepEqual(job.known,['R1:000']);assert.equal(job.keyword,'행사')
})
