import { LookupError, type SalesLookupPlan, type SalesLookupResult, type SalesLookupRow } from './lookupTypes.ts'

const PAGE_SIZE = 15
const PUBLIC_SAMPLE_SIZE = 5

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function optionalText(value: unknown, label: string, maxLength = 80): string {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.trim().length > maxLength || /[\x00-\x1f\x7f]/.test(value)) {
    throw new LookupError(`${label}을(를) ${maxLength}자 이내로 입력해 주세요.`)
  }
  return value.trim()
}

function boundedNumber(value: unknown, label: string, min: number, max: number, integer = false): number {
  const input = scalar(value)
  const number = input && /^-?\d+(\.\d+)?$/.test(input) ? Number(input) : NaN
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new LookupError(`${label} 범위를 확인해 주세요.`)
  }
  return number
}

function dateInput(value: unknown, label: string): string {
  const date = optionalText(value, label, 10)
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date)) {
    throw new LookupError(`${label}을(를) YYYY-MM-DD 형식으로 입력해 주세요.`)
  }
  return date
}

function facts(entries: ReadonlyArray<readonly [string, unknown]>): SalesLookupRow['facts'] {
  return entries.flatMap(([label, value]) => {
    const text = scalar(value)
    return text ? [{ label, value: text.slice(0, 350) }] : []
  })
}

function row(title: unknown, fields: SalesLookupRow['facts'], id?: unknown, url?: string): SalesLookupRow | undefined {
  const name = scalar(title)
  if (!name) return undefined
  const stableId = scalar(id)
  return { title: name.slice(0, 180), facts: fields, ...(stableId ? { id: stableId.slice(0, 120) } : {}), ...(url ? { url } : {}) }
}

function officialLink(value: unknown, hosts: ReadonlyArray<string>): string | undefined {
  try {
    const address = new URL(scalar(value))
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password ||
        address.port || !hosts.includes(address.hostname) || address.href.length > 2000) return undefined
    address.protocol = 'https:'
    return address.href
  } catch {
    return undefined
  }
}

function invalidResponse(): never {
  throw new LookupError('제공기관 응답 형식을 확인하지 못했습니다.', 502)
}

function result(
  items: unknown, count: unknown, limit: number,
  mapper: (value: Record<string, unknown>) => SalesLookupRow | undefined, note?: string,
): SalesLookupResult {
  if (!Array.isArray(items)) invalidResponse()
  const total = scalar(count)
  const rows = items.slice(0, limit).flatMap(item => {
    const value = record(item)
    const entry = value ? mapper(value) : undefined
    return entry ? [entry] : []
  })
  if (items.length && !rows.length) invalidResponse()
  const partial = rows.length < Math.min(limit, items.length)
    ? [note, '형식이 맞지 않는 일부 항목은 제외했습니다.'].filter(Boolean).join(' ')
    : note
  return {
    rows,
    ...(/^\d+$/.test(total) && Number.isSafeInteger(Number(total)) ? { total: Number(total) } : {}),
    ...(partial ? { note: partial } : {}),
  }
}

function gatewayResult(value: unknown, mapper: (value: Record<string, unknown>) => SalesLookupRow | undefined, note: string) {
  const root = record(value)
  const envelope = record(root?.response) ?? root
  const code = scalar(record(envelope?.header)?.resultCode)
  if (['20', '30', '31', '-4'].includes(code)) {
    throw new LookupError('공공데이터포털 활용 승인과 서버에 등록한 인증키를 확인해 주세요.', 503)
  }
  if (['22', '23', '-10'].includes(code)) throw new LookupError('제공기관 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.', 429)
  if (!['00', '0', '0000'].includes(code)) invalidResponse()
  const body = record(envelope?.body)
  if (!body) invalidResponse()
  const item = Array.isArray(body.items) ? body.items : record(body.items)?.item
  const items = Array.isArray(item) ? item : record(item) ? [item] : undefined
  if (!items && scalar(body.totalCount) !== '0') invalidResponse()
  return result(items ?? [], body.totalCount, PAGE_SIZE, mapper, note)
}

function publicDataUrl(path: string, query: Record<string, string>): URL {
  const url = new URL(path, 'https://apis.data.go.kr')
  url.search = new URLSearchParams(query).toString()
  return url
}

