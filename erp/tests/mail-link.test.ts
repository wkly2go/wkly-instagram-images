import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 2026-11-23: 프로젝트 이름에 든 팀원 이름('… · 이채원') 때문에 그 사람 서명이 든 메일이 모두 그 프로젝트에 붙던 것
const sql = readFileSync(new URL('../supabase/migrations/20261123160000_mail_link_no_person_names.sql', import.meta.url), 'utf8')

test('느슨한 맞춤은 팀원 이름을 낱말로 쓰지 않는다 · 지우는 것 없음', () => {
  assert.doesNotMatch(sql, /\bdrop\s|\bdelete\s/i)
  assert.match(sql, /not exists \(select 1 from public\.profiles pr where replace\(pr\.name, ' ', ''\) = tok\.t\)/)
  assert.match(sql, /pg_get_functiondef\('public\.match_projects_loose\(text\)'::regprocedure\)/)
})

test('잘못 붙은 연결만 떼고 다시 맞춘다 (이름 · 연번이 글에 있는 메일은 둠)', () => {
  assert.match(sql, /array_remove\(project_ids, r\.id\)/)
  assert.match(sql, /and not \(r\.id = any \(public\.match_projects\(/)
  assert.match(sql, /set subject = subject where id = any \(ids\) and cardinality\(project_ids\) = 0/)
})

test('프로젝트 구분 RS 의 이름은 공통 회사운영업무', () => {
  const types = readFileSync(new URL('../src/lib/types.ts', import.meta.url), 'utf8')
  assert.match(types, /RS: \{ label: '공통 회사운영업무'/)
})
