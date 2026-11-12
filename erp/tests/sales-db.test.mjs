import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const ADMIN = randomUUID(), OWNER = randomUUID(), OTHER = randomUUID(), INACTIVE = randomUUID()
const CLIENT = randomUUID(), CLIENT2 = randomUUID(), CONTACT = randomUUID(), PROJECT = randomUUID()
before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(id uuid primary key,role text,active boolean,is_agent boolean default false);
    insert into public.profiles(id,role,active) values('${ADMIN}','admin',true),('${OWNER}','member',true),('${OTHER}','member',true),('${INACTIVE}','admin',false);
    create function public.is_active_member() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and active) $$;
    create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin') $$;
    create table public.clients(id uuid primary key);
    create table public.contacts(id uuid primary key,client_id uuid references public.clients(id));
    create table public.projects(id uuid primary key,client_id uuid references public.clients(id),division text);
    insert into public.clients values('${CLIENT}'),('${CLIENT2}');
    insert into public.contacts values('${CONTACT}','${CLIENT}');
    insert into public.projects values('${PROJECT}','${CLIENT}','TW');
    grant usage on schema auth,public to authenticated,anon;
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/0113_sales_pipeline.sql', import.meta.url), 'utf8'))
})
after(async () => { await db.close() })
async function asUser(id, fn, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec('reset role') }
}
function doc(p = {}) {
  return { title: '영업 테스트', division: 'TW', owner_id: OWNER, client_id: null, contact_id: null, stage: '발굴', source: '직접 발굴', source_url: '', expected_amount: null, next_action: '', next_date: null, description: '', result_note: '', project_id: null, ...p }
}
async function save(d = doc(), id = randomUUID(), rev = 0, user = OWNER) {
  return asUser(user, async () => (await db.query('select * from public.sales_save_opportunity($1,$2::jsonb,$3)', [id, JSON.stringify(d), rev])).rows[0])
}
const denied = e => e.code === '42501'
test('owner creates a separate opportunity and immutable revision, preserving unknown amount', async () => {
  const row = await save()
  assert.equal(row.revision, 1); assert.equal(row.expected_amount, null)
  const revisions = await asUser(OWNER, () => db.query('select * from sales_revisions where opportunity_id=$1', [row.id]))
  assert.equal(revisions.rows.length, 1)
  assert.equal(revisions.rows[0].snapshot.title, '영업 테스트')
})
test('other members can read but cannot modify ownership or forge revisions', async () => {
  const row = await save()
  assert.equal((await asUser(OTHER, () => db.query('select id from sales_opportunities where id=$1', [row.id]))).rows.length, 1)
  await assert.rejects(save(doc(), row.id, 1, OTHER), denied)
  await assert.rejects(save(doc({ owner_id: OTHER }), row.id, 1, OTHER), denied)
  await assert.rejects(save(doc({ owner_id: OTHER }), row.id, 1), denied)
  await assert.rejects(save(doc({ revision: 9 })), /허용되지/)
  await assert.rejects(asUser(OWNER, () => db.query("update sales_opportunities set title='forged' where id=$1", [row.id])), denied)
  await assert.rejects(asUser(OWNER, () => db.query('delete from sales_revisions where opportunity_id=$1', [row.id])), denied)
})
test('admin reassigns; original owner loses write access', async () => {
  const row = await save()
  const moved = await save(doc({ owner_id: OTHER }), row.id, 1, ADMIN)
  assert.equal(moved.owner_id, OTHER)
  await assert.rejects(save(doc(), row.id, 2), denied)
  assert.equal((await save(doc({ owner_id: OTHER }), row.id, 2, OTHER)).revision, 3)
})
test('inactive and anonymous cannot read or execute mutations', async () => {
  assert.equal((await asUser(INACTIVE, () => db.query('select * from sales_opportunities'))).rows.length, 0)
  await assert.rejects(save(doc(), randomUUID(), 0, INACTIVE), denied)
  await assert.rejects(asUser(null, () => db.query('select * from sales_opportunities'), 'anon'), denied)
  await assert.rejects(asUser(null, () => db.query('select sales_save_opportunity($1,$2,0)', [randomUUID(), JSON.stringify(doc())]), 'anon'), denied)
})
test('stale edits and repeated creation do not overwrite or duplicate', async () => {
  const row = await save()
  await save(doc({ title: '수정' }), row.id, 1)
  await assert.rejects(save(doc({ title: '덮어쓰기' }), row.id, 1), e => e.code === '40001')
  await assert.rejects(save(doc(), row.id, 0), e => e.code === '40001')
  assert.equal((await asUser(OWNER, () => db.query('select * from sales_opportunities where id=$1', [row.id]))).rows[0].title, '수정')
})
test('amount validation rejects fractional, negative, overflowing and string values', async () => {
  for (const amount of [-1, 1.2, 9007199254740992, '100']) await assert.rejects(save(doc({ expected_amount: amount })))
  assert.equal(Number((await save(doc({ expected_amount: 0 }))).expected_amount), 0)
})
test('follow-up and outcome validation applies server-side', async () => {
  await assert.rejects(save(doc({ next_date: '2026-11-13' })))
  await assert.rejects(save(doc({ next_date: '2026-02-30', next_action: '전화' })))
  await assert.rejects(save(doc({ stage: '실주' })))
  assert.equal((await save(doc({ stage: '실주', result_note: '일정 불일치' }))).stage, '실주')
})
test('contact and project links require matching company and client', async () => {
  await assert.rejects(save(doc({ client_id: CLIENT2, contact_id: CONTACT })), /연락처/)
  await assert.rejects(save(doc({ client_id: CLIENT, project_id: PROJECT })))
  await assert.rejects(save(doc({ division: 'AR', client_id: CLIENT, stage: '수주', result_note: '계약', project_id: PROJECT })), /프로젝트/)
  const row = await save(doc({ client_id: CLIENT, contact_id: CONTACT, stage: '수주', result_note: '계약 확인', project_id: PROJECT }))
  assert.equal(row.project_id, PROJECT)
})
test('unsafe URLs and inactive assignees are rejected', async () => {
  for (const source_url of ['javascript:alert(1)','https://user:password@example.com']) await assert.rejects(save(doc({ source_url })), /출처/)
  await assert.rejects(save(doc({ owner_id: INACTIVE }), randomUUID(), 0, ADMIN), /활성 팀원/)
})
test('activity retries are idempotent and cannot be repurposed or written by another member', async () => {
  const row = await save(), id = randomUUID()
  const add = (body = '담당자와 통화', user = OWNER, kind = '전화') => asUser(user, () => db.query('select sales_add_activity($1,$2,$3,$4)', [id,row.id,kind,body]))
  await add(); await add()
  assert.equal((await asUser(OWNER, () => db.query('select * from sales_activities where id=$1',[id]))).rows.length, 1)
  await assert.rejects(add('다른 내용'), /같은 요청/)
  await assert.rejects(add('담당자와 통화', OTHER), denied)
  await assert.rejects(add('담당자와 통화', OWNER, '상태 변경'), /활동 종류/)
})
