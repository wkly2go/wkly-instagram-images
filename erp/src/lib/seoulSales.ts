import { parseCsv } from './csv.ts'
import { validDate } from './prospecting.ts'

export const SEOUL_EVENT_DATASET = 'https://data.seoul.go.kr/dataList/OA-23041/S/1/datasetView.do'
export const SEOUL_POPULATION_DATASET = 'https://data.seoul.go.kr/dataList/OA-15568/S/1/datasetView.do'
export const SEOUL_CSV_MAX_BYTES = 15 * 1024 * 1024

export interface SeoulEvent {
  id: string
  title: string
  district: string
  category: string
  organization: string
  venue: string
  start: string
  end: string
  url: string
}

export interface SeoulArea {
  quarter: string
  code: string
  name: string
  type: string
  total: number
  weekday: number | null
  weekend: number | null
}

export function readSeoulCsv(buffer: ArrayBuffer): string[][] {
  if (!buffer.byteLength || buffer.byteLength > SEOUL_CSV_MAX_BYTES) throw new Error('15MB 이하의 서울시 CSV 파일을 선택해 주세요.')
  let csv: string
  try { csv = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  catch { csv = new TextDecoder('euc-kr').decode(buffer) }
  const grid = parseCsv(csv)
  if (!grid[0] || grid.length < 2) throw new Error('열 제목과 데이터가 있는 CSV를 확인해 주세요.')
  return grid
}

function columnReader(header: string[]) {
  const normalized = (s: string) => s.replace(/[^가-힣a-z0-9]/gi, '').toLowerCase()
  const index = new Map(header.map((label, i) => [normalized(label), i]))
  return (aliases: string[], required = false) => {
    const column = aliases.map(name => index.get(normalized(name))).find(i => i !== undefined)
    if (column === undefined && required) throw new Error(`필수 열 ‘${aliases[0]}’이 없습니다. 서울 열린데이터광장 원본을 선택해 주세요.`)
    return (row: string[]) => (column === undefined ? '' : row[column] ?? '').trim()
  }
}

function eventDate(raw: string): string {
  const parts = /^(20\d{2})[-./](\d{1,2})[-./](\d{1,2})(?=$|[ T])/.exec(raw)
  const compact = /^(20\d{2})(\d{2})(\d{2})$/.exec(raw)
  const match = parts ?? compact
  if (!match) return ''
  const iso = [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-')
  return validDate(iso) ? iso : ''
}

function seoulEventLink(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.port || !['https:', 'http:'].includes(url.protocol) ||
        url.hostname !== 'culture.seoul.go.kr' || !url.pathname.includes('/cultureEvent/view.do') ||
        !/^\d+$/.test(url.searchParams.get('cultcode') ?? '')) return ''
    url.protocol = 'https:'
    return url.href
  } catch { return '' }
}

export function parseSeoulEvents(grid: string[][]): SeoulEvent[] {
  const [header, ...rows] = grid
  const column = columnReader(header ?? [])
  const title = column(['공연/행사명', '공연·행사명', '행사명', 'TITLE'], true)
  const district = column(['자치구', '자치구명', 'GUNAME'])
  const category = column(['분류', '분류명', 'CODENAME'])
  const organization = column(['기관명', '주최기관', 'ORG_NAME'])
  const venue = column(['장소', '행사장소', 'PLACE'])
  const startDate = column(['시작일', '시작일자', '행사시작일', 'STRTDATE'])
  const endDate = column(['종료일', '종료일자', '행사종료일', 'END_DATE'])
  const period = column(['날짜', '행사일자', '일자', 'DATE'])
  const detail = column(['문화포털 상세 URL', '문화포털정보', '문화포털URL', '상세 URL', 'ORG_LINK'])
  const secondary = column(['홈페이지 주소', '홈페이지', 'HMPG_ADDR'])
  const deduped = new Map<string, SeoulEvent>()

  for (const row of rows) {
    const name = title(row).slice(0, 240)
    if (!name) continue
    const [periodStart, periodEnd] = period(row).split('~').map(s => eventDate(s.trim()))
    const start = eventDate(startDate(row)) || periodStart || ''
    const reportedEnd = eventDate(endDate(row)) || periodEnd || ''
    const end = start && reportedEnd >= start ? reportedEnd : ''
    const place = venue(row).slice(0, 160)
    const host = organization(row).slice(0, 160)
    const url = seoulEventLink(detail(row)) || seoulEventLink(secondary(row))
    const id = url ? new URL(url).searchParams.get('cultcode')! : JSON.stringify([name, start, end, place, host, district(row)])
    if (deduped.has(id)) continue
    deduped.set(id, {
      id, title: name, district: district(row).slice(0, 60), category: category(row).slice(0, 60),
      organization: host, venue: place, start, end, url,
    })
  }
  if (!deduped.size) throw new Error('CSV에서 문화행사 행을 확인하지 못했습니다.')
  return [...deduped.values()]
}

