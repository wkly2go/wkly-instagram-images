import { LookupError, type SalesLookupPlan, type SalesLookupResult, type SalesLookupRow } from './lookupTypes.ts'

const pageSize = 20
const routes = {
  preSpec: ['ao/HrcspSsstndrdInfoService', 'getPublicPrcureThngInfo', 'PPSSrch'],
  orderPlan: ['ao/OrderPlanSttusService', 'getOrderPlanSttusList', 'PPSSrch'],
  contractProcess: ['ao/CntrctProcssIntgOpenService', 'getCntrctProcssIntgOpen', ''],
  award: ['as/ScsbidInfoService', 'getScsbidListSttus', 'PPSSrch'],
  contract: ['ao/CntrctInfoService', 'getCntrctInfoList', 'PPSSrch'],
} as const

type Source = keyof typeof routes
type RecordValue = Record<string, unknown>
const object = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null

function cell(value: unknown, max = 400): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
}

function optionalFilter(value: unknown, label: string): string {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new LookupError(`${label}을 100자 이내로 입력해 주세요.`)
  }
  return value.trim()
}

function dateValue(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN
}

function dateRange(startDate: unknown, endDate: unknown): [string, string] {
  const start = dateValue(startDate), end = dateValue(endDate)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 6 * 86400000) {
    throw new LookupError('조회 기간은 시작일과 종료일을 포함해 최대 7일입니다.')
  }
  return [(startDate as string).replaceAll('-', ''), (endDate as string).replaceAll('-', '')]
}

function monthRange(startMonth: unknown, endMonth: unknown): [string, string] {
  const valid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)
  if (!valid(startMonth) || !valid(endMonth) || endMonth < startMonth) {
    throw new LookupError('발주 예정 시작월과 종료월을 확인해 주세요.')
  }
  const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5))
  if (monthIndex(endMonth) - monthIndex(startMonth) > 11) throw new LookupError('발주 예정 범위는 최대 12개월입니다.')
  return [startMonth.replace('-', ''), endMonth.replace('-', '')]
}

function dateQuery(source: Source, params: RecordValue, construction: boolean): Record<string, string> {
  const keyword = optionalFilter(params.keyword, '검색어')
  if (source === 'contractProcess') {
    const number = optionalFilter(params.number, '입찰공고번호')
    const round = optionalFilter(params.round, '공고차수')
    if (!/^[A-Za-z0-9-]{5,40}$/.test(number) || (round && !/^\d{1,3}$/.test(round))) {
      throw new LookupError('입찰공고번호와 공고차수를 확인해 주세요.')
    }
    return { inqryDiv: '1', bidNtceNo: number, ...(round ? { bidNtceOrd: round } : {}) }
  }
  let { startDate, endDate } = params
  if (source === 'orderPlan' && startDate === undefined && endDate === undefined) {
    const seoulToday = Date.now() + 9 * 3600000
    startDate = new Date(seoulToday - 6 * 86400000).toISOString().slice(0, 10)
    endDate = new Date(seoulToday).toISOString().slice(0, 10)
  }
  const [begin, end] = dateRange(startDate, endDate)
  const dateTimes = { inqryBgnDt: `${begin}0000`, inqryEndDt: `${end}2359` }
  if (source === 'orderPlan') {
    const [orderBgnYm, orderEndYm] = monthRange(params.orderStartMonth, params.orderEndMonth)
    const agency = optionalFilter(params.agency, '발주기관명')
    return { ...dateTimes, orderBgnYm, orderEndYm, ...(keyword ? { bizNm: keyword } : {}), ...(agency ? { orderInsttNm: agency } : {}) }
  }
  if (source === 'contract') {
    return { inqryDiv: '1', inqryBgnDate: begin, inqryEndDate: end, ...(keyword ? { [construction ? 'cnstwkNm' : 'cntrctNm']: keyword } : {}) }
  }
  const keywordParam = source === 'preSpec' ? 'prdctClsfcNoNm' : 'bidNtceNm'
  return { inqryDiv: source === 'award' ? '2' : '1', ...dateTimes, ...(keyword ? { [keywordParam]: keyword } : {}) }
}

function publicLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2000 || /\s/.test(value)) return
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '8067') return
    if (url.hostname !== 'g2b.go.kr' && !url.hostname.endsWith('.g2b.go.kr')) return
    if ([...url.searchParams.keys()].some(key => /key|token|secret|auth/i.test(key))) return
    return url.href
  } catch {
    return
  }
}

function won(value: unknown): string {
  const amount = cell(value, 35)
  if (!/^\d{1,30}(?:\.0+)?$/.test(amount)) return ''
  return `${amount.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`
}

function lookupRow(row: RecordValue, titleField: string, idField: string, fields: [string, unknown][], url?: string): SalesLookupRow | null {
  const title = cell(row[titleField]), id = cell(row[idField], 80)
  if (!title || !id) return null
  const facts = fields.flatMap(([label, value]) => {
    const displayed = cell(value)
    return displayed ? [{ label, value: displayed }] : []
  })
  return { title, id, facts, ...(url ? { url } : {}) }
}

const fields = {
  preSpec: (row: RecordValue) => lookupRow(row, 'prdctClsfcNoNm', 'bfSpecRgstNo', [
    ['사전규격 번호', row.bfSpecRgstNo], ['발주기관', row.orderInsttNm], ['실수요기관', row.rlDminsttNm],
    ['배정예산', won(row.asignBdgtAmt)], ['의견 등록 마감', row.opninRgstClseDt], ['관련 공고번호', row.bidNtceNoList],
  ], [1, 2, 3, 4, 5].map(i => publicLink(row[`specDocFileUrl${i}`])).find(Boolean)),
  orderPlan: (row: RecordValue) => lookupRow(row, 'bizNm', 'orderPlanUntyNo', [
    ['발주계획 번호', row.orderPlanUntyNo], ['발주기관', row.orderInsttNm], ['발주 예정월', cell(row.orderYear) && cell(row.orderMnth) ? `${cell(row.orderYear)}-${cell(row.orderMnth).padStart(2, '0')}` : ''],
    ['합계 발주금액', won(row.sumOrderAmt)], ['관련 공고번호', row.bidNtceNoList], ['게시일', row.nticeDt],
  ], publicLink(row.orderPlanDtlUrl)),
  contractProcess: (row: RecordValue) => lookupRow(row, 'bidNtceNm', 'bidNtceNo', [
    ['공고번호', row.bidNtceNo], ['공고차수', row.bidNtceOrd], ['수요기관', row.bidDminsttNm],
    ['발주계획 번호', row.orderPlanNo], ['사전규격 번호', row.bfSpecRgstNo],
    ['낙찰 정보', linkedRecords(row.bidwinrInfoList) ? '관련 기록 있음' : ''], ['계약 정보', linkedRecords(row.cntrctInfoList) ? '관련 기록 있음' : ''],
  ]),
  award: (row: RecordValue) => lookupRow(row, 'bidNtceNm', 'bidNtceNo', [
    ['공고번호', row.bidNtceNo], ['공고차수', row.bidNtceOrd], ['재입찰 번호', row.rbidNo],
    ['수요기관', row.dminsttNm], ['최종 낙찰 업체', row.bidwinnrNm], ['최종 낙찰금액', won(row.sucsfbidAmt)], ['개찰일시', row.rlOpengDt],
  ]),
  contract: (row: RecordValue) => lookupRow(row, cell(row.cntrctNm) ? 'cntrctNm' : 'cnstwkNm', 'untyCntrctNo', [
    ['통합 계약번호', row.untyCntrctNo], ['공고번호', row.ntceNo], ['계약기관', row.cntrctInsttNm],
    ['체결일', row.cntrctCnclsDate], ['계약기간', row.cntrctPrd], ['금차 계약금액', won(row.thtmCntrctAmt)], ['장기계속계약 총액', won(row.totCntrctAmt)],
  ], publicLink(row.cntrctDtlInfoUrl)),
}

