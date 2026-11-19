// 능력 지표 · 자동화 고도화 · 메뉴별 사용설명 (2026-11-19)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { belowTarget, CAPABILITY_AXES, readBuildStats, scoreChange, scoreOf, valueLabel, weakestMetric } from '../src/lib/capability.ts'
import { MANUAL } from '../src/lib/manual.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('axes below the target are listed lowest first, missing scores are ignored', () => {
  const s = { coverage: 79, adoption: 66, automation: 92, stability: 68, performance: 84, security: 80, quality: null }
  assert.deepEqual(belowTarget(s).map(a => a.key), ['adoption', 'stability', 'coverage'])
  assert.equal(belowTarget({ adoption: 80 }).length, 0)
  assert.equal(scoreOf(s, 'quality'), null)
  assert.equal(CAPABILITY_AXES.length, 7)
})

test('change is measured against the snapshot about a week earlier', () => {
  const day = (d: string, total: number) => ({ day: d, scores: { total } })
  assert.equal(scoreChange([day('2026-11-19', 70)], 'total'), null)
  assert.equal(scoreChange([day('2026-11-12', 62), day('2026-11-15', 66), day('2026-11-19', 71.5)], 'total'), 9.5)
  assert.equal(scoreChange([day('2026-11-18', 66), day('2026-11-19', 71)], 'total'), 5)
})

test('the weakest sub-metric of an axis is picked, and values read naturally', () => {
  const metrics = [
    { name: '첫 화면에 받는 양', value: 305.7, unit: 'KB', score: 83.3, rule: '' },
    { name: '업데이트 뒤 다시 받는 양', value: 203.6, unit: 'KB', score: 69.3, rule: '' },
    { name: '화면 조회 평균 응답', value: null, unit: 'ms', score: null, rule: '' },
  ]
  assert.equal(weakestMetric(metrics)?.name, '업데이트 뒤 다시 받는 양')
  assert.equal(weakestMetric([]), null)
  assert.equal(valueLabel(metrics[0]), '305.7 KB')
  assert.equal(valueLabel(metrics[2]), '아직 없음')
  assert.equal(valueLabel({ name: '장치', value: 4, unit: '/5', score: 80, rule: '' }), '4/5')
})

test('build numbers are only passed on when every one is a real number', () => {
  const ok = readBuildStats({ id: 'abc-1234567', stats: { first_load_kb: 305.7, update_kb: 203.6, app_kb: 139.9, tests: 1082, menus: 24, manual_pages: 24, ci: true, runbook: true } })
  assert.equal(ok?.first_load_kb, 305.7)
  assert.equal(ok?.ci, true)
  assert.equal(readBuildStats({ id: 'x' }), null)
  assert.equal(readBuildStats({ stats: { first_load_kb: '305', update_kb: 1, app_kb: 1, tests: 1, menus: 1, manual_pages: 1 } }), null)
  assert.equal(readBuildStats(null), null)
})

test('every menu has a one-page manual', () => {
  const keys = [...read('../src/components/Shell.tsx').matchAll(/^\s*\{ key: '([A-Za-z]+)', label: '/gm)].map(m => m[1])
  assert.ok(keys.length >= 24)
  for (const k of keys) {
    const m = MANUAL[k]
    assert.ok(m, `메뉴 ${k} 사용설명이 없음`)
    assert.ok(m.what.length > 8 && m.auto.length >= 1 && m.you.length >= 1, k)
  }
  assert.match(read('../src/pages/Help.tsx'), /MANUAL\[t\.key\]/)
})

test('the score is computed by a fixed formula on the server, for admins only', () => {
  const sql = read('../supabase/migrations/20261119212000_capability_score.sql')
  assert.doesNotMatch(sql, /\bdrop\s+(table|function|view|index|trigger|schema)/i)
  assert.match(sql, /create or replace function public\.admin_capability\(p_refresh boolean default false\)/)
  assert.match(sql, /if not public\.is_admin\(\) then raise exception/)
  assert.match(sql, /revoke all on function public\.admin_capability\(boolean\) from public, anon/)
  assert.match(sql, /revoke all on private\.capability_daily from public, anon, authenticated/)
  assert.match(sql, /cron\.schedule\('wkly_capability_daily', '5 15 \* \* \*'/)
  // 문서의 기준선과 같은지 (몇 곳만)
  const doc = read('../docs/CAPABILITY_SCORE.md')
  assert.match(sql, /array\[250, 100, 350, 70, 500, 40\]/); assert.match(doc, /250KB 100점 · 350KB 70점 · 500KB 40점/)
  assert.match(sql, /array\[100, 100, 200, 70, 350, 40\]/); assert.match(doc, /100KB 100점 · 200KB 70점 · 350KB 40점/)
  assert.match(sql, /array\[0, 30, 3, 60, 7, 80, 14, 100\]/); assert.match(doc, /14일 100점 · 7일 80점 · 3일 60점 · 당일 30점/)
  // 밖에서 부르는 확인 호출은 시각 하나만 적는다
  assert.match(sql, /create or replace function public\.monitor_ping\(\) returns text/)
  assert.match(sql, /grant execute on function public\.monitor_ping\(\) to anon, authenticated, service_role/)
  // 로그인 없이 필요 없는 권한은 거둔다
  assert.match(sql, /revoke all on public\.design_g2b_classes[\s\S]*?from anon;/)
  assert.match(sql, /revoke execute on function %s from public, anon/)
})

test('automation boost: weekly drafts on Friday, mail follows its thread, nothing is sent', () => {
  const sql = read('../supabase/migrations/20261119211000_automation_boost.sql')
  assert.doesNotMatch(sql, /\bdrop\s+(table|function|view|index|trigger|schema)/i)
  assert.match(sql, /cron\.schedule\('wkly_weekly_report_drafts', '30 7 \* \* 5'/)
  assert.match(sql, /cron\.schedule\('wkly_weekly_report_monday', '10 0 \* \* 1'/)
  // 이미 적었거나 제출한 보고는 건드리지 않는다
  assert.match(sql, /w\.submitted_at is not null or coalesce\(btrim\(w\.summary\), ''\) <> ''/)
  assert.match(sql, /where public\.weekly_reports\.submitted_at is null/)
  assert.match(sql, /m\.thread_id = new\.thread_id and m\.id <> new\.id/)
  assert.match(sql, /interval '36 hours'/)
  // 직접 문의 · 관심 신호는 자동 확인에서 뺀다
  assert.match(sql, /w\.kind = '구독'\s+or \(w\.kind = '리포트 신청' and coalesce\(w\.category, ''\) not in \('다음 팝업 기획', '첫 팝업 준비', '상권·입지 검토'\)\)/)
  assert.doesNotMatch(sql, /net\.http_post|sales_dispatch|gmail/i)
  assert.match(read('../src/components/WeeklyReport.tsx'), /report\?\.auto_draft_at && !report\.submitted_at/)
})

test('checks run before merging and an outside monitor watches the server, without secrets', () => {
  const ci = read('../../.github/workflows/ci.yml')
  for (const step of ['npx tsc --noEmit -p .', 'npm run test:all', 'npm run test:ui', 'npm run build', 'npm run check:bundle']) assert.ok(ci.includes(step), step)
  const up = read('../../.github/workflows/uptime.yml')
  assert.match(up, /cron: '\*\/10 \* \* \* \*'/)
  assert.match(up, /rest\/v1\/rpc\/monitor_ping/)
  assert.doesNotMatch(up, /secrets\./)
  assert.match(read('../docs/RUNBOOK.md'), /Restart project/)
})