function populationNumber(value: string): number | null {
  const n = /^\d+(?:\.\d+)?$/.test(value.replaceAll(',', '')) ? Number(value.replaceAll(',', '')) : NaN
  return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? n : null
}

function mean(values: (number | null)[]) {
  if (values.some(value => value === null)) return null
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length
}

export function parseSeoulPopulation(grid: string[][]): SeoulArea[] {
  const [header, ...rows] = grid
  const column = columnReader(header ?? [])
  const quarter = column(['기준_년분기_코드', '기준년분기코드', 'STDR_YYQU_CD'], true)
  const code = column(['상권_코드', 'TRDAR_CD'], true)
  const name = column(['상권_코드_명', '상권명', 'TRDAR_CD_NM'], true)
  const type = column(['상권_구분_코드_명', '상권_구분_코드', 'TRDAR_SE_CD_NM', 'TRDAR_SE_CD'], true)
  const total = column(['총_유동인구_수', 'TOT_FLPOP_CO'], true)
  const weekdays = [['월', 'MON'], ['화', 'TUES'], ['수', 'WED'], ['목', 'THUR'], ['금', 'FRI']]
  const weekendDays = [['토', 'SAT'], ['일', 'SUN']]
  const dayColumns = (days: string[][]) => days.map(([day, field]) => column([`${day}요일_유동인구_수`, `${field}_FLPOP_CO`]))
  const weekday = dayColumns(weekdays)
  const weekend = dayColumns(weekendDays)
  const unique = new Map<string, SeoulArea>()

  for (const row of rows) {
    const period = quarter(row)
    const areaCode = code(row)
    const areaName = name(row)
    const areaType = type(row)
    const amount = populationNumber(total(row))
    if (!/^20\d{2}[1-4]$/.test(period) || !/^\d{1,20}$/.test(areaCode) || !areaName || !areaType || amount === null) continue
    const key = JSON.stringify([period, areaType, areaCode])
    const area: SeoulArea = {
      quarter: period, code: areaCode, name: areaName.slice(0, 160), type: areaType.slice(0, 60), total: amount,
      weekday: mean(weekday.map(read => populationNumber(read(row)))),
      weekend: mean(weekend.map(read => populationNumber(read(row)))),
    }
    const old = unique.get(key)
    if (old && JSON.stringify(area) !== JSON.stringify(old)) throw new Error('같은 분기·상권 코드의 값이 서로 다릅니다. 같은 기준의 원본 CSV를 선택해 주세요.')
    unique.set(key, area)
  }
  if (!unique.size) throw new Error('CSV에서 유효한 분기·상권 자료를 찾지 못했습니다.')
  return [...unique.values()]
}

export function compareSeoulAreas(areas: SeoulArea[]): string {
  const first = areas[0]
  if (!first || areas.length < 2 || areas.length > 3 || areas.some(area => area.quarter !== first.quarter || area.type !== first.type) ||
      new Set(areas.map(area => area.code)).size !== areas.length) {
    throw new Error('같은 분기·상권 유형에서 서로 다른 상권 2~3곳을 선택해 주세요.')
  }
  const format = (n: number | null) => n === null ? '자료 없음' : n.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
  return [
    `[서울시 상권 입지 비교] ${first.quarter.slice(0, 4)}년 ${first.quarter[4]}분기 · ${first.type}`,
    ...areas.map(area => `- ${area.name} (${area.code}) · 원자료 총유동인구 ${format(area.total)} · 요일 값 평균 평일 ${format(area.weekday)} / 주말 ${format(area.weekend)}`),
    `출처: 서울 열린데이터광장, 서울시 상권분석서비스(길단위인구-상권) ${SEOUL_POPULATION_DATASET}`,
    '요일 값 평균은 공개 데이터의 평일 5개·주말 2개 요일 값을 각각 평균한 값입니다. 실제 매장 방문, 대관 가능일, 반입·시공 조건은 현장에서 확인합니다.',
  ].join('\n')
}
