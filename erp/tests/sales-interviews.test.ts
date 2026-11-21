import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  ACTIVE_STAGES, DRAFT_KEYS, INTERVIEW_QUESTIONS, answersFromPaste, byUpload, cleanDraft, daysBetween, emptyInterview, fromLocalInput,
  interviewContentText, mailSignal, materialStatus, mdWithDay, toLocalInput, todayKst, uploadConflicts, validateInterview,
} from '../src/lib/interviews.ts'

const TODAY = '2026-11-18'

test('material status follows the sheet: received, overdue, D-day', () => {
  assert.deepEqual(materialStatus({ stage: '자료 수령', material_due: '2026-11-13', material_note: null }, TODAY), { label: '자료 받음', tone: 'ok' })
  assert.deepEqual(materialStatus({ stage: '인터뷰지 발송', material_due: '2026-11-13', material_note: null }, TODAY), { label: '자료 11/13 지남', tone: 'hot' })
  assert.deepEqual(materialStatus({ stage: '인터뷰지 발송', material_due: '2026-11-19', material_note: '예외' }, TODAY), { label: '자료 11/19 D-1', tone: 'soon' })
  assert.deepEqual(materialStatus({ stage: '답변', material_due: '2026-11-30', material_note: '잠정' }, TODAY), { label: '자료 11/30 D-12', tone: 'plain' })
  assert.equal(materialStatus({ stage: '불가', material_due: null, material_note: '해당 없음' }, TODAY), null)
  assert.equal(daysBetween('2026-11-18', '2026-12-01'), 13)
  assert.equal(mdWithDay('2026-11-20'), '11/20(금)')
  assert.match(todayKst(Date.parse('2026-11-18T16:00:00Z')), /^2026-11-19$/)
})

test('upload conflicts: two or more on the same day, closed rows ignored', () => {
  const rows = [
    { id: 'a', stage: '자료 수령' as const, upload_on: '2026-11-20' },
    { id: 'b', stage: '인터뷰지 발송' as const, upload_on: '2026-11-20' },
    { id: 'c', stage: '인터뷰지 발송' as const, upload_on: '2026-11-20' },
    { id: 'd', stage: '불가' as const, upload_on: '2026-11-25' },
    { id: 'e', stage: '답변' as const, upload_on: '2026-11-25' },
  ]
  const clash = uploadConflicts(rows)
  assert.deepEqual([...clash.keys()], ['2026-11-20'])
  assert.deepEqual(clash.get('2026-11-20'), ['a', 'b', 'c'])
})

test('mail signals from the automatic mail check', () => {
  const base = { stage: '인터뷰지 발송' as const, form_sent_at: '2026-11-11T01:00:00Z', mail_last_in_at: null, mail_last_out_at: null, mail_attach_at: null }
  assert.equal(mailSignal(base), null)
  assert.deepEqual(mailSignal({ ...base, mail_attach_at: '2026-11-17T04:55:00Z' }), { label: '첨부 메일 도착', tone: 'ok' })
  assert.equal(mailSignal({ ...base, mail_attach_at: '2026-11-10T04:55:00Z' }), null, 'attachments before the questionnaire do not count')
  assert.deepEqual(mailSignal({ ...base, stage: '답변', mail_last_in_at: '2026-11-18T02:30:00Z', mail_last_out_at: '2026-11-17T02:30:00Z' }), { label: '브랜드 메일 · 답장 필요', tone: 'hot' })
  assert.equal(mailSignal({ ...base, stage: '답변', mail_last_in_at: '2026-11-17T02:30:00Z', mail_last_out_at: '2026-11-18T02:30:00Z' }), null)
  assert.equal(mailSignal({ ...base, stage: '업로드 완료', mail_last_in_at: '2026-11-18T02:30:00Z' }), null)
})

test('pasting a response row from the sheet fills Q1..Q10', () => {
  const qs = Array.from({ length: 10 }, (_, i) => `답 ${i + 1}`)
  const withMeta = ['11/9 15:53', '팬시그널 립밤 팝업', ...qs].join('\t')
  const a = answersFromPaste(withMeta)
  assert.equal(a.stamp, '11/9 15:53')
  assert.equal(Object.keys(a.answers).length, 10)
  assert.equal(a.answers.Q10, '답 10')
  // a cell with line breaks is quoted by the spreadsheet, quotes inside are doubled
  const multi = ['11/10 11:45', '쿠쿠스페이스', '"첫 줄\n둘째 줄 ""인용"""', '', '1,500만원 미만', ...qs.slice(3)].join('\t')
  const b = answersFromPaste(multi + '\r\n')
  assert.equal(b.answers.Q1, '첫 줄\n둘째 줄 "인용"')
  assert.equal(b.answers.Q2, undefined, 'empty answers are skipped')
  assert.equal(b.answers.Q3, '1,500만원 미만')
  const only = answersFromPaste(qs.join('\t'))
  assert.equal(only.stamp, null)
  assert.equal(only.answers.Q1, '답 1')
  assert.equal(INTERVIEW_QUESTIONS.filter(q => q.use === '영업').map(q => q.no).join(), 'Q3,Q10')
})