function seoulPlan(source: string, params: Record<string, unknown>): SalesLookupPlan {
  if (params.sample !== true || (params.page != null && scalar(params.page) !== '1')) {
    throw new LookupError('서울 열린데이터광장은 공개 샘플 조회로 1페이지(최대 5건)만 제공됩니다.', 503)
  }
  const population = source === 'seoulPopulation'
  const service = population ? 'VwsmTrdarFlpopQq' : 'culturalEventInfo'
  const quarter = population ? optionalText(params.quarter, '기준 분기', 5) : ''
  if (population && !/^20\d\d[1-4]$/.test(quarter)) throw new LookupError('기준 분기를 20262와 같이 입력해 주세요.')
  const keyword = population ? '' : optionalText(params.keyword, '행사명')
  const date = population ? '' : dateInput(params.date, '행사 날짜')
  // Seoul publishes an HTTP endpoint. Only the public sample key and a
  // validated public quarter may be transmitted to this fixed host.
  const url = new URL(`http://openapi.seoul.go.kr:8088/sample/json/${service}/1/${PUBLIC_SAMPLE_SIZE}/${quarter}`)
  const note = '공개 샘플 최대 5건 · 등록 키는 사용하지 않았습니다. 전체 목록과 최신 자료는 서울 열린데이터광장에서 확인해 주세요.'
  return { url, parse(value) {
    const root = record(value)
    const data = record(root?.[service])
    const code = scalar(record(data?.RESULT ?? root?.RESULT)?.CODE)
    if (code === 'INFO-200') return { rows: [], note }
    if (code !== 'INFO-000' || !data) invalidResponse()
    const parsed = result(data.row, undefined, PUBLIC_SAMPLE_SIZE, item => {
      if (population) {
        return row(item.TRDAR_CD_NM, facts([
          ['기준 분기', item.STDR_YYQU_CD], ['상권 구분', item.TRDAR_SE_CD_NM],
          ['유동인구', item.TOT_FLPOP_CO], ['토요일', item.SAT_FLPOP_CO], ['일요일', item.SUN_FLPOP_CO],
        ]), item.TRDAR_CD)
      }
      const schedule = scalar(item.DATE)
      return row(item.TITLE, facts([
        ['일정', schedule], ['장소', item.PLACE], ['자치구', item.GUNAME], ['기관', item.ORG_NAME],
      ]), undefined, officialLink(item.HMPG_ADDR, ['culture.seoul.go.kr']))
    }, note)
    if (!population && (keyword || date)) {
      parsed.rows = parsed.rows.filter(item => (!keyword || item.title.includes(keyword)) &&
        (!date || item.facts.some(field => field.label === '일정' && field.value.includes(date))))
      parsed.note = `${note} 검색 조건은 이 샘플에만 적용됩니다.`
    }
    return parsed
  } }
}

function kakaoPlan(params: Record<string, unknown>, key: string, page: string): SalesLookupPlan {
  const query = optionalText(params.keyword, '장소명')
  if (!query) throw new LookupError('장소명을 입력해 주세요.')
  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json')
  url.search = new URLSearchParams({ query, page, size: String(PAGE_SIZE) }).toString()
  return {
    url,
    headers: { Authorization: `KakaoAK ${key}` },
    parse(value) {
      const root = record(value)
      const meta = record(root?.meta)
      if (!meta || typeof meta.is_end !== 'boolean') invalidResponse()
      return result(root?.documents, meta.pageable_count, PAGE_SIZE, item => row(item.place_name, facts([
        ['주소', scalar(item.road_address_name) || item.address_name],
        ['업종', item.category_name], ['경도', item.x], ['위도', item.y],
      ]), item.id, officialLink(item.place_url, ['place.map.kakao.com'])),
      '주소와 위치를 먼저 확인하고 대관 조건은 공간 운영사에 확인하세요.')
    },
  }
}

function districtPlan(params: Record<string, unknown>, key: string, pageNo: string): SalesLookupPlan {
  const cx = boundedNumber(params.longitude, '경도', -180, 180)
  const cy = boundedNumber(params.latitude, '위도', -90, 90)
  const radius = boundedNumber(params.radius === '' ? 500 : params.radius ?? 500, '반경(1~2,000m)', 1, 2000, true)
  return {
    url: publicDataUrl('/B553077/api/open/sdsc2/storeListInRadius', {
      ServiceKey: key, pageNo, numOfRows: String(PAGE_SIZE), radius: String(radius), cx: String(cx), cy: String(cy), type: 'json',
    }),
    parse: value => gatewayResult(value, item => row(item.bizesNm, facts([
      ['지점', item.brchNm], ['업종', item.indsSclsNm], ['주소', scalar(item.rdnmAdr) || item.lnoAdr],
      ['층', item.flrNo], ['기준 월', item.stdrYm],
    ]), item.bizesId), '주변 업소 조사를 위한 자료입니다. 실제 유동인구와 대관 가능 여부는 별도로 확인하세요.'),
  }
}

function queryLot(params: Record<string, unknown>): Record<string, string> {
  const sigunguCd = optionalText(params.sigunguCd, '시군구 코드', 5)
  const bjdongCd = optionalText(params.bjdongCd, '법정동 코드', 5)
  const main = optionalText(params.bun, '지번 본번', 4)
  const sub = optionalText(params.ji, '지번 부번', 4) || '0'
  const platGbCd = optionalText(params.platGbCd, '대지 구분', 1) || '0'
  if (!/^\d{5}$/.test(sigunguCd) || !/^\d{5}$/.test(bjdongCd)) throw new LookupError('시군구와 법정동 코드를 각각 5자리로 입력해 주세요.')
  if (!/^\d{1,4}$/.test(main) || Number(main) === 0 || !/^\d{1,4}$/.test(sub)) throw new LookupError('지번 본번과 부번에는 숫자만 입력해 주세요.')
  if (!/^[012]$/.test(platGbCd)) throw new LookupError('대지 구분은 0(대지), 1(산), 2(블록) 중 하나로 입력해 주세요.')
  return { sigunguCd, bjdongCd, platGbCd, bun: main.padStart(4, '0'), ji: sub.padStart(4, '0') }
}

