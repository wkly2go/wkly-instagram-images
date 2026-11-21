import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adFreshness, adPeriod, inquiryTotals, parseAdRange, resultLabel, selectAdRows } from '../src/lib/adWorkspace.ts'

test('지원하는 URL 기간만 해석하고 잘못된 값은 14일로 돌아간다', () => {
  assert.equal(parseAdRange('7'), 7)
  assert.equal(parseAdRange('14'), 14)
  assert.equal(parseAdRange('30'), 30)
  assert.equal(parseAdRange('month'), 'month')
  for (const value of [null, '', '0', '-7', '15', '007', '7days', ' 7 ', 'Month', 'Infinity']) {
    assert.equal(parseAdRange(value), 14)
  }
})

test('연도와 월 경계를 넘는 최근 7일은 어제까지이며 직전 7일과 비교한다', () => {
  assert.deepEqual(adPeriod('2026-01-03', 7), {
    from: '2025-12-27', to: '2026-01-02', previousFrom: '2025-12-20',
    days: ['2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'],
  })
})

test('14일과 30일의 비교 구간도 선택 기간과 같은 길이를 가진다', () => {
  const fortnight = adPeriod('2026-11-11', 14)
  assert.equal(fortnight.from, '2026-10-28')
  assert.equal(fortnight.to, '2026-11-10')
  assert.equal(fortnight.previousFrom, '2026-10-14')
  assert.equal(fortnight.days.length, 14)
  const monthLength = adPeriod('2026-11-11', 30)
  assert.equal(monthLength.from, '2026-10-12')
  assert.equal(monthLength.to, '2026-11-10')
  assert.equal(monthLength.previousFrom, '2026-09-12')
  assert.equal(monthLength.days.length, 30)
})

test('윤년의 2월 29일을 포함하며 평년에는 존재하지 않는 날짜를 만들지 않는다', () => {
  const leap = adPeriod('2028-03-01', 7)
  assert.equal(leap.from, '2028-02-23')
  assert.equal(leap.to, '2028-02-29')
  assert.equal(leap.previousFrom, '2028-02-16')
  assert.equal(leap.days.length, 7)
  assert.equal(leap.days.at(-1), '2028-02-29')
  const ordinary = adPeriod('2029-03-01', 7)
  assert.equal(ordinary.from, '2029-02-22')
  assert.equal(ordinary.to, '2029-02-28')
  assert.equal(ordinary.days.length, 7)
  assert.ok(!ordinary.days.includes('2029-02-29'))
})

test('이번 달은 1일부터 어제까지만 집계하고 경과한 일수만큼 앞 기간과 비교한다', () => {
  const period = adPeriod('2028-03-15', 'month')
  assert.equal(period.from, '2028-03-01')
  assert.equal(period.to, '2028-03-14')
  assert.equal(period.previousFrom, '2028-02-16')
  assert.equal(period.days.length, 14)
  assert.equal(period.days[0], '2028-03-01')
  assert.equal(period.days.at(-1), '2028-03-14')
})

test('매월 1일의 이번 달 집계에는 전월이나 오늘 기록이 섞이지 않는다', () => {
  const period = adPeriod('2026-05-01', 'month')
  assert.deepEqual(period, { from: '2026-05-01', to: '2026-04-30', previousFrom: '2026-05-01', days: [] })
  assert.deepEqual(selectAdRows([
    { date: '2026-04-30', platform: 'naver' },
    { date: '2026-05-01', platform: 'naver' },
  ], period.from, period.to, null), [])
})

test('기간의 양끝과 선택 매체만 포함하고 오늘·이전 기간 기록을 제외한다', () => {
  const rows = [
    { id: 'before', date: '2026-11-03', platform: 'naver' },
    { id: 'start', date: '2026-11-04', platform: 'naver' },
    { id: 'other', date: '2026-11-05', platform: 'google' },
    { id: 'end', date: '2026-11-10', platform: 'naver' },
    { id: 'today', date: '2026-11-11', platform: 'naver' },
  ]
  assert.deepEqual(selectAdRows(rows, '2026-11-04', '2026-11-10', 'naver').map(row => row.id), ['start', 'end'])
  assert.deepEqual(selectAdRows(rows, '2026-11-04', '2026-11-10', null).map(row => row.id), ['start', 'other', 'end'])
  assert.deepEqual(selectAdRows(rows, '2026-11-04', '2026-11-10', 'meta'), [])
})

test('0원·0노출 기록도 보존하며 필터가 원본 데이터나 순서를 바꾸지 않는다', () => {
  const zero = { date: '2026-11-10', platform: 'naver', cost: 0, impressions: 0, clicks: 0 }
  const earlier = { date: '2026-11-04', platform: 'naver', cost: 1000, impressions: 100, clicks: 1 }
  const rows = [zero, earlier]
  const selected = selectAdRows(rows, '2026-11-04', '2026-11-10', 'naver')
  assert.deepEqual(selected, [zero, earlier])
  assert.notEqual(selected, rows)
  assert.equal(selected[0], zero)
  assert.equal(selected[0].cost, 0)
  assert.deepEqual(rows, [zero, earlier])
  assert.deepEqual(selectAdRows([], '2026-11-04', '2026-11-10', null), [])
})

test('전환 칸 이름은 Google 만 전환, 나머지 매체는 문의', () => {
  assert.equal(resultLabel('Google'), '전환')
  assert.equal(resultLabel('Meta'), '문의')
  assert.equal(resultLabel('Naver'), '문의')
  assert.equal(resultLabel('기타'), '문의')
})

test('문의 합계와 문의당 비용에는 Google 전환 · 광고비를 섞지 않는다', () => {
  const rows = [
    { platform: 'Google', cost: 50000, conversions: 40 },
    { platform: 'Meta', cost: 30000, conversions: 2 },
    { platform: 'Naver', cost: 10000, conversions: '2' },
    { platform: 'Meta', cost: null, conversions: null },
  ]
  assert.deepEqual(inquiryTotals(rows), { inquiries: 4, cost: 40000, costPer: 10000, googleConversions: 40 })
})

test('문의가 없으면 문의당 비용은 비워 둔다 (0 으로 나누지 않음)', () => {
  assert.deepEqual(inquiryTotals([{ platform: 'Meta', cost: 12000, conversions: 0 }]), { inquiries: 0, cost: 12000, costPer: null, googleConversions: 0 })
  assert.deepEqual(inquiryTotals([]), { inquiries: 0, cost: 0, costPer: null, googleConversions: 0 })
})

test('마지막 기록이 어제 · 그제면 정상, 그보다 오래되면 멈춘 날 수를 알린다', () => {
  assert.deepEqual(adFreshness(null, '2026-11-21'), { state: 'none' })
  assert.deepEqual(adFreshness('2026-11-20', '2026-11-21'), { state: 'fresh', last: '2026-11-20' })
  assert.deepEqual(adFreshness('2026-11-19', '2026-11-21'), { state: 'fresh', last: '2026-11-19' })
  assert.deepEqual(adFreshness('2026-11-18', '2026-11-21'), { state: 'stale', last: '2026-11-18', gapDays: 2 })
  assert.deepEqual(adFreshness('2026-10-22', '2026-11-21'), { state: 'stale', last: '2026-10-22', gapDays: 29 })
  assert.deepEqual(adFreshness('2025-12-30', '2026-01-02'), { state: 'stale', last: '2025-12-30', gapDays: 2 })
})
