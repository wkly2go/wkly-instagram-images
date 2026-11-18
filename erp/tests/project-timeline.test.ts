import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { countBySource, groupByDay, timelineLink, type TimelineItem } from '../src/lib/projectTimeline.ts'

const it = (source: TimelineItem['source'], at: string, ref: string): TimelineItem => ({ source, at, who: '사람', body: '글', ref })

test('items are grouped by Korean calendar day, newest day and newest item first', () => {
  const days = groupByDay([
    it('메일', '2026-11-18T14:59:00Z', 'mail:t1'), // 11-18 23:59 KST
    it('슬랙', '2026-11-18T15:01:00Z', 'slack:c'), // 11-19 00:01 KST
    it('인트라넷', '2026-11-19T01:00:00Z', 'chat:r:1'),
  ])
  assert.deepEqual(days.map(d => [d.day, d.items.map(x => x.source)]), [['2026-11-19', ['인트라넷', '슬랙']], ['2026-11-18', ['메일']]])
})

test('each source opens where the original lives', () => {
  assert.deepEqual(timelineLink(it('인트라넷', '', 'chat:room-1:42')), { href: '/chat?room=room-1', external: false })
  assert.deepEqual(timelineLink(it('메일', '', 'mail:abc')), { href: 'https://mail.google.com/mail/u/0/#all/abc', external: true })
  assert.equal(timelineLink(it('협업방', '', 'collab:room'))?.href, '#collab')
  assert.equal(timelineLink(it('카톡', '', 'kakao:'))?.href, '#kakao')
  assert.equal(countBySource([it('카톡', 'x', 'kakao:'), it('카톡', 'y', 'kakao:')]).카톡, 2)
})

test('the server function only reads, runs with the caller\'s permissions and is closed to outsiders', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261119024000_project_timeline.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /security definer/i)
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop)\b/i)
  assert.match(sql, /revoke all on function public\.project_timeline\(uuid, timestamptz, int\) from public, anon/)
  for (const t of ['chat_messages', 'slack_messages', 'kakao_messages', 'mail_index', 'collab_messages']) assert.match(sql, new RegExp(`public\\.${t}`))
})

test('inquiry automation: direct inquiries only, never tests or subscriptions, and no mail is sent', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261119023000_inquiry_auto_project.sql', import.meta.url), 'utf8')
  assert.match(sql, /w\.kind = '문의' and w\.status = '신규' and not coalesce\(w\.is_test, false\)/)
  assert.match(sql, /'상담협의'/)
  assert.doesNotMatch(sql, /\bdrop\s/i)
  assert.doesNotMatch(sql, /gmail|send_mail|net\.http_post/i)
})