function buildingPlan(source: string, params: Record<string, unknown>, key: string, pageNo: string): SalesLookupPlan {
  const permit = source === 'buildingPermit'
  const path = permit ? 'ArchPmsHubService/getApBasisOulnInfo' : 'BldRgstHubService/getBrTitleInfo'
  return {
    url: publicDataUrl(`/1613000/${path}`, {
      ...queryLot(params), serviceKey: key, pageNo, numOfRows: String(PAGE_SIZE), _type: 'json',
    }),
    parse: value => gatewayResult(value, item => {
      const address = scalar(item.newPlatPlc) || item.platPlc
      const fields = permit
        ? facts([['대지 위치', address], ['건축 구분', item.archGbCdNm], ['주용도', item.mainPurpsCdNm],
          ['연면적(㎡)', item.totArea], ['허가일', item.archPmsDay], ['착공 예정일', item.stcnsSchedDay], ['실제 착공일', item.realStcnsDay], ['사용 승인일', item.useAprDay]])
        : facts([['대지 위치', address], ['동명', item.dongNm], ['주용도', item.mainPurpsCdNm], ['구조', item.strctCdNm],
          ['연면적(㎡)', item.totArea], ['지상층 수', item.grndFlrCnt], ['지하층 수', item.ugrndFlrCnt], ['사용 승인일', item.useAprDay]])
      return row(scalar(item.bldNm) || address, fields, permit ? item.mgmPmsrgstPk : item.mgmBldrgstPk)
    }, permit ? '건축인허가 기본개요입니다. 팝업 대행 발주와 실제 공사 일정은 별도로 확인하세요.'
      : '건축물대장 표제부입니다. 사용 면적과 현장 조건은 도면·관리자 확인이 필요합니다.'),
  }
}

function restaurantPlan(params: Record<string, unknown>, key: string, pageNo: string): SalesLookupPlan {
  const keyword = optionalText(params.keyword, '사업장명')
  const address = optionalText(params.address, '도로명 주소')
  if (!keyword && !address) throw new LookupError('사업장명 또는 도로명 주소를 입력해 주세요.')
  const start = dateInput(params.startDate, '인허가 시작일')
  const end = dateInput(params.endDate, '인허가 종료일')
  if (start || end) {
    const difference = (Date.parse(end) - Date.parse(start)) / 86_400_000
    if (!Number.isFinite(difference) || difference < 0 || difference >= 90) {
      throw new LookupError('인허가 시작일과 종료일을 모두 입력하고 최대 90일로 설정해 주세요.')
    }
  }
  const query: Record<string, string> = { serviceKey: key, pageNo, numOfRows: String(PAGE_SIZE), returnType: 'json' }
  if (keyword) query['cond[BPLC_NM::LIKE]'] = keyword
  if (address) query['cond[ROAD_NM_ADDR::LIKE]'] = address
  if (start && end) {
    const endExclusive = new Date(Date.parse(end) + 86_400_000).toISOString().slice(0, 10)
    query['cond[LCPMT_YMD::GTE]'] = start.replaceAll('-', '')
    query['cond[LCPMT_YMD::LT]'] = endExclusive.replaceAll('-', '')
  }
  return {
    url: publicDataUrl('/1741000/general_restaurants/info', query),
    parse: value => gatewayResult(value, item => row(item.BPLC_NM, facts([
      ['주소', scalar(item.ROAD_NM_ADDR) || item.LOTNO_ADDR],
      ['인허가일', item.LCPMT_YMD], ['영업 상태', item.SALS_STTS_NM], ['업태', item.BZSTAT_SE_NM],
    ]), item.MNG_NO), '인허가일은 오픈일이 아닙니다. 영업 상태와 대행 수요는 별도로 확인하세요.'),
  }
}

export function localityPlan(source: string, params: Record<string, unknown>, key: string): SalesLookupPlan | null {
  if (source === 'seoulEvents' || source === 'seoulPopulation') return seoulPlan(source, params)
  if (!['kakao', 'district', 'buildingRegister', 'buildingPermit', 'restaurant'].includes(source)) return null
  const page = String(boundedNumber(params.page ?? 1, '페이지(1~20)', 1, 20, true))
  switch (source) {
    case 'kakao': return kakaoPlan(params, key, page)
    case 'district': return districtPlan(params, key, page)
    case 'buildingRegister':
    case 'buildingPermit': return buildingPlan(source, params, key, page)
    case 'restaurant': return restaurantPlan(params, key, page)
    default: return null
  }
}
