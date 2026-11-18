import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEMO_INTERVIEW_QUESTIONS, buildForm, contextOf, shareText, checkAnswers, fillTemplate, formProblems, pickQuestions, shortAnswers, unfilled, type BankQuestion } from '../src/lib/interviewForms.ts'

const q = (slot: string, over: Partial<BankQuestion> = {}): BankQuestion => ({ id: `${slot}-${over.variant ?? '기본'}`, slot, section: '구역', title: slot, body: `{브랜드} ${slot} 질문`, help: '', kind: 'long', options: [], use: '콘텐츠', required: false, variant: '기본', is_default: true, active: true, sort: 1, ...over })
const bank = [q('Q10', { required: true, use: '영업' }), q('Q1'), q('Q3', { kind: 'choice', options: ['1억원 이상', '1,500만원 미만'], use: '영업' }), q('Q1', { variant: '콜라보', is_default: false, body: '{브랜드}와 협업 브랜드 소개' })]
const ctx = { brand: '덴티스테', popup: '미니무비 촬영소', period: '11월 6일~29일', place: '프로타주 갤러리' }

test('placeholders are filled, and missing values stay visible instead of vanishing', () => {
  assert.equal(fillTemplate('{기간} {장소}에서 여는 {팝업}', ctx), '11월 6일~29일 프로타주 갤러리에서 여는 미니무비 촬영소')
  assert.equal(fillTemplate('{브랜드}의 {팝업}', { ...ctx, popup: '' }), '덴티스테의 {팝업}')
  assert.deepEqual(unfilled('{팝업} 과 {팝업} · {장소}'), ['{팝업}', '{장소}'])
  // 토씨는 받침에 맞춘다 · 한글로 끝나지 않으면 그대로 · 빈 값이면 자리 표시와 함께 남긴다
  assert.equal(fillTemplate('{브랜드}은(는) {팝업}을(를) 열고 {장소}과(와)', { ...ctx, place: '성수' }), '덴티스테는 미니무비 촬영소를 열고 성수와')
  assert.equal(fillTemplate('{브랜드}은(는) {팝업}을(를)', { ...ctx, brand: '삼성', popup: '팝업' }), '삼성은 팝업을')
  assert.equal(fillTemplate('{브랜드}은(는) {팝업}이(가)', { ...ctx, brand: 'LF', popup: '' }), 'LF은(는) {팝업}이(가)')
})

test('one question per slot in order: the default unless another wording is picked', () => {
  assert.deepEqual(pickQuestions(bank).map(x => x.id), ['Q1-기본', 'Q3-기본', 'Q10-기본'])
  assert.equal(pickQuestions(bank, { Q1: 'Q1-콜라보' })[0].id, 'Q1-콜라보')
  assert.equal(pickQuestions(bank.map(x => (x.id === 'Q1-기본' ? { ...x, active: false } : x)))[0].id, 'Q1-콜라보')
})

test('a form draft carries the filled wording, dates and a title; problems are listed before sending', () => {
  const f = buildForm(ctx, bank, { dueOn: '2026-11-12', uploadOn: '2026-11-14' })
  assert.equal(f.title, '[더위클리] 덴티스테 팝업 큐레이션 콘텐츠 인터뷰지')
  assert.doesNotMatch(f.intro, /2026/)
  assert.deepEqual([f.due_on, f.upload_on], ['2026-11-12', '2026-11-14'])
  assert.equal(f.questions[0].body, '덴티스테 Q1 질문')
  assert.deepEqual(formProblems(f), [])
  const bad = buildForm({ ...ctx, brand: '' }, bank)
  assert.ok(formProblems(bad).some(m => m.includes('{브랜드}')))
  assert.ok(formProblems({ ...f, questions: [{ ...f.questions[1], options: ['하나'] }] }).some(m => m.includes('보기가 2개')))
  assert.ok(formProblems({ ...f, questions: [{ ...f.questions[0], body: 'LF은(는) 어떤 브랜드인가요?' }] }).some(m => m.includes('토씨')))
})

