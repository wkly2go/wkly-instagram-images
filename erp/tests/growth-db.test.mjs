import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
const db=new PGlite(),ADMIN=randomUUID(),OWNER=randomUUID(),OTHER=randomUUID(),INACTIVE=randomUUID(),CAMPAIGN=randomUUID()
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,active boolean,is_agent boolean default false);
 insert into profiles(id,role,active)values('${ADMIN}','admin',true),('${OWNER}','member',true),('${OTHER}','member',true),('${INACTIVE}','admin',false);
 create function public.is_active_member()returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and active)$$;
 create function public.is_admin()returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin')$$;
 create table clients(id uuid primary key);create table contacts(id uuid primary key,client_id uuid);create table projects(id uuid primary key,client_id uuid,division text);
 create table marketing_campaigns(id uuid primary key,document jsonb);insert into marketing_campaigns values('${CAMPAIGN}','{"brand":"wkly"}');
 create table mail_index(id text primary key,thread_id text,from_addr text,from_name text,labels text[],subject text,sent_at timestamptz,synced_at timestamptz);
 grant usage on schema auth,public to authenticated,anon,service_role;`)
 for(const file of ['0112_sales_pipeline.sql','0113_growth_workspace.sql','0114_growth_ai_budget.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
})
after(()=>db.close())
async function as(user,fn,role='authenticated'){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await db.exec('set role '+role);try{return await fn()}finally{await db.exec('reset role')}}
const doc=(kind='tender')=>({kind,title:'공고 테스트',owner_id:OWNER,status:kind==='content'?'작성 중':'검토',campaign_id:null,document:kind==='tender'?{division:'TW',source_url:'https://example.com',note:'검토',number:randomUUID(),round:'00',agency:'발주처',deadline:'2026-12-01T10:00:00+09:00',amount:null,qualification:'추가 확인',evidence:''}:kind==='contact'?{division:'TW',source_url:'',note:'',name:'',brand:'',email:randomUUID()+'@example.com',instagram:'',segment:'미분류',source:'직접 등록'}:{division:'TW',source_url:'',note:'',original:'원본 사실',versions:['네이버 블로그','인스타그램','유튜브'].map(channel=>({channel,title:'글',body:'본문',tags:'',status:'초안',rights:true,publication_url:'',external_id:''}))}})
const save=(d,id=randomUUID(),rev=0,user=OWNER)=>as(user,async()=>(await db.query('select * from growth_save($1,$2::jsonb,$3)',[id,JSON.stringify(d),rev])).rows[0])
const denied=e=>e.code==='42501'
test('growth owner saves; other member cannot write or reassign; revision conflict protects data',async()=>{
 const d=doc(),r=await save(d);assert.equal(r.revision,1)
 await assert.rejects(save(d,r.id,1,OTHER),denied);await assert.rejects(save({...d,owner_id:OTHER},r.id,1),denied)
 await save({...d,title:'수정'},r.id,1);await assert.rejects(save(d,r.id,1),e=>e.code==='40001')
 await assert.rejects(as(OWNER,()=>db.query('delete from growth_items where id=$1',[r.id])),denied)
 assert.equal((await as(INACTIVE,()=>db.query('select * from growth_items'))).rows.length,0)
 await assert.rejects(as(null,()=>db.query('select * from growth_items'),'anon'),denied)
})
test('duplicate tender and normalized email cannot create duplicate records',async()=>{
 const d=doc();await save(d);await assert.rejects(save(d),e=>e.code==='23505')
 const c=doc('contact');c.document.email='Brand@Example.com';await save(c);c.document.email=' brand@example.com ';await assert.rejects(save(c),e=>e.code==='23505')
})
test('tender qualification, URLs, campaign company and amount validated at server',async()=>{
 const d=doc();d.document.qualification='충족';await assert.rejects(save(d),/근거/);d.document.evidence='공고 3쪽';d.document.amount=-1;await assert.rejects(save(d),/금액/)
 d.document.amount=null;d.document.source_url='javascript:alert(1)';await assert.rejects(save(d),/출처/)
 d.document.source_url='https://example.com';d.document.deadline='2026-12-01T10:00';await assert.rejects(save(d),/시간대/)
 const c=doc('content');c.campaign_id=CAMPAIGN;c.document.division='AR';await assert.rejects(save(c),/같은 회사/)
})
test('only administrator approves unchanged saved content; edits revoke approval requirement',async()=>{
 const d=doc('content'),r=await save(d);d.document.versions[0].status='승인'
 await assert.rejects(save(d,r.id,1),denied);const approved=await save(d,r.id,1,ADMIN);assert.equal(approved.revision,2)
 d.document.versions[0].body='변경';await assert.rejects(save(d,r.id,2,ADMIN),/초안/)
 d.document.versions[0].status='초안';const updated=await save(d,r.id,2);assert.equal(updated.revision,3)
})
test('published status requires approved content and actual publication URL',async()=>{
 const d=doc('content'),r=await save(d);d.document.versions[0].status='발행';await assert.rejects(save(d,r.id,1,ADMIN),/발행 주소/)
 d.document.versions[0].publication_url='https://example.com/post';assert.equal((await save(d,r.id,1,ADMIN)).document.versions[0].status,'발행')
})
test('source to sales link is transactional and retry-idempotent',async()=>{
 const r=await save(doc());const link=()=>as(OWNER,async()=>(await db.query('select growth_link_sales($1,$2) id',[r.id,1])).rows[0].id)
 const id=await link();assert.equal(await link(),id);assert.equal((await db.query('select * from sales_opportunities where id=$1',[id])).rows.length,1)
 const c=await save(doc('contact'));await assert.rejects(as(OWNER,()=>db.query('select growth_link_sales($1,1)',[c.id])),/검토/)
})
test('mail sync captures new external senders, preserves excluded contacts, ignores sent mail',async()=>{
 const insert=(id,email,labels=[])=>db.query('insert into mail_index(id,thread_id,from_addr,from_name,labels,subject) values($1,$1,$2,$2,$3,$4)',[id,email,labels,'문의'])
 await insert('mail1','hello@brand.kr');await insert('mail2','hello@brand.kr');await insert('mail3','info@thewklyn.com');await insert('mail4','noreply@brand.kr');await insert('mail5','sent@brand.kr',['SENT'])
 const r=(await db.query("select * from growth_items where source_key='email:hello@brand.kr'")).rows[0];assert.ok(r);assert.equal(r.status,'검토')
 await db.query("update growth_items set status='제외' where id=$1",[r.id]);await insert('mail6','hello@brand.kr');assert.equal((await db.query('select status from growth_items where id=$1',[r.id])).rows[0].status,'제외')
 assert.equal((await db.query("select * from growth_items where source_key in ('email:info@thewklyn.com','email:noreply@brand.kr','email:sent@brand.kr')")).rows.length,0)
})
test('historical mail backfill skips ignored senders and advances without duplicating contacts',async()=>{
 await db.exec('alter table mail_index disable trigger growth_mail_capture')
 try{await db.exec("insert into mail_index(id,thread_id,from_addr,sent_at) values ('past1','past1','old@brand.kr',now()),('past2','past2','noreply@brand.kr',now()),('past3','past3','info@thewklyn.com',now()),('past4','past4','invalid',now())")}finally{await db.exec('alter table mail_index enable trigger growth_mail_capture')}
 await assert.rejects(as(OWNER,()=>db.query('select growth_backfill_mail()')),denied)
 const n=async()=>(await as(ADMIN,()=>db.query('select growth_backfill_mail() n'))).rows[0].n
 assert.equal(await n(),1);assert.equal(await n(),0)
 assert.equal((await db.query("select count(*)::int n from growth_items where source_key='email:old@brand.kr'")).rows[0].n,1)
})
let budgetId=randomUUID()
const configure=(user=ADMIN,limit=0.1)=>as(user,()=>db.query('select growth_ai_configure($1::jsonb,$2::jsonb)',[JSON.stringify({id:budgetId,starts_at:'2020-01-01T00:00:00Z',ends_at:'2099-01-01T00:00:00Z',limit_usd:limit,enabled:true}),JSON.stringify([{key:'standard',label:'작성',model_id:'claude-test',input_rate:2,output_rate:10,enabled:true}])]))
const reserve=(id=randomUUID(),user=OWNER,signature='a'.repeat(64))=>as(null,async()=>(await db.query('select growth_ai_reserve($1,$2,$3,$4,$5,$6) result',[id,user,'write',signature,'standard',1000])).rows[0].result,'service_role')
const finish=(id,amount,unknown=false)=>as(null,()=>db.query('select growth_ai_finish($1,$2,$3,$4)',[id,amount,'결과',unknown]),'service_role')
test('AI config is administrator only; authenticated client cannot reserve or bypass budget',async()=>{
 await assert.rejects(configure(OWNER),denied);await configure()
 await assert.rejects(as(OWNER,()=>db.query('select growth_ai_reserve($1,$2,$3,$4,$5,$6)',[randomUUID(),OWNER,'write','a'.repeat(64),'standard',1000])),denied)
})
test('AI reservation uses atomic configured prices, retries never execute twice, settlement is idempotent',async()=>{
 const id=randomUUID(),r=await reserve(id);assert.equal(r.execute,true);assert.equal(Number(r.input_rate),2)
 assert.equal((await reserve(id)).execute,false);await assert.rejects(reserve(randomUUID()),/실행 중/)
 await assert.rejects(reserve(id,OTHER),/같은 요청/);await finish(id,.01);await finish(id,.01)
 const b=(await db.query('select * from growth_ai_budgets where id=$1',[budgetId])).rows[0];assert.equal(Number(b.spent_usd),.01);assert.equal(Number(b.reserved_usd),0)
 assert.equal((await reserve(id)).text,'결과')
})
test('uncertain call retains reservation; budget and inactive users stop new charges',async()=>{
 const id=randomUUID();await reserve(id);await finish(id,null,true);const b=(await db.query('select * from growth_ai_budgets where id=$1',[budgetId])).rows[0];assert.equal(Number(b.reserved_usd),.018)
 assert.equal((await reserve(id)).status,'unknown');await configure(ADMIN,.03);await assert.rejects(reserve(),/한도/);await assert.rejects(reserve(randomUUID(),INACTIVE),denied)
 await assert.rejects(configure(ADMIN,.001),/낮게/)
})
test('manual reconciliation is admin-only, audited, and never replays the API call',async()=>{
 const row=(await db.query("select id from growth_ai_usage where status='unknown' limit 1")).rows[0]
 const reconcile=(user)=>as(user,()=>db.query('select growth_ai_reconcile($1,$2,$3)',[row.id,.005,'Console 요청 비용 확인']))
 await assert.rejects(reconcile(OWNER),denied);await reconcile(ADMIN);await assert.rejects(reconcile(ADMIN),/확인 대기/)
 const r=(await db.query('select * from growth_ai_usage where id=$1',[row.id])).rows[0];assert.equal(r.status,'reconciled');assert.equal(r.reconciled_by,ADMIN)
 assert.equal((await reserve(row.id)).execute,false);assert.equal(Number((await db.query('select reserved_usd from growth_ai_budgets where id=$1',[budgetId])).rows[0].reserved_usd),0)
})
