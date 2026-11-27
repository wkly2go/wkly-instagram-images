import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 검색 노출 AI (API 에이전트 SEO · 2026-11-27): 하루 한 번 재고 적기만 한다. 홈페이지 · 광고 · 게시물은 못 건드린다
const sql = readFileSync(new URL('../supabase/migrations/20261127173000_seo_agent.sql', import.meta.url), 'utf8')

test('두 함수 모두 열쇠를 확인하고 서버만 부를 수 있다', () => {
  for (const sig of ['agent_seo_context(text)', 'agent_seo_save(text, jsonb)']) {
    assert.ok(sql.includes(`revoke all on function public.${sig} from public, anon, authenticated`), sig)
    assert.ok(sql.includes(`grant execute on function public.${sig} to service_role`), sig)
  }
  assert.equal(sql.match(/public\.agent_token_check\(p_token, 'task'\)/g)?.length, 2)
})

test('적는 곳은 측정 표 · 일지 · 알림뿐 (만들기 · 고치기 대상 표가 없다)', () => {
  const targets = [...sql.matchAll(/insert into (public\.[a-z_]+)/g)].map(m => m[1])
  assert.deepEqual([...new Set(targets)].sort(), ['public.agent_reports', 'public.api_agents', 'public.seo_checks'])
  assert.doesNotMatch(sql, /marketing_campaigns|growth_items|web_inquiries/)
})

test('상태 · 종류 · 개수를 서버가 다시 확인하고, 나빠졌을 때만 제목이 고정된 알림', () => {
  assert.match(sql, /in \('양호', '주의', '미흡', '미측정'\) then i->>'status' else '미측정'/)
  assert.match(sql, /i->>'kind' in \('SEO', 'AEO', 'GEO'\)/)
  assert.match(sql, /jsonb_array_length\(v_items\) > 80/)
  assert.match(sql, /'검색 노출 · 나빠진 항목이 있습니다'/)
  assert.match(sql, /interval '20 hours'/)
})

test('없어진 보고 체계를 가리키는 예전 지시는 넘기지 않고, 하루 한 번만 돈다', () => {
  assert.match(sql, /d\.created_at >= '2026-11-22'/)
  assert.match(sql, /array\['06:17'\]/)
})
