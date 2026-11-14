import assert from 'node:assert/strict'
import test from 'node:test'
import { marketPlan } from '../supabase/functions/sales-api/market.ts'
import { LookupError } from '../supabase/functions/sales-api/lookupTypes.ts'

const key = 'mock+abc/='
const fixture = {
  jsonArray: {
    title: '기업마당 지원사업정보',
    category: 'bizinfo',
    item: [
      {
        pblancId: 'PBLN_000000000000001',
        pblancNm: '서울 팝업스토어 참가 브랜드 모집',
        pblancUrl: 'https://foreign.example/?token=placeholder',
        jrsdInsttNm: '서울특별시',
        excInsttNm: '운영기관',
        reqstBeginEndDe: '20261101 ~ 20261120',
        bsnsSumryCn: '<div>오프라인&nbsp;판촉 지원</div>',
        totCnt: '130',
      },
      { seq: 'PBLN_000000000000002', title: '제조 설비 지원' },
    ],
  },
}

test('기업마당 상권 검색에 공식 파라미터만 보내고 출처와 모집 기간을 반환한다', () => {
  const plan = marketPlan('bizinfo', { region: '서울', keyword: '팝업 판촉', page: 2 }, key)!
  assert.equal(plan.url.origin, 'https://www.bizinfo.go.kr')
  assert.equal(plan.url.pathname, '/uss/rss/bizinfoApi.do')
  assert.equal(plan.url.searchParams.get('crtfcKey'), key)
  assert.equal(plan.url.searchParams.get('dataType'), 'json')
  assert.equal(plan.url.searchParams.get('hashtags'), '서울')
  assert.equal(plan.url.searchParams.get('keyword'), null)
  assert.equal(plan.url.searchParams.get('pageUnit'), '25')
  assert.equal(plan.url.searchParams.get('pageIndex'), '2')

  const result = plan.parse(fixture)
  assert.equal(result.rows.length, 1)
  assert.equal(result.total, 130)
  assert.equal(result.rows[0].url, 'https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_000000000000001')
  assert.ok(result.rows[0].facts.some(fact => fact.label === '신청 기간' && fact.value === '20261101 ~ 20261120'))
  assert.ok(result.rows[0].facts.some(fact => fact.value === '오프라인 판촉 지원'))
})

test('인증 오류를 빈 공고 목록으로 반환하지 않고 비밀값은 노출하지 않는다', () => {
  const plan = marketPlan('bizinfo', {}, key)!
  assert.throws(() => plan.parse({ reqErr: `인증 오류 ${key}` }), error => {
    return error instanceof LookupError && error.status === 502 && !error.message.includes(key)
  })
  assert.throws(() => plan.parse({ jsonArray: {} }), LookupError)
  assert.deepEqual(plan.parse({ jsonArray: { item: [] } }).rows, [])
  const result = plan.parse({ jsonArray: { item: { title: '팝업 모집', description: `지원 안내 ${key}` } } })
  assert.ok(!JSON.stringify(result).includes(key))
})

test('알 수 없는 입력과 과도한 페이지를 공식 서버에 전송하지 않는다', () => {
  assert.equal(marketPlan('youtube', {}, key), null)
  for (const params of [{ page: 11 }, { region: '지원되지 않는 지역' }, { crtfcKey: 'spoofed' }]) {
    assert.throws(() => marketPlan('bizinfo', params, key), LookupError)
  }
})
