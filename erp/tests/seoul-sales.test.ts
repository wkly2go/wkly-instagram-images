import assert from 'node:assert/strict'
import test from 'node:test'
import { compareSeoulAreas, parseSeoulEvents, parseSeoulPopulation, readSeoulCsv } from '../src/lib/seoulSales.ts'

test('official Korean event columns retain dates and source and deduplicate repeated notices', () => {
  const input = [
    '분류,자치구,공연/행사명,장소,기관명,시작일,종료일,문화포털상세URL',
    '전시/미술,중구,"전시, 체험",DDP,기관,2026-11-27,2026-11-29,http://culture.seoul.go.kr/culture/cultureEvent/view.do?cultcode=101',
    '전시/미술,중구,"전시, 체험",DDP,기관,2026-11-27,2026-11-29,http://culture.seoul.go.kr/culture/cultureEvent/view.do?cultcode=101',
    '전시,중구,날짜 미확인,DDP,기관,2026-02-31,,https://example.test/cultureEvent/view.do?cultcode=102',
  ].join('\r\n')
  const rows = parseSeoulEvents(readSeoulCsv(new TextEncoder().encode(input).buffer))
  assert.equal(rows.length, 2)
  assert.equal(rows[0].title, '전시, 체험')
  assert.equal(rows[0].start, '2026-11-27')
  assert.equal(rows[0].id, '101')
  assert.match(rows[0].url, /^https:\/\/culture\.seoul\.go\.kr\//)
  assert.equal(rows[1].start, '')
  assert.equal(rows[1].url, '')
})

test('area comparison uses individual weekday means and requires identical quarter and type', () => {
  const header = ['기준_년분기_코드', '상권_코드', '상권_코드_명', '상권_구분_코드_명', '총_유동인구_수',
    ...['월','화','수','목','금','토','일'].map(day => day + '요일_유동인구_수')]
  const areas = parseSeoulPopulation([header,
    ['20262','3120052','성수역','발달상권','1,455,782','30','20','30','40','50','80','100'],
    ['20262','3120103','홍대입구역','발달상권','4,134,072','50','40','30','40','50','90','100'],
    ['20261','3120052','성수역','발달상권','1000','','','','','','',''],
  ])
  assert.equal(areas[0].weekday, 34)
  assert.equal(areas[0].weekend, 90)
  assert.equal(areas[2].weekday, null)
  assert.match(compareSeoulAreas(areas.slice(0, 2)), /성수역 \(3120052\).*평일 34 \/ 주말 90/)
  assert.throws(() => compareSeoulAreas([areas[0], areas[2]]), /같은 분기/)
  assert.throws(() => compareSeoulAreas([areas[0], { ...areas[1], type: '골목상권' }]), /상권 유형/)
})