function linkedRecords(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && !['', '[]'].includes(value.trim())
}

function unsignedNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined
}

function parseProcurement(value: unknown, source: Source, page: number, queryNote?: string): SalesLookupResult {
  const root = object(value)
  const response = object(root?.response)
  const header = object(response?.header) ?? object(object(root?.OpenAPI_ServiceResponse)?.cmmMsgHeader)
  const code = cell(header?.resultCode ?? header?.returnReasonCode)
  if (['20', '30', '31'].includes(code)) throw new LookupError('이 나라장터 API의 활용 승인과 서버 키를 확인해 주세요.', 503)
  if (['22', '23'].includes(code)) throw new LookupError('나라장터 요청 한도에 도달했습니다. 잠시 후 조회해 주세요.', 429)
  if (code === '03') return { rows: [], total: 0, ...(queryNote ? { note: queryNote } : {}) }
  if (!['00', '0'].includes(code)) throw new LookupError('나라장터 API 응답을 확인하지 못했습니다.', 502)
  const body = object(response?.body)
  const total = unsignedNumber(body?.totalCount)
  if (!body || total === undefined || unsignedNumber(body.pageNo) !== page) {
    throw new LookupError('나라장터 API 응답 페이지를 확인하지 못했습니다.', 502)
  }
  const raw = object(body.items)?.item ?? body.items
  const items = Array.isArray(raw) ? raw : object(raw) ? [raw] : total === 0 && (raw == null || raw === '') ? [] : null
  const available = Math.max(total - (page - 1) * pageSize, 0)
  if (!items || items.length !== Math.min(pageSize, available)) {
    throw new LookupError('나라장터 API 응답 목록의 형식 또는 개수가 올바르지 않습니다.', 502)
  }
  const rows: SalesLookupRow[] = []
  for (const item of items) {
    const entry = object(item)
    if (!entry) continue
    const row = fields[source](entry)
    if (row) rows.push(row)
  }
  if (items.length && !rows.length) throw new LookupError('나라장터 응답에서 사업 정보를 찾지 못했습니다. 원문을 확인해 주세요.', 502)
  const note = [queryNote, rows.length < items.length ? `번호나 제목이 빠진 ${items.length - rows.length}건은 표시하지 않았습니다.` : undefined].filter(Boolean).join(' ')
  return { rows, total, ...(note ? { note } : {}) }
}

// Operation names, request parameters, and output fields come from 조달청's attached API specifications.
// https://www.data.go.kr/data/{15129437,15129462,15129459,15129397,15129427}/openapi.do
export function procurementPlan(source: string, params: RecordValue, key: string): SalesLookupPlan | null {
  if (!Object.hasOwn(routes, source)) return null
  const selected = source as Source
  const { category, page = 1 } = params
  const [service, operation, variant] = routes[selected]
  if (category !== 'service' && category !== 'construction') throw new LookupError('용역 또는 공사를 선택해 주세요.')
  if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 || page > 20) throw new LookupError('페이지는 1~20 사이에서 선택해 주세요.')
  const construction = category === 'construction'
  const query = dateQuery(selected, params, construction)
  const url = new URL(`https://apis.data.go.kr/1230000/${service}/${operation}${construction ? 'Cnstwk' : 'Servc'}${variant}`)
  url.search = new URLSearchParams({ type: 'json', serviceKey: key, pageNo: String(page), numOfRows: String(pageSize), ...query }).toString()
  const notes: Partial<Record<Source, string>> = {
    award: '조회 기간은 개찰일 기준입니다.',
    orderPlan: selected === 'orderPlan' ? `발주계획 게시 기간 ${query.inqryBgnDt.slice(0, 8)}~${query.inqryEndDt.slice(0, 8)}` : undefined,
    contractProcess: '공고번호에 연결된 기록을 표시합니다. 낙찰·계약 정보의 상세 내용은 각각 조회해 주세요.',
  }
  return { url, parse: value => parseProcurement(value, selected, page, notes[selected]) }
}
