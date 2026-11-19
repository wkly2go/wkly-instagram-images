import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isTaskLogText, taskLogText } from '../src/lib/taskLog.ts'

const sql = readFileSync(new URL('../supabase/migrations/20261117150000_task_work_log.sql', import.meta.url), 'utf8')

test('task log text follows the status and trims the title', () => {
  assert.equal(taskLogText('  견적서 회신  ', '완료'), '견적서 회신 — 완료')
  assert.equal(taskLogText('견적서 회신', '진행 중'), '견적서 회신 — 진행 중')
  assert.equal(taskLogText('견적서 회신', '할 일'), '견적서 회신 — 진행 중')
  assert.equal(taskLogText('가'.repeat(400), '완료'), `${'가'.repeat(300)} — 완료`)
})

test('only untouched generated text counts as an automatic log', () => {
  assert.equal(isTaskLogText('견적서 회신 — 완료', '견적서 회신'), true)
  assert.equal(isTaskLogText('견적서 회신 — 진행 중', ' 견적서 회신 '), true)
  assert.equal(isTaskLogText('견적서 회신 — 완료 (업체 3곳 비교)', '견적서 회신'), false)
  assert.equal(isTaskLogText('다른 일 — 완료', '견적서 회신'), false)
})

test('the SQL text matches the screen helper', () => {
  assert.match(sql, /left\(btrim\(coalesce\(p_title, ''\)\), 300\) \|\| case when p_status = '완료' then ' — 완료' else ' — 진행 중' end/)
  assert.ok(taskLogText('x', '완료').endsWith(' — 완료') && taskLogText('x', '진행 중').endsWith(' — 진행 중'))
})

test('the trigger cannot block saving a task and is not callable from the app', () => {
  assert.match(sql, /add column if not exists task_id uuid references public\.tasks\(id\) on delete set null/)
  assert.match(sql, /create or replace function private\.task_to_work_log\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/)
  assert.match(sql, /exception when others then[\s\S]*?raise warning/)
  assert.match(sql, /create trigger tasks_work_log\s+after insert or update of status, title, memo, project_id on public\.tasks\s+for each row execute function private\.task_to_work_log\(\)/)
  assert.match(sql, /drop trigger if exists tasks_work_log on public\.tasks/)
  assert.match(sql, /revoke execute on function private\.task_to_work_log\(\) from public, anon, authenticated/)
  assert.match(sql, /p\.is_agent/)
  assert.match(sql, /at time zone 'Asia\/Seoul'/)
  // no backfill of past tasks: the only insert is the one inside the trigger function
  assert.equal(sql.match(/insert into public\.work_logs/g)?.length, 1)
})

test('weekly gaps treat a completed task with a linked log as already written', () => {
  // weekly.ts imports './date' without an extension, so it cannot be loaded here: check the rule in its source instead
  const weekly = readFileSync(new URL('../src/lib/weekly.ts', import.meta.url), 'utf8')
  assert.match(weekly, /a\.logs\.some\(l => l\.task_id === t\.id && l\.log_date >= a\.monday && l\.log_date <= sunday\)\) return false/)
  const types = readFileSync(new URL('../src/lib/types.ts', import.meta.url), 'utf8')
  assert.match(types, /task_id\?: string \| null/)
})

test('postpone moves the due date to the next day (late or empty → tomorrow)', async () => {
  const { postponePatch } = await import('../src/lib/taskPostpone.ts')
  const today = '2026-11-19'
  assert.deepEqual(postponePatch({ due_date: '2026-11-19', start_date: null, remind_at: null }, today), { due_date: '2026-11-20' })
  assert.deepEqual(postponePatch({ due_date: '2026-11-25', start_date: '2026-11-20', remind_at: null }, today), { due_date: '2026-11-26' })
  assert.deepEqual(postponePatch({ due_date: '2026-11-18', start_date: '2026-11-18', remind_at: null }, today), { due_date: '2026-11-20', start_date: '2026-11-20' })
  assert.deepEqual(postponePatch({ due_date: null, start_date: null, remind_at: null }, today), { due_date: '2026-11-20' })
  assert.deepEqual(postponePatch({ due_date: '2026-11-19', start_date: null, remind_at: '2026-11-19T00:00:00.000Z' }, today), { due_date: '2026-11-20', remind_at: '2026-11-20T00:00:00.000Z' })
})
