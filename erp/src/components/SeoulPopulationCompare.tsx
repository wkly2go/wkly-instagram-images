import { useMemo, useRef, useState } from 'react'
import { SEOUL_CSV_MAX_BYTES, SEOUL_POPULATION_DATASET, compareSeoulAreas, parseSeoulPopulation, readSeoulCsv, type SeoulArea } from '../lib/seoulSales'
import { Button, Field } from './ui'

const MAX_AREAS = 3
const MAX_RESULTS = 12
const count = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 })

function areaKey(area: SeoulArea) {
  return JSON.stringify([area.quarter, area.type, area.code])
}

function quarterLabel(quarter: string) {
  return `${quarter.slice(0, 4)}년 ${quarter.slice(4)}분기`
}

function displayPopulation(value: number | null) {
  return value === null ? '자료 없음' : count.format(value)
}

export function SeoulPopulationCompare({ onEvidence }: { onEvidence: (text: string) => void }) {
  const [areas, setAreas] = useState<SeoulArea[]>([])
  const [fileName, setFileName] = useState('')
  const [quarter, setQuarter] = useState('')
  const [areaType, setAreaType] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SeoulArea[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [copyFallback, setCopyFallback] = useState(false)
  const reading = useRef(false)

  const quarters = useMemo(() => [...new Set(areas.map(area => area.quarter))].sort().reverse(), [areas])
  const areasInQuarter = useMemo(() => areas.filter(area => area.quarter === quarter), [areas, quarter])
  const types = useMemo(() => [...new Set(areasInQuarter.map(area => area.type))].sort((a, b) => a.localeCompare(b, 'ko')), [areasInQuarter])
  const matches = useMemo(() => {
    const keyword = search.trim()
    return areasInQuarter.filter(area =>
      (!areaType || area.type === areaType) && (!keyword || area.name.includes(keyword) || area.code.includes(keyword)),
    )
  }, [areasInQuarter, areaType, search])
  const evidence = useMemo(() => selected.length >= 2 ? compareSeoulAreas(selected) : '', [selected])

  const resetSelection = () => {
    setSelected([])
    setCopyMessage('')
    setCopyFallback(false)
  }

  const load = async (file: File) => {
    if (reading.current) return
    setError('')
    if (!/\.csv$/i.test(file.name) || file.size === 0 || file.size > SEOUL_CSV_MAX_BYTES) {
      setError('15MB 이하의 서울시 상권 생활인구 CSV를 선택해 주세요.')
      return
    }
    reading.current = true
    setLoading(true)
    try {
      const rows = parseSeoulPopulation(readSeoulCsv(await file.arrayBuffer()))
      const latest = rows.reduce((latest, area) => area.quarter > latest ? area.quarter : latest, '')
      if (!latest) throw new Error('파일에서 기준 분기와 상권 생활인구를 찾지 못했습니다.')
      setAreas(rows)
      setFileName(file.name)
      setQuarter(latest)
      setAreaType('')
      setSearch('')
      resetSelection()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '서울시 상권 생활인구 CSV를 읽지 못했습니다.')
    } finally {
      setLoading(false)
      reading.current = false
    }
  }

  const addArea = (area: SeoulArea) => {
    if (reading.current || selected.length >= MAX_AREAS || selected.some(item => areaKey(item) === areaKey(area))) return
    if (area.quarter !== quarter || (areaType && area.type !== areaType)) return
    if (!areaType) setAreaType(area.type)
    setSelected(items => [...items, area])
    setCopyMessage('')
    setCopyFallback(false)
  }

  const removeArea = (key: string) => {
    setSelected(items => items.filter(area => areaKey(area) !== key))
    setCopyMessage('')
    setCopyFallback(false)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(evidence)
      setCopyMessage('입지 비교 근거를 복사했습니다.')
      setCopyFallback(false)
    } catch {
      setCopyFallback(true)
      setCopyMessage('아래 내용을 선택해 직접 복사하세요.')
    }
  }

  return <section className="prospect-planner" aria-labelledby="seoul-population-heading">
    <h3 id="seoul-population-heading" className="t-sub">팝업 후보지 생활인구 비교</h3>
    <p>서울시 상권 생활인구 CSV를 가져와 같은 분기·상권 유형의 후보를 최대 3곳까지 비교합니다.</p>
    <p className="t-small">서울 열린데이터광장에서 Sheet 탭을 열고 기준 분기 하나(예: 20262)를 검색한 뒤 CSV로 내려받으세요.</p>
    <a href={SEOUL_POPULATION_DATASET} target="_blank" rel="noopener noreferrer">서울 열린데이터광장 상권 생활인구 자료</a>
    <Field label="서울시 상권 생활인구 CSV">
      <input className="input" type="file" accept=".csv,text/csv" disabled={loading} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void load(file)
      }} />
    </Field>
    {loading && <p role="status">상권 생활인구 자료를 읽는 중입니다.</p>}
    {error && <p role="alert" className="sales-error">{error}</p>}
    {areas.length > 0 && <fieldset className="sales-fieldset" disabled={loading}>
      <p className="t-small">사용 중인 자료 {fileName} · {count.format(areas.length)}개 행</p>
      <div className="sales-filters">
        <Field label="기준 분기"><select className="select" value={quarter} onChange={event => {
          setQuarter(event.target.value)
          setAreaType('')
          resetSelection()
        }}>
          {quarters.map(value => <option key={value} value={value}>{quarterLabel(value)}</option>)}
        </select></Field>
        <Field label="상권 구분"><select className="select" value={areaType} onChange={event => {
          setAreaType(event.target.value)
          resetSelection()
        }}>
          <option value="">전체</option>
          {types.map(value => <option key={value} value={value}>{value}</option>)}
        </select></Field>
        <Field label="상권명 또는 코드"><input className="input" value={search} maxLength={80} placeholder="예: 성수" onChange={event => setSearch(event.target.value)} /></Field>
      </div>
      <p className="t-small" role="status">검색 결과 {count.format(matches.length)}곳{matches.length > MAX_RESULTS ? ` 중 ${MAX_RESULTS}곳 표시 · 검색어로 범위를 좁히세요.` : ''} · 선택 {selected.length}/{MAX_AREAS}</p>
      {matches.length > 0
        ? <ul className="prospect-timeline">{matches.slice(0, MAX_RESULTS).map(area => {
          const key = areaKey(area)
          const added = selected.some(item => areaKey(item) === key)
          return <li key={key}>
            <span><strong>{area.name}</strong> · {area.type} · {area.code}</span>
            <Button kind="outline" size="sm" aria-label={`${area.name} ${area.code} 비교에 추가`} disabled={added || selected.length === MAX_AREAS} onClick={() => addArea(area)}>{added ? '추가됨' : '비교에 추가'}</Button>
          </li>
        })}</ul>
        : <p className="t-small">조건에 맞는 상권이 없습니다.</p>}
      {selected.length > 0 && <>
        <div className="table-wrap">
          <table className="table" aria-label="선택한 상권의 생활인구 비교">
            <caption>{quarterLabel(quarter)} · {areaType}</caption>
            <thead><tr>
              <th scope="col">상권</th>
              <th scope="col">제공 총계</th>
              <th scope="col">평일 요일 평균</th>
              <th scope="col">주말 요일 평균</th>
              <th scope="col">선택 관리</th>
            </tr></thead>
            <tbody>{selected.map(area => <tr key={areaKey(area)}>
              <th scope="row">{area.name} <small>{area.code}</small></th>
              <td>{displayPopulation(area.total)}</td>
              <td>{displayPopulation(area.weekday)}</td>
              <td>{displayPopulation(area.weekend)}</td>
              <td><Button kind="ghost" size="sm" aria-label={`${area.name} ${area.code} 비교에서 제거`} onClick={() => removeArea(areaKey(area))}>제거</Button></td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="t-small">출처는 서울 열린데이터광장 OA-15568입니다. 요일 평균은 제공된 평일 5개·주말 2개 요일 값의 평균입니다. 상권 경계와 면적이 다를 수 있으므로 매장 앞 통행량과 행사 방문객은 현장에서 확인하세요.</p>
        {evidence ? <div className="row wrap">
          <Button onClick={() => onEvidence(evidence)}>비교 근거로 영업 기회 작성</Button>
          <Button kind="outline" onClick={() => { void copy() }}>비교 근거 복사</Button>
        </div> : <p className="t-small">비교하려면 같은 유형의 상권을 하나 더 추가하세요.</p>}
        {copyMessage && <p className="t-small" role="status">{copyMessage}</p>}
        {copyFallback && <Field label="복사할 입지 비교 근거"><textarea className="textarea" rows={5} value={evidence} readOnly onFocus={event => event.currentTarget.select()} /></Field>}
      </>}
    </fieldset>}
  </section>
}
