import assert from 'node:assert/strict'
import test from 'node:test'
import { localityPlan } from '../supabase/functions/sales-api/locality.ts'

test('Seoul only sends a public sample key and does not pass user search text over HTTP', () => {
  const event = localityPlan('seoulEvents', { sample: true, keyword: '내부 검색 조건' }, 'private-key')!
  assert.equal(event.url.href, 'http://openapi.seoul.go.kr:8088/sample/json/culturalEventInfo/1/5/')
  assert.deepEqual(event.parse({ culturalEventInfo: {
    RESULT: { CODE: 'INFO-000' },
    row: [{ TITLE: '내부 검색 조건 행사', HMPG_ADDR: 'javascript:alert(1)', PLACE: '전시장', private: 'hidden' }, { TITLE: '별도 행사' }],
  } }).rows, [{ title: '내부 검색 조건 행사', facts: [{ label: '장소', value: '전시장' }] }])
  assert.throws(() => localityPlan('seoulEvents', { page: 1 }, 'private-key'), /공개 샘플/)
  assert.throws(() => localityPlan('seoulPopulation', { sample: true, quarter: '../json' }, 'private-key'), /기준 분기/)
  const population = localityPlan('seoulPopulation', { sample: true, quarter: '20262' }, 'private-key')!
  assert.equal(population.url.pathname, '/sample/json/VwsmTrdarFlpopQq/1/5/20262')
  assert.deepEqual(population.parse({ RESULT: { CODE: 'INFO-200' } }).rows, [])
})

test('Kakao uses the provider key only in the authorization header and accepts only Kakao place links', () => {
  const plan = localityPlan('kakao', { keyword: '성수 팝업 & 창고' }, 'private-key')!
  assert.equal(plan.url.hostname, 'dapi.kakao.com')
  assert.equal(plan.url.searchParams.get('query'), '성수 팝업 & 창고')
  assert.ok(!plan.url.href.includes('private-key'))
  assert.deepEqual(plan.headers, { Authorization: 'KakaoAK private-key' })
  const meta = { is_end: true, pageable_count: 2 }
  const docs = [{ place_name: '후보 공간', id: '1', place_url: 'http://place.map.kakao.com/1' },
    { place_name: '다른 공간', id: '2', place_url: 'https://place.map.kakao.com@third.example/path' }]
  const rows = plan.parse({ meta, documents: docs }).rows
  assert.equal(rows[0].url, 'https://place.map.kakao.com/1')
  assert.equal(rows[1].url, undefined)
  assert.throws(() => plan.parse({ documents: [] }), /응답 형식/)
})

test('building lookups constrain the requested parcel and require an explicit successful gateway code', () => {
  const lot = { sigunguCd: '11680', bjdongCd: '10300', bun: '12' }
  const register = localityPlan('buildingRegister', lot, 'abc+/=')!
  assert.equal(register.url.href, 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?sigunguCd=11680&bjdongCd=10300&platGbCd=0&bun=0012&ji=0000&serviceKey=abc%2B%2F%3D&pageNo=1&numOfRows=15&_type=json')
  assert.equal(localityPlan('buildingPermit', lot, 'key')!.url.pathname, '/1613000/ArchPmsHubService/getApBasisOulnInfo')
  assert.throws(() => localityPlan('buildingRegister', { ...lot, bun: '' }, 'key'), /지번/)
  assert.throws(() => register.parse({ response: { header: { resultCode: '30', resultMsg: 'abc+/=' } } }), error =>
    error instanceof Error && /인증키/.test(error.message) && !error.message.includes('abc+/='))
  const rows = register.parse({ response: { header: { resultCode: '00' }, body: {
    items: { item: { bldNm: '공간', totArea: 100, private: 'hidden' } }, totalCount: 1,
  } } }).rows
  assert.deepEqual(rows, [{ title: '공간', facts: [{ label: '연면적(㎡)', value: '100' }] }])
})

test('radius and restaurant period are bounded and regional lookup preserves inclusive end date', () => {
  const district = localityPlan('district', { longitude: '127.05', latitude: 37.55, radius: '500' }, 'key')!
  assert.equal(district.url.pathname, '/B553077/api/open/sdsc2/storeListInRadius')
  assert.equal(district.url.searchParams.get('ServiceKey'), 'key')
  assert.throws(() => localityPlan('district', { longitude: '127.05', latitude: 37.55, radius: 2001 }, 'key'), /반경/)
  const restaurant = localityPlan('restaurant', { address: '서울특별시 성동구', startDate: '2026-03-01', endDate: '2026-03-31' }, 'key')!
  assert.equal(restaurant.url.searchParams.get('cond[LCPMT_YMD::LT]'), '20260401')
  assert.throws(() => localityPlan('restaurant', { keyword: '커피', startDate: '2026-02-30' }, 'key'), /YYYY-MM-DD/)
  assert.throws(() => localityPlan('restaurant', { keyword: '커피', startDate: '2026-01-01', endDate: '2026-04-01' }, 'key'), /90일/)
  const data = { response: { header: { resultCode: '00' }, body: {
    items: { item: [{ BPLC_NM: '테스트 식당', LCPMT_YMD: '20260331', TELNO: '010-0000-0000' }] }, totalCount: 1,
  } } }
  assert.deepEqual(restaurant.parse(data).rows[0], { title: '테스트 식당', facts: [{ label: '인허가일', value: '20260331' }] })
})