test('answers follow the server rules: required, choices, length, unknown keys dropped', () => {
  const qs = buildForm(ctx, bank).questions
  assert.deepEqual(checkAnswers(qs, { Q1: '소개' }), { ok: false, no: 'Q10', message: 'Q10 문항은 필수입니다. 답을 적어 주세요.' })
  assert.equal(checkAnswers(qs, { Q3: '아무거나', Q10: '기준' }).ok, false)
  assert.equal(checkAnswers(qs, { Q10: 'x'.repeat(5001) }).ok, false)
  assert.deepEqual(checkAnswers(qs, { Q1: ' 소개 ', Q3: '1억원 이상', Q10: '기준', Q99: '무시' }), { ok: true, answers: { Q1: '소개', Q3: '1억원 이상', Q10: '기준' } })
  assert.deepEqual(shortAnswers(qs, { Q1: '짧은 답', Q3: '1억원 이상', Q10: 'x'.repeat(150) }), ['Q1'])
})

test('migration: outsiders reach a form only through the two token functions', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261119004500_sales_interview_forms.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /\bdrop\s/i)
  assert.match(sql, /revoke all on table public\.sales_interview_questions, public\.sales_interview_forms from anon/)
  assert.match(sql, /grant execute on function public\.interview_form_get\(text\) to anon, authenticated/)
  assert.match(sql, /q - 'use'/)
  assert.match(sql, /if f\.status = '닫힘' then return/)
})

test('the built-in default wording is the same text the migration seeds', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261119004500_sales_interview_forms.sql', import.meta.url), 'utf8')
  assert.equal(DEMO_INTERVIEW_QUESTIONS.length, 10)
  for (const q of DEMO_INTERVIEW_QUESTIONS) assert.ok(sql.includes(`('${q.slot}', '${q.section}', '${q.title}', '${q.body}'`), q.slot)
  const f = buildForm({ brand: '덴티스테', popup: '미니무비 촬영소', period: '11월 6일~29일', place: '프로타주 갤러리' }, DEMO_INTERVIEW_QUESTIONS)
  assert.deepEqual(formProblems(f), [])
  assert.deepEqual(f.questions.filter(x => x.required).map(x => x.no), ['Q10'])
  assert.deepEqual(f.questions.filter(x => x.use === '영업').map(x => x.no), ['Q3', 'Q10'])
})

test('place and period are read out of the one venue field; the share text carries the link and the due date', () => {
  assert.deepEqual(contextOf({ brand: ' 덴티스테 ', event_name: '미니무비 촬영소', venue: '프로타주 갤러리 성수 · 11/6~11/29' }), { brand: '덴티스테', popup: '미니무비 촬영소', period: '11/6~11/29', place: '프로타주 갤러리 성수' })
  assert.deepEqual(contextOf({ brand: 'A', event_name: null, venue: null }), { brand: 'A', popup: '', period: '', place: '' })
  const text = shareText({ title: '[더위클리] A 인터뷰지', due_on: '2026-11-12' }, 'https://wkly-erp.pages.dev/i/abc')
  assert.match(text, /^\[더위클리\] A 인터뷰지\n\n아래 링크/)
  assert.match(text, /https:\/\/wkly-erp\.pages\.dev\/i\/abc\n\n답변 수령 희망일: 2026\.11\.12$/)
})

test('the question bank lives in the admin-only menu, and only admins can change its wording', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261119011500_interview_questions_admin.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /\bdrop\s/i)
  assert.match(sql, /as restrictive for insert to authenticated\s+with check \(\(select public\.is_admin\(\)\)\)/)
  assert.match(sql, /as restrictive for update to authenticated\s+using \(\(select public\.is_admin\(\)\)\)/)
  const shell = readFileSync(new URL('../src/components/Shell.tsx', import.meta.url), 'utf8')
  assert.match(shell, /key: 'interviewQuestions', label: '인터뷰 질문 은행', path: '\/interview-questions', admin: true/)
  assert.match(shell, /label: '관리자 전용', tabs: \[[^\]]*'interviewQuestions'/)
  assert.doesNotMatch(readFileSync(new URL('../src/components/SalesInterviews.tsx', import.meta.url), 'utf8'), /질문 은행'\]/)
})
