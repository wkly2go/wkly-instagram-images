import assert from 'node:assert/strict'
import test from 'node:test'
import { procurementPlan } from '../supabase/functions/sales-api/procurement.ts'
import { LookupError } from '../supabase/functions/sales-api/lookupTypes.ts'

const service = { category: 'service', startDate: '2026-11-08', endDate: '2026-11-14' }
const key = 'fixture+/='

function envelope(items: unknown, totalCount = 1, pageNo = 1) {
  return { response: { header: { resultCode: '00' }, body: { items, totalCount, pageNo, numOfRows: 20 } } }
}

test('pre-specification filters by received date and product name; retains document link and budget', () => {
  const plan = procurementPlan('preSpec', { ...service, keyword: '팝업 & 전시' }, key)!
  assert.equal(plan.url.origin, 'https://apis.data.go.kr')
  assert.equal(plan.url.pathname, '/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServcPPSSrch')
  assert.equal(plan.url.searchParams.get('serviceKey'), key)
  assert.equal(plan.url.searchParams.get('prdctClsfcNoNm'), '팝업 & 전시')
  assert.equal(plan.url.searchParams.get('inqryBgnDt'), '202611080000')
  assert.equal(plan.url.searchParams.get('inqryEndDt'), '202611142359')
  const url = 'https://www.g2b.go.kr/pn/pnz/pnza/UntyAtchFile/downloadFile.do?bfSpecRegNo=R25BD00086379&fileType=BFDTL&fileSeq=1'
  const result = plan.parse(envelope([{ bfSpecRgstNo: 'R25BD00086379', prdctClsfcNoNm: '전시 지원 용역', asignBdgtAmt: '118628232', specDocFileUrl1: url, ofclTelNo: 'excluded' }]))
  assert.deepEqual(result.rows, [{ id: 'R25BD00086379', title: '전시 지원 용역', facts: [
    { label: '사전규격 번호', value: 'R25BD00086379' }, { label: '배정예산', value: '118,628,232원' },
  ], url }])
})

test('order plan supplies both month and publication ranges required by the provider', () => {
  const plan = procurementPlan('orderPlan', { ...service, orderStartMonth: '2026-11', orderEndMonth: '2027-02', keyword: '홍보관' }, key)!
  assert.match(plan.url.pathname, /getOrderPlanSttusListServcPPSSrch$/)
  assert.equal(plan.url.searchParams.get('orderBgnYm'), '202611')
  assert.equal(plan.url.searchParams.get('orderEndYm'), '202702')
  assert.equal(plan.url.searchParams.get('inqryEndDt'), '202611142359')
  assert.equal(plan.url.searchParams.get('bizNm'), '홍보관')
  const result = plan.parse(envelope({ item: { orderPlanUntyNo: 'R26DD20688643', bizNm: '홍보관 운영', orderYear: '2027', orderMnth: '2', orderPlanDtlUrl: 'https://www.g2b.go.kr.evil.test/?token=x' } }))
  assert.ok(result.rows[0].facts.some(f => f.label === '발주 예정월' && f.value === '2027-02'))
  assert.equal(result.rows[0].url, undefined)
})

test('contract process uses exact bid number and round without exposing delimited contact records', () => {
  const plan = procurementPlan('contractProcess', { category: 'construction', number: 'R26BK01800586', round: '000' }, key)!
  assert.match(plan.url.pathname, /getCntrctProcssIntgOpenCnstwk$/)
  assert.equal(plan.url.searchParams.get('inqryDiv'), '1')
  assert.equal(plan.url.searchParams.get('bidNtceNo'), 'R26BK01800586')
  assert.equal(plan.url.searchParams.get('bidNtceOrd'), '000')
  const result = plan.parse(envelope([{ bidNtceNo: 'R26BK01800586', bidNtceOrd: '000', bidNtceNm: '전시 공간 리뉴얼', bfSpecRgstNo: 'R26BD00000001', bidwinrInfoList: '[1^회사^개인명]', cntrctInfoList: '[]' }]))
  assert.ok(result.rows[0].facts.some(f => f.label === '낙찰 정보' && f.value === '관련 기록 있음'))
  assert.doesNotMatch(JSON.stringify(result), /개인명|계약 정보"/)
})

test('award uses opening date and contract uses signing date and its construction title field', () => {
  const award = procurementPlan('award', { ...service, keyword: '행사' }, key)!
  assert.match(award.url.pathname, /getScsbidListSttusServcPPSSrch$/)
  assert.equal(award.url.searchParams.get('inqryDiv'), '2')
  assert.equal(award.url.searchParams.get('bidNtceNm'), '행사')
  const awardResult = award.parse(envelope([{ bidNtceNo: 'R26BK01800586', bidNtceNm: '행사 기획', bidwinnrNm: '전시회사', sucsfbidAmt: '38832000' }]))
  assert.ok(awardResult.rows[0].facts.some(f => f.label === '최종 낙찰금액' && f.value === '38,832,000원'))

  const contract = procurementPlan('contract', { ...service, category: 'construction', keyword: '전시' }, key)!
  assert.match(contract.url.pathname, /getCntrctInfoListCnstwkPPSSrch$/)
  assert.equal(contract.url.searchParams.get('inqryEndDate'), '20261114')
  assert.equal(contract.url.searchParams.get('cnstwkNm'), '전시')
  const contractResult = contract.parse(envelope([{ untyCntrctNo: '2016070113289', cnstwkNm: '전시장 공사', thtmCntrctAmt: 97000000, cntrctDtlInfoUrl: 'https://www.g2b.go.kr:8067/contract/contDetail.jsp?Union_number=2016070113289' }]))
  assert.equal(contractResult.rows[0].title, '전시장 공사')
  assert.match(contractResult.rows[0].url!, /:8067/)
  assert.ok(contractResult.rows[0].facts.some(f => f.label === '금차 계약금액' && f.value === '97,000,000원'))
})

test('invalid calendar ranges, categories, months and pages do not produce a request', () => {
  assert.throws(() => procurementPlan('preSpec', { ...service, startDate: '2026-11-07' }, key), /최대 7일/)
  assert.throws(() => procurementPlan('award', { ...service, endDate: '2026-11-31' }, key), /최대 7일/)
  assert.throws(() => procurementPlan('contract', { ...service, category: 'goods' }, key), /용역 또는 공사/)
  assert.throws(() => procurementPlan('contract', { ...service, page: 21 }, key), /페이지/)
  assert.throws(() => procurementPlan('contractProcess', { category: 'service', number: '/elsewhere' }, key), /공고번호/)
  assert.throws(() => procurementPlan('orderPlan', { ...service, orderStartMonth: '2026-13', orderEndMonth: '2027-01' }, key), /시작월/)
  assert.throws(() => procurementPlan('orderPlan', { ...service, orderStartMonth: '2026-11', orderEndMonth: '2027-11' }, key), /최대 12개월/)
  assert.equal(procurementPlan('constructor', {}, key), null)
})

test('upstream rejection, empty results, incomplete pages and malformed records remain distinguishable', () => {
  const plan = procurementPlan('award', service, key)!
  assert.throws(() => plan.parse({ response: { header: { resultCode: '30', resultMsg: key } } }), error =>
    error instanceof LookupError && error.status === 503 && !error.message.includes(key))
  assert.deepEqual(plan.parse(envelope('', 0)).rows, [])
  assert.throws(() => plan.parse(envelope([], 2)), /형식 또는 개수/)
  assert.throws(() => plan.parse(envelope([{ unexpected: 1 }])), /사업 정보를 찾지/)
})