test('drafts: new rows, cleaning and validation', () => {
  const d = emptyInterview(TODAY)
  assert.equal(d.batch, '11월 발송')
  assert.equal(d.stage, '발송')
  assert.deepEqual(Object.keys(d).sort(), [...DRAFT_KEYS].sort(), 'the editor sends exactly the editable columns')
  assert.equal(validateInterview(d), '브랜드 이름을 적어 주세요.')
  assert.equal(validateInterview({ ...d, brand: '메이드바이', form_url: 'javascript:alert(1)' }), '인터뷰지 · 게시 링크는 https:// 로 시작하는 주소만 넣을 수 있습니다.')
  assert.equal(validateInterview({ ...d, brand: '메이드바이', form_url: 'https://forms.gle/x' }), null)
  const c = cleanDraft({ ...d, brand: '  메이드바이 ', note: '  ', answers: { Q1: ' 답 ', Q2: '' }, sales_info: { budget: '1,500만원 미만', region: ' ' } })
  assert.equal(c.brand, '메이드바이')
  assert.equal(c.note, null)
  assert.deepEqual(c.answers, { Q1: '답' })
  assert.deepEqual(c.sales_info, { budget: '1,500만원 미만' })
  assert.equal(toLocalInput('2026-11-09T08:28:00Z'), '2026-11-09T17:28')
  assert.equal(fromLocalInput('2026-11-09T17:28'), '2026-11-09T17:28:00+09:00')
  assert.equal(fromLocalInput(''), null)
  const order = [{ upload_on: null, material_due: null, brand: '가' }, { upload_on: '2026-11-20', material_due: null, brand: '나' }, { upload_on: '2026-11-19', material_due: null, brand: '다' }]
  assert.deepEqual(order.sort(byUpload).map(r => r.brand), ['다', '나', '가'])
  assert.deepEqual(ACTIVE_STAGES, ['답변', '인터뷰지 발송', '자료 수령', '제작'])
})

