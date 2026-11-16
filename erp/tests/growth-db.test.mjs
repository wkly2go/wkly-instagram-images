import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { saveContactImportBatch } from '../src/lib/contactImport.ts'
const db=new PGlite(),ADMIN=randomUUID(),OWNER=randomUUID(),OTHER=randomUUID(),INACTIVE=randomUUID(),CAMPAIGN=randomUUID()
const preflight=await readFile(new URL('../supabase/diagnostics/growth_preflight_readonly.sql',import.meta.url),'utf8')
const postflight=await readFile(new URL('../supabase/diagnostics/growth_postflight_readonly.sql',import.meta.url),'utf8')
let beforePostflight=[]
let beforeInstall=[]
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
 await db.exec('begin read only')
 try{beforeInstall=(await db.query(preflight)).rows;beforePostflight=(await db.query(postflight)).rows}finally{await db.exec('rollback')}
 for(const file of ['0113_sales_pipeline.sql','0114_growth_workspace.sql','0115_growth_ai_budget.sql','0117_growth_approval_context.sql','0118_instagram_contact_capture.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
})
after(()=>db.close())
async function as(user,fn,role='authenticated'){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await db.exec('set role '+role);try{return await fn()}finally{await db.exec('reset role')}}
const doc=(kind='tender')=>({kind,title:'공고 테스트',owner_id:OWNER,status:kind==='content'?'작성 중':'검토',campaign_id:null,document:kind==='tender'?{division:'TW',source_url:'https://example.com',note:'검토',number:randomUUID(),round:'00',agency:'발주처',deadline:'2026-12-01T10:00:00+09:00',amount:null,qualification:'추가 확인',evidence:''}:kind==='contact'?{division:'TW',source_url:'',note:'',name:'',brand:'',email:randomUUID()+'@example.com',instagram:'',segment:'미분류',source:'직접 등록'}:{division:'TW',source_url:'',note:'',original:'원본 사실',versions:['네이버 블로그','인스타그램','유튜브'].map(channel=>({channel,title:'글',body:'본문',tags:'',status:'초안',rights:true,publication_url:'',external_id:''}))}})
const save=(d,id=randomUUID(),rev=0,user=OWNER)=>as(user,async()=>(await db.query('select * from growth_save($1,$2::jsonb,$3)',[id,JSON.stringify(d),rev])).rows[0])
const denied=e=>e.code==='42501'
test('deployment preflight runs read-only before and after installation, including missing history schema',async()=>{
 assert.ok(beforeInstall.filter(r=>r['구분']==='신규 테이블').every(r=>r['상태']==='없음'))
 await db.exec('begin read only')
 try{
  const rows=(await db.query(preflight)).rows
  assert.ok(rows.filter(r=>['신규 테이블','서버 함수','메일 자동 후보'].includes(r['구분'])).every(r=>r['상태']==='있음'))
  assert.equal(rows.find(r=>r['구분']==='설치 이력')['상태'],'없음')
 }finally{await db.exec('rollback')}
})
test('post-install read-only checks detect missing objects and unsafe grants or disabled RLS',async()=>{
 assert.equal(beforePostflight.length,9)
 assert.ok(beforePostflight.every(r=>r['결과']==='확인 필요'))
 await db.exec('begin read only')
 try{
  const rows=(await db.query(postflight)).rows
  assert.equal(rows.length,9);assert.ok(rows.every(r=>r['결과']==='정상'))
 }finally{await db.exec('rollback')}
 await db.exec('begin')
 try{
  await db.exec('alter table growth_items disable row level security; grant select on growth_items to anon; grant insert on growth_items to authenticated; grant execute on function growth_ai_reserve(uuid,uuid,text,text,text,integer) to authenticated; alter table mail_index disable trigger growth_mail_capture; drop policy growth_history_read on growth_revisions;')
  const rows=(await db.query(postflight)).rows
  for(const item of ['행별 접근 제어(RLS)','팀원 조회 정책','비로그인 테이블 접근 차단','팀원 직접 변경 차단','AI 예약·정산 서버 전용 권한','메일 자동 후보 트리거'])assert.equal(rows.find(r=>r['점검 항목']===item)['결과'],'확인 필요',item)
 }finally{await db.exec('rollback')}
})
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
test('contact import recovers a committed response loss against the real SQL normalization without another revision',async()=>{
 const draft=doc('contact'),id=randomUUID()
 draft.title='  가져온 브랜드  ';draft.document.email=`Brand.${randomUUID()}@Example.COM`;delete draft.document.instagram
 const candidate={id,draft}
 const api={
  saveGrowth:async(key,value,revision)=>{assert.equal(revision,0);await save(value,key,revision);throw new Error('response lost after commit')},
  getGrowth:async key=>as(OWNER,async()=>{const row=(await db.query('select * from growth_items where id=$1',[key])).rows[0];if(!row)throw new Error('not found');return row}),
 }
 const first=await saveContactImportBatch([candidate],api)
 assert.equal(first.saved.length,1);assert.equal(first.pending.length,0);assert.equal(first.recovered,1)
 const retry=await saveContactImportBatch([candidate],api)
 assert.equal(retry.saved.length,1);assert.equal(retry.pending.length,0);assert.equal(retry.recovered,1)
 const row=await api.getGrowth(id)
 assert.equal(row.title,'가져온 브랜드');assert.equal(row.document.email,draft.document.email.toLowerCase());assert.equal(row.document.instagram,'');assert.equal(row.revision,1)
 assert.equal((await db.query('select count(*)::int n from growth_revisions where item_id=$1',[id])).rows[0].n,1)
})
test('contact import keeps different-ID duplicates and changed same-ID rows pending without overwriting SQL data',async()=>{
 const draft=doc('contact'),stored=await save(draft),id=randomUUID()
 const api={saveGrowth:(key,value,revision)=>save(value,key,revision),getGrowth:async key=>as(OWNER,async()=>{const row=(await db.query('select * from growth_items where id=$1',[key])).rows[0];if(!row)throw new Error('not found');return row})}
 const duplicate=await saveContactImportBatch([{id,draft}],api)
 assert.equal(duplicate.saved.length,0);assert.equal(duplicate.pending[0].id,id)
 const updated=structuredClone(draft);updated.document.note='다른 작업에서 수정한 메모'
 await save(updated,stored.id,1)
 const mismatch=await saveContactImportBatch([{id:stored.id,draft}],api)
 assert.equal(mismatch.saved.length,0);assert.equal(mismatch.pending[0].id,stored.id)
 const row=await api.getGrowth(stored.id)
 assert.equal(row.revision,2);assert.equal(row.document.note,updated.document.note)
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
test('mail sync accepts a whitespace-only sender name and uses email as the contact title',async()=>{
 await db.query('insert into mail_index(id,thread_id,from_addr,from_name) values($1,$1,$2,$3)',['blank-sender-name','blank-name@brand.kr','   '])
 const r=(await db.query("select title,status from growth_items where source_key='email:blank-name@brand.kr'")).rows[0]
 assert.equal(r.title,'blank-name@brand.kr');assert.equal(r.status,'검토')
 assert.equal((await db.query("select count(*)::int n from mail_index where id='blank-sender-name'")).rows[0].n,1)
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

for (const [field, changed] of [['division','AR'], ['source_url','https://example.com/new-evidence']]) {
 test(`server rejects stale approval after ${field} changes, including direct RPC`, async()=>{
  const d=doc('content'),r=await save(d)
  d.document.versions.forEach(v=>{v.status='승인'})
  const approved=await save(d,r.id,r.revision,ADMIN)
  d.document[field]=changed
  await assert.rejects(save(d,r.id,approved.revision,ADMIN),/초안/)
  await assert.rejects(save(d,r.id,approved.revision,OWNER),/초안/)
  const stored=(await db.query('select document,revision from growth_items where id=$1',[r.id])).rows[0]
  assert.equal(stored.revision,approved.revision)
  d.document.versions.forEach(v=>{v.status='초안';v.publication_url='';v.external_id=''})
  const updated=await save(d,r.id,approved.revision)
  assert.equal(updated.document[field],changed)
  assert.ok(updated.document.versions.every(v=>v.status==='초안'))
  d.document.versions[0].status='승인'
  await assert.rejects(save(d,r.id,updated.revision),denied)
  assert.equal((await save(d,r.id,updated.revision,ADMIN)).document.versions[0].status,'승인')
 })
}
test('server preserves approvals when only a note changes',async()=>{
 const d=doc('content'),r=await save(d)
 d.document.versions[0].status='승인'
 const approved=await save(d,r.id,r.revision,ADMIN)
 d.document.note='검토 메모만 수정'
 const updated=await save(d,r.id,approved.revision)
 assert.equal(updated.document.versions[0].status,'승인')
})

const igCommit=(account,revision,cursor,contacts,owner=OWNER,role='service_role',division='TW')=>as(ADMIN,async()=>(await db.query('select growth_ig_commit($1,$2,$3,$4::jsonb,$5,$6) result',[account,revision,cursor,JSON.stringify(contacts),owner,division])).rows[0].result,role)
test('Instagram candidate ingest, checkpoint and stable IDs commit atomically without overwriting manual edits',async()=>{
 const a='70001',c=[{id:'70002',username:'candidate_one'}]
 assert.equal((await igCommit(a,0,'page2',c)).inserted,1)
 const row=(await db.query("select * from growth_items where source_key='ig:candidate_one'")).rows[0]
 const d={kind:row.kind,title:'검토한 담당자',owner_id:row.owner_id,status:'확인',document:{...row.document,note:'담당자가 직접 확인'},campaign_id:null}
 await save(d,row.id,row.revision)
 const second=await igCommit(a,1,null,[{id:'70002',username:'renamed_candidate'}])
 assert.equal(second.kept,1)
 assert.equal((await db.query('select title from growth_items where id=$1',[row.id])).rows[0].title,'검토한 담당자')
 const checkpoint=(await db.query('select * from growth_ig_sync where account_id=$1',[a])).rows[0]
 assert.equal(checkpoint.revision,2);assert.equal(checkpoint.cursor,null);assert.ok(checkpoint.last_completed_at)
 await assert.rejects(igCommit(a,1,null,[{id:'70003',username:'must_not_insert'}]),e=>e.code==='40001')
 assert.equal((await db.query("select count(*)::int n from growth_items where source_key='ig:must_not_insert'")).rows[0].n,0)
})
test('Instagram batch rollback retains cursor and inserts no partial candidates',async()=>{
 await igCommit('71000',0,'before',[])
 await assert.rejects(igCommit('71000',1,'after',[{id:'71001',username:'rollback_candidate'},{id:'x',username:'bad'}]))
 assert.equal((await db.query("select cursor from growth_ig_sync where account_id='71000'")).rows[0].cursor,'before')
 assert.equal((await db.query("select count(*)::int n from growth_items where source_key='ig:rollback_candidate'")).rows[0].n,0)
})
test('Instagram capture is service-only and rejects inactive owners and malformed pages',async()=>{
 for(const role of ['authenticated','anon'])await assert.rejects(igCommit('72000',0,null,[],OWNER,role),denied)
 await assert.rejects(igCommit('72000',0,null,[],INACTIVE),/담당자/)
 await assert.rejects(igCommit('bad',0,null,[]))
 await assert.rejects(igCommit('72000',0,null,Array.from({length:101},()=>({id:'2',username:'a'}))))
})
test('Instagram username matches an existing email-based contact without changing its status',async()=>{
 const d=doc('contact');d.document.instagram='already_known';d.status='제외';const row=await save(d)
 const result=await igCommit('73000',0,null,[{id:'73001',username:'already_known'}]);assert.equal(result.kept,1);assert.equal(result.inserted,0)
 assert.equal((await db.query('select item_id from growth_ig_contacts where account_id=$1',['73000'])).rows[0].item_id,row.id)
 assert.equal((await db.query('select status from growth_items where id=$1',[row.id])).rows[0].status,'제외')
})

test('Instagram account cannot silently change the candidate company',async()=>{await igCommit('99110',0,null,[],OWNER,'service_role','AR');await assert.rejects(igCommit('99110',1,null,[],OWNER,'service_role','TW'),/회사가 다릅니다/);await assert.rejects(igCommit('99111',0,null,[],OWNER,'service_role','WRONG'),/회사를 확인/);assert.equal((await db.query("select revision from growth_ig_sync where account_id='99110'")).rows[0].revision,1)})
