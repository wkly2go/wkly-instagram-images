import { LookupError, type SalesLookupPlan, type SalesLookupResult, type SalesLookupRow } from './lookupTypes.ts'

// https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi
const BIZINFO_ENDPOINT = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do'
const BIZINFO_NOTICE = 'https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do'
const PAGE_SIZE = 25
const MAX_PAGES = 10
const REGIONS = new Set([
  '서울', '부산', '대구', '인천', '광주', '전남광주', '대전', '울산', '세종', '경기',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
])

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function plainText(value: unknown, length = 200): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, 8_000)
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
    .trim().slice(0, length)
}

function count(value: unknown): number | undefined {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return undefined
  const converted = Number(value)
  return Number.isSafeInteger(converted) && converted >= 0 ? converted : undefined
}

function parseBizinfo(value: unknown, keyword: string, key: string): SalesLookupResult {
  const envelope = record(value)
  const feed = record(envelope?.jsonArray)
  // Bizinfo returns HTTP 200 with a JSON reqErr for an invalid key.
  if (envelope?.reqErr || feed?.reqErr) {
    throw new LookupError('기업마당 API 인증이나 조회 조건을 확인해 주세요.', 502)
  }
  if (!feed) throw new LookupError('기업마당 공고 응답 형식을 확인하지 못했습니다.', 502)
  const raw = feed.item
  // A feed can omit item when it has no notices. Require the expected feed metadata in that case.
  const noNotices = (raw === undefined || raw === null || raw === '') &&
    (count(feed.totCnt) === 0 || (feed.category === 'bizinfo' && typeof feed.title === 'string'))
  const items = Array.isArray(raw) ? raw : record(raw) ? [raw] : noNotices ? [] : undefined
  if (!items) throw new LookupError('기업마당 공고 목록을 확인하지 못했습니다.', 502)

  const rows: SalesLookupRow[] = []
  const terms = keyword.toLowerCase().split(/\s+/).filter(Boolean)
  let total = count(feed.totCnt)
  let valid = 0
  const seen = new Set<string>()
  // Strip an accidentally reflected server key from all user-visible upstream fields.
  const clean = (field: unknown, length?: number) => plainText(
    typeof field === 'string' ? field.replaceAll(key, '') : field, length,
  )
  for (const item of items.slice(0, PAGE_SIZE)) {
    const src = record(item)
    if (!src) continue
    const title = clean(src.pblancNm, 250) || clean(src.title, 250)
    if (!title) continue
    valid++
    total ??= count(src.totCnt)
    const id = clean(src.pblancId) || clean(src.seq)
    const agency = clean(src.jrsdInsttNm) || clean(src.author)
    const operator = clean(src.excInsttNm)
    const category = clean(src.pldirSportRealmLclasCodeNm) || clean(src.lcategory)
    const summary = clean(src.bsnsSumryCn || src.description, 450)
    const search = [title, agency, operator, category, summary, clean(src.hashTags, 400)].join(' ').toLowerCase()
    if (!terms.every(term => search.includes(term))) continue

    const facts = [
      { label: '소관 기관', value: agency },
      { label: '수행 기관', value: operator },
      { label: '지원 분야', value: category },
      { label: '신청 기간', value: clean(src.reqstBeginEndDe) || clean(src.reqstDt) },
      { label: '지원 대상', value: clean(src.trgetNm) },
      { label: '사업 개요', value: summary },
    ].filter(fact => fact.value)
    const row: SalesLookupRow = { title, facts }
    // Use only known public notice identifiers. Do not surface an upstream-supplied arbitrary URL.
    if (/^PBLN_\d{1,25}$/.test(id)) {
      if (seen.has(id)) continue
      seen.add(id)
      row.id = id
      row.url = `${BIZINFO_NOTICE}?pblancId=${id}`
    }
    rows.push(row)
  }
  if (items.length && !valid) throw new LookupError('기업마당 공고 내용을 확인하지 못했습니다.', 502)
  return {
    rows,
    total,
    note: keyword
      ? '기업마당에서 받은 현재 페이지의 공고만 검색어로 걸렀습니다. 전체 건수는 검색어 적용 전 기준입니다.'
      : '기업마당 지원사업 공고입니다. 실제 행사 참가 브랜드와 대행 수요는 공고 원문에서 확인하세요.',
  }
}

export function marketPlan(source: string, params: Record<string, unknown>, key: string): SalesLookupPlan | null {
  if (source !== 'bizinfo') return null
  if (Object.keys(params).some(field => !['keyword', 'region', 'page'].includes(field))) {
    throw new LookupError('기업마당 검색 조건을 확인해 주세요.')
  }
  const { keyword = '', region = '', page = 1 } = params
  if (typeof keyword !== 'string' || keyword.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(keyword)) {
    throw new LookupError('기업마당 검색어를 80자 이내로 입력해 주세요.')
  }
  if (typeof region !== 'string' || (region && !REGIONS.has(region))) {
    throw new LookupError('기업마당 지역을 선택해 주세요.')
  }
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > MAX_PAGES) {
    throw new LookupError('기업마당 페이지는 1~10 사이에서 선택해 주세요.')
  }
  const url = new URL(BIZINFO_ENDPOINT)
  url.search = new URLSearchParams({
    crtfcKey: key,
    dataType: 'json',
    searchCnt: String(PAGE_SIZE * MAX_PAGES),
    pageUnit: String(PAGE_SIZE),
    pageIndex: String(page),
    ...(region ? { hashtags: region } : {}),
  }).toString()
  return { url, parse: value => parseBizinfo(value, keyword.trim(), key) }
}