test('the interview table keeps sheet data out of the repo and never sends mail', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261118153500_sales_interviews.sql', import.meta.url), 'utf8')
  const code = sql.replace(/--.*$/gm, '')
  // no customer data in the public repository (imported as data only)
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(code.replace(/\[A-Za-z0-9[^']*'/g, '')), 'no e-mail addresses in the migration')
  assert.ok(!/insert into public\.sales_interviews/i.test(code))
  // members read and edit, only admins delete; anonymous users get nothing
  assert.ok(code.includes('create policy sales_interviews_delete on public.sales_interviews for delete using ((select public.is_admin()))'))
  assert.ok(code.includes('revoke all on table public.sales_interviews from anon'))
  // reads the synced mailbox only: drafts, our own inbound and auto replies are skipped
  assert.ok(code.includes("not ('DRAFT' = any (m.labels))"))
  assert.ok(code.includes("split_part(lower(m.from_addr), '@', 2) <> 'thewklyn.com'"))
  assert.ok(/자동 \?응답/.test(code))
  assert.ok(!/net\.http_|send_message|gmail/i.test(code))
  // alerts only to the person in charge, in working hours, once per key
  assert.ok(code.includes("v_key is distinct from r.mail_alert_key and not v_quiet"))
  assert.ok(code.includes("perform public.notify(r.owner_id, '알람'"))
  for (const m of code.matchAll(/v_title := ([^;]+);/g)) assert.ok(!/금액|예산|원'/.test(m[1]), m[1])
  // no destructive statements (they need an extra confirmation when applied)
  assert.ok(!/\bdrop\s+(table|function|trigger|policy)\b/i.test(code))
  assert.ok(code.includes("('interview_mail', '서면 인터뷰 메일 확인', 'private.sales_interview_mail_tick()', 10, 10, true)"))
})

test('the screen sends no mail and keeps the sheet tabs', async () => {
  const src = await readFile(new URL('../src/components/SalesInterviews.tsx', import.meta.url), 'utf8')
  assert.ok(!/functions\.invoke|fetch\(|sendMail|mailto:/i.test(src))
  for (const label of ['진행 현황', '업로드 일정', '발송 전체', '인터뷰 답', '영업 정보']) assert.ok(src.includes(`'${label}'`), label)
  const page = await readFile(new URL('../src/pages/Sales.tsx', import.meta.url), 'utf8')
  assert.ok(page.indexOf('<SalesInquiries />') < page.indexOf('<SalesInterviews />'))
})

test('content drafts never carry the internal answers (budget, partner criteria)', () => {
  const r = {
    brand: '덴티스테', event_name: '미니무비 촬영소', venue: '홍대 프로타주 갤러리 · 11/6~11/29', note: '태그 @luvdentiste. 게시 전 초안 확인 요청.',
    answers: { Q1: '피부과 전문의와 만든 브랜드입니다. 두 번째 문장입니다.', Q3: '5,000만원 이상', Q4: '포토존을 가장 크게 두었습니다.', Q10: '파트너는 IP 이해도를 봅니다.' },
  }
  const t = interviewContentText(r)
  for (const text of [t.original, t.instagram, t.blog]) {
    assert.ok(!text.includes('5,000만원'), 'budget stays internal')
    assert.ok(!text.includes('IP 이해도'), 'partner criteria stay internal')
  }
  assert.ok(t.original.includes('포토존을 가장 크게'))
  assert.ok(t.instagram.includes('@luvdentiste'))
  assert.ok(t.instagram.startsWith('[더위클리 팝업 큐레이션] 덴티스테'))
  assert.equal(t.title, '[인터뷰 피드] 덴티스테 · 미니무비 촬영소')
  assert.ok(t.tags.includes('#덴티스테'))
  assert.ok(!/\n\n\n/.test(t.instagram), 'no double blank lines')
  const empty = interviewContentText({ brand: '빈 브랜드', event_name: null, venue: null, note: null, answers: {} })
  assert.ok(empty.original.length > 0, 'the content item always has an original text')
})

test('interview feed: prospects once, content link, tab in ads', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261118161500_sales_interview_feed.sql', import.meta.url), 'utf8')
  const code = sql.replace(/--.*$/gm, '')
  assert.ok(code.includes('add column if not exists content_id uuid references public.growth_items (id) on delete set null'))
  assert.ok(code.includes("'서면 인터뷰', s.id::text"))
  assert.ok(code.includes('on conflict (source, source_key) do nothing'))
  assert.ok(code.includes("s.stage not in ('불가', '보류')"))
  assert.ok(!/\bdrop\s+(table|function|trigger|policy|column)\b/i.test(code))
  assert.ok(!/net\.http_|send_message|gmail/i.test(code))
  assert.ok(code.includes("('interview_prospects', '서면 인터뷰 → 영업 후보', 'private.sales_interview_prospects()', 10, 10, true)"))
  const ads = await readFile(new URL('../src/pages/Ads.tsx', import.meta.url), 'utf8')
  assert.ok(ads.includes("['interview', '인터뷰 피드']") && ads.includes("tabs: ['content', 'interview']"))
  const feed = await readFile(new URL('../src/components/InterviewFeed.tsx', import.meta.url), 'utf8')
  assert.ok(feed.includes('interviewContentText(r)'))
  assert.ok(!/functions\.invoke|runGrowthAi|fetch\(|mailto:/i.test(feed), 'no AI calls or mail from the feed')
  const growth = await readFile(new URL('../src/components/GrowthWorkspace.tsx', import.meta.url), 'utf8')
  assert.ok(growth.includes("router.query.get('item')"))
})

test('한 화면 보기 · 비교: 줄 구성 · 다른 것만 · 문항별', async () => {
  const { compareLines, filterLines, answersFor, completeness } = await import('../src/lib/interviews.ts')
  const a = { id: 'a', brand: 'A', stage: '자료 수령', event_name: '성수 팝업', venue: '성수', sent_on: '2026-11-01', replied_at: null, material_due: null, upload_on: null, post_url: null, note: null, image_use: null, answers: { Q1: '공간', Q3: '5천' }, sales_info: { budget: '5천' } }
  const b = { ...a, id: 'b', brand: 'B', venue: '한남', answers: { Q1: '공간', Q2: '1만 명' }, sales_info: {} }
  const lines = compareLines([a, b] as never)
  assert.equal(lines.filter(l => l.group === '인터뷰 답').length, 10)
  assert.equal(lines.find(l => l.key === 'Q3')?.sales, true)
  const diff = filterLines(lines, 'diff').map(l => l.key)
  assert.ok(diff.includes('venue') && diff.includes('Q2') && diff.includes('Q3'))
  assert.ok(!diff.includes('Q1') && !diff.includes('stage') && !diff.includes('Q4'))
  assert.ok(filterLines(lines, 'filled').some(l => l.key === 'Q1'))
  assert.deepEqual(answersFor([a, b] as never, 'Q2').map(x => x.row.id), ['b'])
  assert.deepEqual(completeness(a as never), { answers: 2, sales: 1 })
})
