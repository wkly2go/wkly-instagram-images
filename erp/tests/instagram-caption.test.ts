import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { igCaption, igCaptionIssues, igHashtags } from '../src/lib/instagramCaption.ts'

test('hashtags are normalised, deduplicated and prefixed', () => {
  assert.deepEqual(igHashtags('팝업, #팝업스토어  성수,팝업 #THE_WKLY!'), ['#팝업', '#팝업스토어', '#성수', '#THE_WKLY'])
})

test('caption adds the title once and skips tags already in the body', () => {
  assert.equal(igCaption({ title: '이번 주 팝업', body: '성수에서 열립니다 #성수', tags: '성수 팝업' }), '이번 주 팝업\n\n성수에서 열립니다 #성수\n\n#팝업')
  assert.equal(igCaption({ title: '첫 줄', body: '첫 줄 그리고 본문', tags: '' }), '첫 줄 그리고 본문')
})

test('caption limits follow Instagram rules', () => {
  assert.deepEqual(igCaptionIssues('짧은 글'), [])
  assert.match(igCaptionIssues('가'.repeat(2201))[0], /2,200자/)
  assert.match(igCaptionIssues(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '))[0], /해시태그가 31개/)
})

test('publish migration only lets the service role run publish functions', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261117130000_growth_instagram_publish.sql', import.meta.url), 'utf8')
  assert.match(sql, /grant execute on function public\.growth_ig_publish_prepare\(uuid, integer, uuid, boolean\) to service_role/)
  assert.doesNotMatch(sql, /to authenticated/)
  assert.match(sql, /role = 'admin'/)
  assert.match(sql, /where state = 'published'/)
})
