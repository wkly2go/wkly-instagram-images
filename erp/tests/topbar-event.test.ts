import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickTopbarEvent, previewTopbarEvent, seoulToday, EMPTY_TOPBAR_DATA } from '../src/lib/topbarEvent.ts'

const D = EMPTY_TOPBAR_DATA

test('christmas design starts one month before and ends on the day', () => {
  assert.equal(pickTopbarEvent('2026-11-24', D), null)
  const first = pickTopbarEvent('2026-11-25', D)
  assert.equal(first?.theme, 'christmas'); assert.match(first!.title, /D-30/)
  assert.match(pickTopbarEvent('2026-12-24', D)!.title, /이브/)
  assert.match(pickTopbarEvent('2026-12-25', D)!.title, /메리 크리스마스/)
  assert.equal(pickTopbarEvent('2026-12-28', D)?.theme, 'yearend')
  assert.equal(pickTopbarEvent('2027-01-03', D)?.theme, 'newyear')
  assert.equal(pickTopbarEvent('2027-01-08', D), null)
})

test('a teammate birthday wins over every season, and the person sees their own greeting', () => {
  const data = { ...D, birthdays: [{ id: 'a', name: '김하늘' }] }
  const other = pickTopbarEvent('2026-12-10', data, 'me')
  assert.equal(other?.theme, 'birthday'); assert.match(other!.title, /김하늘님 생일/); assert.equal(other!.link, '/chat')
  const mine = pickTopbarEvent('2026-12-10', data, 'a')
  assert.match(mine!.title, /김하늘님, 생일 축하드려요/); assert.equal(mine!.link, undefined)
  const many = pickTopbarEvent('2026-12-10', { ...D, birthdays: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] })
  assert.match(many!.title, /A · B 외 1명/)
})

test('company anniversaries count years and beat work anniversaries', () => {
  const data = { ...D, custom: [{ date: '11-20', title: '더위클리 창립', since: 2025 }], anniversaries: [{ id: 'x', name: '이도윤', years: 2 }] }
  const ev = pickTopbarEvent('2026-11-20', data)
  assert.equal(ev?.theme, 'anniversary'); assert.match(ev!.title, /더위클리 창립 1주년/)
  assert.match(pickTopbarEvent('2026-11-21', { ...D, anniversaries: [{ id: 'x', name: '이도윤', years: 2 }] })!.title, /입사 2주년/)
  // 한 번만 있는 날 (YYYY-MM-DD)
  assert.equal(pickTopbarEvent('2027-03-02', { ...D, custom: [{ date: '2027-03-02', title: '사무실 이전' }] })?.short, '사무실 이전')
  assert.equal(pickTopbarEvent('2028-03-02', { ...D, custom: [{ date: '2027-03-02', title: '사무실 이전' }] }), null)
})

test('lunar holidays show a countdown five days ahead and the holiday greeting', () => {
  assert.equal(pickTopbarEvent('2027-01-31', D), null)
  assert.match(pickTopbarEvent('2027-02-01', D)!.title, /설 연휴까지 D-5/)
  assert.match(pickTopbarEvent('2027-02-07', D)!.title, /설날/)
  assert.equal(pickTopbarEvent('2027-02-09', D)?.theme, 'seollal')
  assert.match(pickTopbarEvent('2028-10-03', D)!.title, /한가위/) // 추석이 개천절보다 먼저
  assert.equal(pickTopbarEvent('2027-10-09', D)?.short, '한글날')
})

test('KST date and previews', () => {
  assert.equal(seoulToday(new Date('2026-11-16T15:30:00Z')), '2026-11-17')
  for (const t of ['birthday', 'christmas', 'newyear', 'yearend', 'seollal', 'chuseok', 'anniversary', 'holiday']) assert.equal(previewTopbarEvent(t, '2026-11-16')?.theme, t)
  assert.equal(previewTopbarEvent('nope', '2026-11-16'), null)
})
