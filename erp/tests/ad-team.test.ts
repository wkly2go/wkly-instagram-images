import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAdSheet, parseAdDate, parseAdNumber } from '../src/lib/adImport.ts'
import { adVerdictTable } from '../src/lib/adVerdict.ts'

test('reads a Meta daily export, merges ad-set rows and skips totals', () => {
  const grid = [
    ['보고 시작', '보고 종료', '캠페인 이름', '노출', '링크 클릭', '지출 금액 (KRW)', '결과'],
    ['2026-11-03', '2026-11-03', '문의전환', '1,200', '30', '₩12,500', '2'],
    ['2026-11-03', '2026-11-03', '문의전환', '300', '5', '2,500', ''],
    ['2026-11-04', '2026-11-04', '팝업', '900', '12', '8000', '--'],
    [null, null, '합계', '2400', '47', '23000', '2'],
  ]
  const r = parseAdSheet(grid)
  assert.equal(r.platform, 'Meta')
  assert.equal(r.rows.length, 2)
  assert.deepEqual(r.rows[0], { date: '2026-11-03', platform: 'Meta', campaign: '문의전환', impressions: 1500, clicks: 35, cost: 15000, conversions: 2 })
  assert.equal(r.rows[1].conversions, 0)
  assert.equal(r.skipped, 1)
})

test('reads Google and Naver headers and rejects a sheet without date or campaign', () => {
  const g = parseAdSheet([['광고 보고서'], ['일', '캠페인', '노출수', '클릭수', '비용', '전환수'], ['2026. 11. 5.', '검색', '100', '9', '4,500', '1.5']])
  assert.equal(g.platform, 'Google')
  assert.equal(g.rows[0].date, '2026-11-05')
  assert.equal(g.rows[0].conversions, 1.5)
  const n = parseAdSheet([['일별', '캠페인', '노출수', '클릭수', '총비용(VAT포함,원)'], ['2026.11.06.', '브랜드', '50', '3', '990']])
  assert.equal(n.platform, 'Naver')
  assert.equal(n.rows[0].cost, 990)
  assert.match(parseAdSheet([['이름', '값'], ['a', '1']]).reason ?? '', /날짜/)
  assert.equal(parseAdSheet([['date', 'campaign', 'clicks'], ['11/7/26', 'x', '3']]).platform, null)
  assert.equal(parseAdSheet([['date', 'campaign', 'clicks'], ['11/7/26', 'x', '3']], '기타').rows[0].date, '2026-11-07')
})

test('date and number parsing', () => {
  assert.equal(parseAdDate('2026년 11월 3일'), '2026-11-03')
  assert.equal(parseAdDate('Nov 3, 2026'), '2026-11-03')
  assert.equal(parseAdDate('합계'), null)
  assert.equal(parseAdNumber('₩1,234원'), 1234)
  assert.equal(parseAdNumber('--'), 0)
})

test('weekly verdicts compare each campaign with its platform average', () => {
  const row = (date: string, campaign: string, impressions: number, clicks: number, cost: number) => ({ date, platform: 'Google' as const, campaign, impressions, clicks, cost, conversions: 0, note: null, updated_at: '' })
  const t = adVerdictTable([
    row('2026-11-10', '좋음', 1000, 80, 8000), row('2026-11-10', '보통', 1000, 40, 8000), row('2026-11-10', '나쁨', 1000, 5, 9000),
    row('2026-11-10', '클릭없음', 500, 0, 3000), row('2026-11-02', '지난주만', 100, 5, 1000),
  ])
  assert.equal(t.to, '2026-11-10')
  assert.equal(t.from, '2026-11-04')
  const v = Object.fromEntries(t.rows.map(r => [r.campaign, r.verdict]))
  assert.deepEqual(v, { 좋음: '증액 후보', 보통: '유지', 나쁨: '중단 후보', 클릭없음: '중단 후보', 지난주만: '집행 없음' })
  assert.equal(t.rows.find(r => r.campaign === '지난주만')!.prevCost, 1000)
  assert.deepEqual(adVerdictTable([]).rows, [])
})
