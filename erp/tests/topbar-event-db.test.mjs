import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const sql = await readFile(new URL('../supabase/migrations/20261116140000_topbar_events.sql', import.meta.url), 'utf8')
const base = `create role anon; create role authenticated; create schema auth;
 create table public.who(id uuid); create function auth.uid() returns uuid language sql stable as $$ select id from public.who limit 1 $$;
 create table public.profiles(id uuid primary key, name text, active boolean default true, is_agent boolean default false);
 create function public.is_active_member() returns boolean language sql stable as $$ select exists(select 1 from public.profiles p where p.id = auth.uid() and p.active) $$;
 create table public.hr_records(profile_id uuid primary key, birthday date, joined_on date, phone text);
 create table public.app_settings(key text primary key, value jsonb);`
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333'

async function setup() {
  const db = new PGlite(); await db.exec(base); await db.exec(sql)
  const today = (await db.query(`select (now() at time zone 'Asia/Seoul')::date d`)).rows[0].d
  return { db, today }
}

test('only names of today\'s birthdays and work anniversaries, never dates or other people', async () => {
  const { db } = await setup()
  await db.exec(`insert into public.profiles values ('${A}','김하늘',true,false),('${B}','이도윤',true,false),('${C}','퇴사자',false,false)`)
  await db.exec(`insert into public.hr_records(profile_id, birthday, joined_on) values
    ('${A}', ((now() at time zone 'Asia/Seoul')::date - interval '30 years')::date, null),
    ('${B}', ((now() at time zone 'Asia/Seoul')::date - interval '1 day')::date, ((now() at time zone 'Asia/Seoul')::date - interval '3 years')::date),
    ('${C}', ((now() at time zone 'Asia/Seoul')::date - interval '20 years')::date, null)`)
  await db.exec(`insert into public.app_settings values ('topbar_events', '[{"date":"11-20","title":"더위클리 창립","since":2025}]')`)
  await db.exec(`insert into public.who values ('${B}')`)
  const r = (await db.query('select public.topbar_events() r')).rows[0].r
  assert.deepEqual(r.birthdays, [{ id: A, name: '김하늘' }])
  assert.deepEqual(r.anniversaries, [{ id: B, name: '이도윤', years: 3 }])
  assert.equal(r.custom[0].title, '더위클리 창립')
  assert.doesNotMatch(JSON.stringify(r), /birthday"|joined_on|\d{4}-\d{2}-\d{2}T/)
})

test('a signed-out or inactive caller gets nothing', async () => {
  const { db } = await setup()
  await db.exec(`insert into public.profiles values ('${C}','퇴사자',false,false)`)
  assert.deepEqual((await db.query('select public.topbar_events() r')).rows[0].r, {})
  await db.exec(`insert into public.who values ('${C}')`)
  assert.deepEqual((await db.query('select public.topbar_events() r')).rows[0].r, {})
})
