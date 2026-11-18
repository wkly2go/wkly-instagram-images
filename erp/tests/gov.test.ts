import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { daysLeft, ddayLabel, filterGovPrograms, fitFor, govCounts, parseKeywords, type GovProgram } from '../src/lib/gov.ts'

const row = (over: Partial<GovProgram>): GovProgram => ({
  id: 'x', source: 't', title: '공고', org: null, supervising: null, category: null, region: null, target: null, target_detail: null, biz_years: null,
  summary: null, support_content: null, exclude_detail: null, apply_start: null, apply_end: null, detail_url: null, apply_url: null, contact: null,
  fit: '보통', fit_score: 50, fit_company: 'wkly', fits: {}, status: '신규', owner_id: null, decision_note: null, first_seen_at: '2026-11-19T00:00:00Z', ...over,
})

test('마감까지 남은 날과 표시', () => {
  assert.equal(daysLeft('2026-11-22', '2026-11-19'), 3)
  assert.equal(daysLeft(null, '2026-11-19'), null)
  assert.equal(ddayLabel(3), 'D-3')
  assert.equal(ddayLabel(0), '오늘 마감')
  assert.equal(ddayLabel(-1), '마감')
  assert.equal(ddayLabel(null), '상시')
})

test('회사를 고르면 그 회사 판정을, 아니면 높은 쪽을 쓴다', () => {
  const p = row({ fit: '높음', fit_score: 80, fits: { wkly: { fit: '제외', score: 0, note: '지역 제한' }, arterior: { fit: '높음', score: 80, note: null } } })
  assert.equal(fitFor(p, 'wkly').fit, '제외')
  assert.equal(fitFor(p, 'arterior').fit, '높음')
  assert.equal(fitFor(p, null).fit, '높음')
})

test('거르기 · 정렬: 진행 중 먼저, 그다음 판정 · 점수 · 마감 순', () => {
  const list = [
    row({ id: 'a', fit: '높음', fit_score: 70, apply_end: '2026-12-01' }),
    row({ id: 'b', fit: '높음', fit_score: 90, apply_end: '2026-12-20' }),
    row({ id: 'c', fit: '보통', fit_score: 50, status: '검토 중' }),
    row({ id: 'd', fit: '높음', fit_score: 95, status: '마감' }),
    row({ id: 'e', fit: '제외', fit_score: 0 }),
  ]
  assert.deepEqual(filterGovPrograms(list, { company: null, fit: 'all', status: 'open', word: '' }).map(p => p.id), ['c', 'b', 'a', 'e'])
  assert.deepEqual(filterGovPrograms(list, { company: null, fit: '높음', status: 'open', word: '' }).map(p => p.id), ['b', 'a'])
  assert.deepEqual(filterGovPrograms(list, { company: null, fit: 'all', status: '마감', word: '' }).map(p => p.id), ['d'])
  assert.equal(filterGovPrograms([row({ title: '콘텐츠 지원' }), row({ title: '수출 바우처' })], { company: null, fit: 'all', status: 'all', word: '수출' }).length, 1)
})

test('숫자 카드: 새 추천 · 7일 안 마감 · 진행 중', () => {
  const list = [
    row({ fit: '높음', apply_end: '2026-11-21' }),
    row({ fit: '높음', apply_end: '2026-12-30' }),
    row({ fit: '낮음', apply_end: '2026-11-20' }),
    row({ fit: '보통', status: '신청 준비', apply_end: '2026-11-25' }),
    row({ fit: '높음', status: '선정' }),
  ]
  assert.deepEqual(govCounts(list, null, '2026-11-19'), { recommended: 2, active: 1, closingSoon: 2, won: 1 })
})

test('낱말 입력은 쉼표 · 줄바꿈으로 나누고 겹친 것을 뺀다', () => {
  assert.deepEqual(parseKeywords('콘텐츠, 광고\n 광고 ,,팝업'), ['콘텐츠', '광고', '팝업'])
})

test('표는 관리자만 보고, 회사 서류 자료는 저장소에 넣지 않는다', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261119013000_gov_programs.sql', import.meta.url), 'utf8')
  assert.match(sql, /create policy gov_programs_select[^;]+is_admin\(\)/)
  assert.match(sql, /create policy gov_companies_select[^;]+is_admin\(\)/)
  assert.doesNotMatch(sql, /using \(true\)/)
  assert.doesNotMatch(sql, /insert into public\.gov_companies/)
  assert.match(sql, /p\.title = '대표'/)
  const sample = readFileSync(new URL('../src/dev/govSample.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(sample, /\d{3}-\d{2}-\d{5}/)
})
