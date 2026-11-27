import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { creditOpen } from '../supabase/functions/video-worker/plan.ts'

const sql = readFileSync(new URL('../supabase/migrations/20261127220000_anthropic_credit_roll.sql', import.meta.url), 'utf8')
const agents = readFileSync(new URL('../supabase/functions/api-agents/index.ts', import.meta.url), 'utf8')

test('구독이 이어질 때만 만료일을 넘긴다 · 크레딧 원칙은 그대로', () => {
  assert.match(sql, /renews_monthly', 'false'\) <> 'true' then return p_value/)
  assert.doesNotMatch(sql, /paid_allowed'?\s*,\s*true/)          // 유료 사용을 켜지 않는다
  assert.match(sql, /'assumed', true/)                            // 넘긴 날짜는 가정임을 남긴다
  assert.match(sql, /make_interval\(months => v_n\)/)             // 처음 날짜에서 n 달 (말일 밀림 없음)
})

test('하루 한 번 · AI 팀원 5분 주기와 겹치지 않는 분 · 알림 없음', () => {
  const m = sql.match(/cron\.schedule\('anthropic_credit_roll', '(\d+) (\d+) \* \* \*'/)
  assert.ok(m)
  assert.notEqual(Number(m![1]) % 5, 3)
  assert.doesNotMatch(sql, /insert into public\.notifications/)
  assert.match(sql, /revoke all on function private\.anthropic_credit_roll\(\) from public, anon, authenticated/)
})

test('저장소에 금액을 적지 않는다', () => {
  assert.doesNotMatch(sql, /left_usd|balance_usd|\d+\.\d{2}/)
})

test('넘긴 날짜가 앞에 있으면 두 실행기 모두 멈추지 않는다', () => {
  const now = Date.parse('2026-12-21T00:00:00+09:00')
  const before = { paid_allowed: false, grants: [{ left_usd: 10, expires_at: '2026-12-20T09:00:00+09:00' }] }
  const after = { paid_allowed: false, grants: [{ left_usd: 10, expires_at: '2027-01-20T09:00:00+09:00', assumed: true }] }
  assert.equal(creditOpen(before, now), false)
  assert.equal(creditOpen(after, now), true)
  // api-agents 는 가장 늦은 만료일만 본다 (배포본과 같은 소스가 저장소에 있어야 함)
  assert.match(agents, /const last = Math\.max\(0, \.\.\.\(v\.grants \?\? \[\]\)\.map\(g => Date\.parse\(g\.expires_at \?\? ''\) \|\| 0\)\)/)
  assert.match(agents, /isCreditError/)                           // 실제 소진은 '한도 초과' 로 처리
})
