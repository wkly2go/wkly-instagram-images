import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

// An isolated PostgreSQL instance; no production endpoint or credentials are used.
const db = new PGlite()
const ADMIN = '10000000-0000-4000-8000-000000000001'
const MEMBER = '10000000-0000-4000-8000-000000000002'
const INACTIVE = '10000000-0000-4000-8000-000000000003'
const UNKNOWN = '10000000-0000-4000-8000-000000000004'
const migration = await readFile(new URL('../supabase/migrations/0107_marketing_desk.sql', import.meta.url), 'utf8')

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema storage;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.profiles(id uuid primary key, role text not null, active boolean not null);
    insert into public.profiles values
      ('${ADMIN}', 'admin', true), ('${MEMBER}', 'member', true), ('${INACTIVE}', 'admin', false);
    create function public.is_active_member() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
    $$;
    create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role='admin')
    $$;
    create table storage.buckets(id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, metadata jsonb, unique(bucket_id,name));
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1]
    $$;
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    grant select on storage.buckets to anon, authenticated;
  `)
  await db.exec(migration)
})
after(async () => { await db.close() })

async function asUser(id, action, role = 'authenticated') {
  assert.ok(['authenticated', 'anon'].includes(role))
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ''])
  await db.exec(`set role ${role}`)
  try { return await action() }
  finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', '', false)")
  }
}

function document(patch = {}) {
  return {
    title: '검증용 캠페인', brand: 'wkly', goal: 'leads', platform: 'meta',
    landingUrl: '', sourceUrl: '', audience: '', offer: '', headline: '', primaryText: '', description: '', cta: '',
    startDate: '', endDate: '', dailyBudget: null, totalBudget: null,
    reviews: { content: false, rights: false, budget: false }, textAdConfirmed: false, seasonNote: '', status: 'draft',
    ...patch,
  }
}
function completeDocument(patch = {}) {
  return document({
    landingUrl: 'https://www.thewklyn.com/space/', headline: '공간 소개', primaryText: '일정과 규모를 알려 주세요.', cta: '문의하기',
    startDate: '2099-01-01', endDate: '2099-01-03', dailyBudget: 10000, totalBudget: 30000,
    reviews: { content: true, rights: true, budget: true }, ...patch,
  })
}
async function save(doc = document(), id = randomUUID(), revision = 0, user = ADMIN) {
  return asUser(user, async () => {
    const result = await db.query('select * from public.marketing_save_campaign($1::uuid, $2::jsonb, $3::integer)', [id, JSON.stringify(doc), revision])
    return result.rows[0]
  })
}
async function campaign(id, user = ADMIN) {
  return asUser(user, async () => (await db.query('select * from public.marketing_campaigns where id=$1', [id])).rows[0])
}
async function objectFor(campaignId, { id = randomUUID(), mime = 'image/png', size = 68 } = {}) {
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'
  const path = `${campaignId}/${id}.${ext}`
  await asUser(ADMIN, () => db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['marketing-assets', path, JSON.stringify({ mimetype: mime, size })]))
  return { id, campaignId, path, mime, size }
}
async function attach(asset, user = ADMIN) {
  return asUser(user, async () => (await db.query('select * from public.marketing_add_asset($1::uuid,$2::uuid,$3::text,$4::text,$5::bigint,$6::text)', [asset.id, asset.campaignId, '공간.png', asset.mime, asset.size, asset.path])).rows[0])
}
const permissionDenied = error => error.code === '42501'

test('migration creates private storage configuration and a repeated attempt rolls back without changing data', async () => {
  const row = await save()
  const bucket = (await db.query("select * from storage.buckets where id='marketing-assets'")).rows[0]
  assert.equal(bucket.public, false)
  assert.equal(Number(bucket.file_size_limit), 8 * 1024 * 1024)
  assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp'])
  await assert.rejects(db.exec(migration), error => error.code === '42P07')
  await db.exec('rollback')
  assert.equal((await campaign(row.id)).revision, 1)
  const tables = (await db.query("select relname, relrowsecurity from pg_class where relname in ('marketing_campaigns','marketing_assets')")).rows
  assert.equal(tables.length, 2)
  assert.ok(tables.every(table => table.relrowsecurity))
})

test('admin saves incomplete drafts, receives revision/provenance, and stale writes cannot overwrite newer edits', async () => {
  const first = await save(document({ title: '처음 제목' }))
  assert.equal(first.revision, 1)
  assert.equal(first.created_by, ADMIN)
  assert.equal(first.updated_by, ADMIN)
  const next = await save({ ...first.document, title: '새 제목' }, first.id, 1)
  assert.equal(next.revision, 2)
  await assert.rejects(save({ ...first.document, title: '이전 창 제목' }, first.id, 1), error => error.code === '40001')
  assert.equal((await campaign(first.id)).document.title, '새 제목')
  await assert.rejects(save(document(), randomUUID(), 2), error => error.code === '40001')
})

test('active members can read shared drafts but all direct writes and mutating RPCs stay blocked', async () => {
  const row = await save()
  assert.equal((await campaign(row.id, MEMBER)).id, row.id)
  await assert.rejects(save(row.document, row.id, row.revision, MEMBER), permissionDenied)
  await assert.rejects(asUser(MEMBER, () => db.query('update public.marketing_campaigns set document=$1 where id=$2', [JSON.stringify(document({ title: '변경 시도' })), row.id])), permissionDenied)
  await assert.rejects(asUser(ADMIN, () => db.query('delete from public.marketing_campaigns where id=$1', [row.id])), permissionDenied)
  await assert.rejects(asUser(MEMBER, () => db.query('select public.marketing_archive_asset($1::uuid)', [randomUUID()])), permissionDenied)
  assert.equal((await campaign(row.id)).revision, 1)
})

test('inactive admins, unknown accounts and anonymous users cannot access company campaigns', async () => {
  const row = await save()
  for (const id of [INACTIVE, UNKNOWN]) {
    assert.equal(await campaign(row.id, id), undefined)
    await assert.rejects(save(row.document, row.id, row.revision, id), permissionDenied)
  }
  await assert.rejects(asUser(null, () => db.query('select * from public.marketing_campaigns'), 'anon'), permissionDenied)
  await assert.rejects(asUser(null, () => db.query('select * from public.marketing_save_campaign($1::uuid,$2::jsonb,0)', [randomUUID(), JSON.stringify(document())]), 'anon'), permissionDenied)
})

test('server rejects malformed dates, unsafe URLs, invalid amounts, unknown properties and forged live statuses', async () => {
  for (const patch of [
    { startDate: '2030-02-30' }, { startDate: '2030-01-02', endDate: '2030-01-01' },
    { landingUrl: 'javascript:alert(1)' }, { sourceUrl: 'https://user:pass@example.com' },
    { dailyBudget: 0 }, { dailyBudget: -1 }, { dailyBudget: 1.5 }, { dailyBudget: '10000' },
    { totalBudget: 9007199254740992 }, { dailyBudget: 20000, totalBudget: 10000 },
    { startDate: '2099-01-01', endDate: '2099-01-03', dailyBudget: 10000, totalBudget: 29999 },
    { status: 'active' }, { serviceRole: 'unauthorized' }, { reviews: { content: 'true', rights: true, budget: true } },
  ]) await assert.rejects(save(document(patch)))
})

test('ready requires current dates, explicit budgets, full review and attached image or confirmed Naver text ad', async () => {
  await assert.rejects(save(completeDocument({ status: 'ready' })), /이미지 소재/)
  const textAd = completeDocument({ platform: 'naver', textAdConfirmed: true, status: 'ready' })
  assert.equal((await save(textAd)).document.status, 'ready')
  for (const patch of [
    { dailyBudget: null }, { totalBudget: null }, { startDate: '' }, { startDate: '2000-01-01', endDate: '2000-01-03' },
    { landingUrl: '' }, { headline: '' }, { primaryText: '' }, { cta: '' },
    { reviews: { content: true, rights: false, budget: true } }, { textAdConfirmed: false },
  ]) await assert.rejects(save({ ...textAd, ...patch }))
})

test('server content, rights and budget changes invalidate only related reviews and return to draft', async () => {
  const checks = [
    [{ headline: '바뀐 제목' }, { content: false, rights: true, budget: true }],
    [{ dailyBudget: 9000 }, { content: true, rights: true, budget: false }],
    [{ sourceUrl: 'https://example.com/source' }, { content: false, rights: false, budget: true }],
    [{ platform: 'meta' }, { content: false, rights: false, budget: false }],
  ]
  for (const [patch, expected] of checks) {
    const first = await save(completeDocument({ platform: 'naver', textAdConfirmed: true, status: 'ready' }))
    const updated = await save({ ...first.document, ...patch }, first.id, first.revision)
    assert.equal(updated.document.status, 'draft')
    assert.deepEqual(updated.document.reviews, expected)
  }
})

test('asset registration checks actual object metadata, bumps campaign revision and invalidates content/rights', async () => {
  const first = await save(completeDocument())
  const asset = await objectFor(first.id)
  await assert.rejects(attach({ ...asset, size: 69 }), /일치하지/)
  await assert.rejects(attach({ ...asset, path: '../other.png' }), /파일 정보/)
  await assert.rejects(attach({ ...asset, size: 8 * 1024 * 1024 + 1 }), /파일 정보/)
  await assert.rejects(attach(asset, MEMBER), permissionDenied)
  const attached = await attach(asset)
  assert.equal(attached.path, asset.path)
  const changed = await campaign(first.id)
  assert.equal(changed.revision, 2)
  assert.equal(changed.document.status, 'draft')
  assert.deepEqual(changed.document.reviews, { content: false, rights: false, budget: true })
  await assert.rejects(save(first.document, first.id, first.revision), error => error.code === '40001')
  const ready = await save({ ...changed.document, status: 'ready', reviews: { content: true, rights: true, budget: true } }, first.id, changed.revision)
  assert.equal(ready.document.status, 'ready')
})

test('private object policies permit active members to read attachments but deny orphan reads and unauthorized uploads', async () => {
  const first = await save()
  const attached = await objectFor(first.id)
  await attach(attached)
  const orphan = await objectFor(first.id)
  const visible = await asUser(MEMBER, () => db.query('select name from storage.objects where name=any($1::text[]) order by name', [[attached.path, orphan.path]]))
  assert.deepEqual(visible.rows.map(r => r.name), [attached.path])
  for (const id of [INACTIVE, UNKNOWN]) {
    assert.equal((await asUser(id, () => db.query('select name from storage.objects where name=$1', [attached.path]))).rows.length, 0)
  }
  assert.equal((await asUser(null, () => db.query('select name from storage.objects where name=$1', [attached.path]), 'anon')).rows.length, 0)
  await assert.rejects(asUser(MEMBER, () => db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['marketing-assets', `${first.id}/${randomUUID()}.png`, '{}'])), permissionDenied)
  await assert.rejects(asUser(ADMIN, () => db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['marketing-assets', `${randomUUID()}/${randomUUID()}.png`, '{}'])), permissionDenied)
  await assert.rejects(asUser(ADMIN, () => db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['marketing-assets', '../unsafe.png', '{}'])), permissionDenied)
})

test('repeating an identical asset registration is idempotent but changed or archived metadata cannot be reused', async () => {
  const first = await save(completeDocument())
  const asset = await objectFor(first.id)
  const original = await attach(asset)
  const afterFirst = await campaign(first.id)
  const retry = await attach(asset)
  assert.equal(retry.id, original.id)
  assert.equal((await campaign(first.id)).revision, afterFirst.revision)
  const rows = await asUser(ADMIN, () => db.query('select id from public.marketing_assets where campaign_id=$1', [first.id]))
  assert.equal(rows.rows.length, 1)
  await assert.rejects(asUser(ADMIN, () => db.query('select * from public.marketing_add_asset($1::uuid,$2::uuid,$3::text,$4::text,$5::bigint,$6::text)', [asset.id, asset.campaignId, 'different-name.png', asset.mime, asset.size, asset.path])))
  await asUser(ADMIN, () => db.query('select public.marketing_archive_asset($1::uuid)', [asset.id]))
  const afterArchive = await campaign(first.id)
  await assert.rejects(attach(asset))
  assert.equal((await campaign(first.id)).revision, afterArchive.revision)
})

test('linked images cannot be deleted directly; archive hides them, invalidates readiness and supports cleanup retry', async () => {
  const first = await save(completeDocument())
  const asset = await objectFor(first.id)
  await attach(asset)
  const current = await campaign(first.id)
  const ready = await save({ ...current.document, status: 'ready', reviews: { content: true, rights: true, budget: true } }, first.id, current.revision)
  const direct = await asUser(ADMIN, () => db.query('delete from storage.objects where name=$1 returning name', [asset.path]))
  assert.equal(direct.rows.length, 0)
  const result = await asUser(ADMIN, () => db.query('select public.marketing_archive_asset($1::uuid) as path', [asset.id]))
  assert.equal(result.rows[0].path, asset.path)
  const changed = await campaign(first.id)
  assert.equal(changed.revision, ready.revision + 1)
  assert.deepEqual(changed.document.reviews, { content: false, rights: false, budget: true })
  assert.equal(changed.document.status, 'draft')
  assert.equal((await asUser(MEMBER, () => db.query('select * from public.marketing_assets where id=$1', [asset.id]))).rows.length, 0)
  assert.equal((await asUser(MEMBER, () => db.query('select * from storage.objects where name=$1', [asset.path]))).rows.length, 0)
  await asUser(ADMIN, () => db.query('select public.marketing_archive_asset($1::uuid)', [asset.id]))
  assert.equal((await campaign(first.id)).revision, changed.revision)
  const removed = await asUser(ADMIN, () => db.query('delete from storage.objects where name=$1 returning name', [asset.path]))
  assert.equal(removed.rows.length, 1)
})
