import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { todayKey } from '../lib/date'
import { safeWebUrl } from '../lib/growth'
import { parseSeoulEvents, readSeoulCsv, SEOUL_EVENT_DATASET, type SeoulEvent } from '../lib/seoulSales'
import { fetchSeoulEvents, type SeoulEventSnapshot } from '../lib/seoulEventClient'
import { Button, Field } from './ui'

const MAX_FILE_BYTES = 15 * 1024 * 1024
const PAGE_SIZE = 15

type EventStatus = 'scheduled' | 'ongoing' | 'ended' | 'unknown'
type StatusFilter = EventStatus | 'active' | 'all'

const eventStatusLabels: Record<EventStatus, string> = {
  scheduled: '예정',
  ongoing: '진행 중',
  ended: '종료',
  unknown: '일정 확인 필요',
}

function eventStatus(event: SeoulEvent, today: string): EventStatus {
  if (event.end && event.end < today) return 'ended'
  if (event.start && event.start > today) return 'scheduled'
  if (event.start && event.end) return 'ongoing'
  if (event.start === today) return 'ongoing'
  return 'unknown'
}


export function SeoulEventDiscovery({ onEvent }: { onEvent: (event: SeoulEvent) => void }) {
  const [events, setEvents] = useState<SeoulEvent[]>([])
  const [fileName, setFileName] = useState('')
  const [snapshot, setSnapshot] = useState<SeoulEventSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [district, setDistrict] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)
  const readingRef = useRef(false)
  const request = useRef<{ serial: number; controller: AbortController | null }>({ serial: 0, controller: null })
  const today = todayKey()

  async function loadLatest() {
    if (readingRef.current || request.current.controller) return
    const controller = new AbortController()
    const serial = ++request.current.serial
    request.current.controller = controller
    setLoading(true)
    setError('')
    try {
      const next = await fetchSeoulEvents(controller.signal)
      if (serial !== request.current.serial || controller.signal.aborted) return
      setEvents(next.events)
      setSnapshot(next)
      setFileName('')
    } catch (cause) {
      if (serial !== request.current.serial || controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : '서울시 행사를 불러오지 못했습니다. CSV 파일을 이용해 주세요.')
    } finally {
      if (serial === request.current.serial) {
        request.current.controller = null
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadLatest()
    return () => {
      request.current.serial++
      request.current.controller?.abort()
      request.current.controller = null
    }
  }, [])

  const districts = useMemo(() => [...new Set([...events.map(event => event.district), district].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko')), [events, district])

  const results = useMemo(() => {
    const terms = keyword.toLocaleLowerCase('ko').trim().split(/\s+/).filter(Boolean)
    return events.map(event => ({ event, status: eventStatus(event, today) }))
      .filter(({ event, status }) => {
        if (district && event.district !== district) return false
        if (filter === 'active' && status !== 'ongoing' && status !== 'scheduled') return false
        if (filter !== 'active' && filter !== 'all' && status !== filter) return false
        const text = [event.title, event.category, event.organization, event.venue, event.district]
          .join(' ').toLocaleLowerCase('ko')
        return terms.every(term => text.includes(term))
      })
      .sort((a, b) => {
        const left = a.event.start || a.event.end || '9999-12-31'
        const right = b.event.start || b.event.end || '9999-12-31'
        const byDate = filter === 'ended' ? right.localeCompare(left) : left.localeCompare(right)
        return byDate || a.event.title.localeCompare(b.event.title, 'ko')
      })
  }, [events, keyword, district, filter, today])

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visible = results.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  async function loadFile(change: ChangeEvent<HTMLInputElement>) {
    const picked = change.target.files?.[0]
    change.target.value = ''
    if (!picked || readingRef.current) return
    if (!/\.csv$/i.test(picked.name) || picked.size > MAX_FILE_BYTES) {
      setError('서울시 문화행사 CSV 파일을 선택해 주세요. 최대 15MB까지 읽을 수 있습니다.')
      return
    }

    readingRef.current = true
    request.current.controller?.abort()
    request.current.controller = null
    const serial = ++request.current.serial
    setLoading(false)
    setReading(true)
    setError('')
    try {
      const imported = parseSeoulEvents(readSeoulCsv(await picked.arrayBuffer()))
      if (serial !== request.current.serial) return
      if (!imported.length) throw new Error('읽을 수 있는 행사 정보가 없습니다.')
      setEvents(imported)
      setFileName(picked.name)
      setSnapshot(null)
    } catch (cause) {
      if (serial !== request.current.serial) return
      setError(cause instanceof Error ? cause.message : '파일을 읽지 못했습니다.')
    } finally {
      if (serial === request.current.serial) {
        readingRef.current = false
        setReading(false)
      }
    }
  }

  return <section className="sales-pipeline" aria-label="서울시 문화행사 발굴">
    <h3 className="t-sub">문화행사에서 협업 후보 찾기</h3>
    <p className="sales-notice">행사 일정과 주최기관을 보고 연계 팝업 또는 다음 회차를 검토하세요. 참가·협업 모집 여부, 예산, 미발주 범위는 주최기관 원문이나 문의로 확인합니다.</p>
    <div className="row wrap">
      <Button kind="outline" disabled={loading || reading} onClick={() => {
        if (fileName && !window.confirm('불러온 CSV 목록을 서울시 최신 조회 결과로 바꿀까요? 작성 중인 영업 정보와 검색 조건은 유지됩니다.')) return
        void loadLatest()
      }}>최신 행사 다시 불러오기</Button>
      <a className="btn btn-outline" href={SEOUL_EVENT_DATASET} target="_blank" rel="noreferrer">서울시 원본 데이터</a>
    </div>
    <p className="t-small">서울시 공개 목록 최대 1,000건에서 예정·진행 중인 행사를 최대 200건 표시합니다. 조회 결과는 최대 30분간 재사용하며, 검색은 불러온 행사에 적용됩니다.</p>
    {loading && <p role="status">서울시 행사를 불러오는 중입니다.{events.length > 0 && ' 기존 목록과 검색 조건은 유지됩니다.'}</p>}
    <details className="sales-options">
      <summary>CSV로 불러오기</summary>
      <Field label="서울시 문화행사 CSV">
        <input type="file" className="input" accept=".csv,text/csv" disabled={reading} onChange={loadFile} />
      </Field>
      <p className="t-small">자동 조회가 어렵거나 종료 행사가 필요하면 원본 데이터에서 내려받은 CSV를 선택하세요.</p>
    </details>
    {reading && <p role="status">행사 파일을 읽는 중입니다.</p>}
    {error && <p role="alert" className="sales-error">{error}</p>}
    {(fileName || snapshot) && <>
      <p className="t-small">{fileName ? `불러온 파일 ${fileName}` : '서울시 API 조회'} · 행사 {events.length.toLocaleString('ko-KR')}건</p>
      {snapshot && <p className="t-small">조회 시각 {new Date(snapshot.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국시간) · 원본 {snapshot.total.toLocaleString('ko-KR')}건 중 {snapshot.scanned.toLocaleString('ko-KR')}건 확인{snapshot.limited ? ' · 일부 범위만 조회되어 전체 행사가 아닙니다.' : ''} 조회 시각은 개별 행사 정보의 수정 시각과 다릅니다.</p>}
      <fieldset className="sales-filters sales-fieldset" disabled={reading}>
        <Field label="행사·주최기관 검색">
          <input className="input" value={keyword} maxLength={120} placeholder="예: 전시, 축제, 성동구" onChange={e => { setKeyword(e.target.value); setPage(1) }} />
        </Field>
        <Field label="자치구 필터">
          <select className="select" value={district} onChange={e => { setDistrict(e.target.value); setPage(1) }}>
            <option value="">전체</option>
            {districts.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
        <Field label="행사 일정 상태">
          <select className="select" value={filter} onChange={e => { setFilter(e.target.value as StatusFilter); setPage(1) }}>
            <option value="active">예정·진행 중</option>
            <option value="scheduled">예정</option>
            <option value="ongoing">진행 중</option>
            <option value="ended">종료</option>
            <option value="unknown">일정 확인 필요</option>
            <option value="all">전체</option>
          </select>
        </Field>
      </fieldset>
      <section className="sales-list" aria-label="문화행사 검색 결과">
        <p role="status">불러온 목록에서 조건에 맞는 행사 {results.length.toLocaleString('ko-KR')}건 · 한 페이지 {PAGE_SIZE}건</p>
        {!visible.length && <p className="sales-empty">조건에 맞는 행사가 없습니다. 전체 일정 상태를 선택하거나 검색어를 지워 보세요.</p>}
        {visible.map(({ event, status }, index) => {
          const url = event.url && safeWebUrl(event.url) ? event.url : ''
          return <article className="sales-activity" key={`${event.id}:${index}`}>
            <strong>{event.title}</strong>
            <p className="t-small">{[eventStatusLabels[status], event.category, event.district].filter(Boolean).join(' · ')}</p>
            <dl className="sales-copy">
              <dt>행사 일정</dt><dd>{event.start || event.end ? [event.start, event.end && event.end !== event.start ? event.end : ''].filter(Boolean).join(' ~ ') : '원문 확인'}</dd>
              <dt>장소</dt><dd>{event.venue || '원문 확인'}</dd>
              <dt>주최기관</dt><dd>{event.organization || '원문 확인'}</dd>
            </dl>
            <div className="row wrap">
              {url && <a className="btn btn-outline" href={url} target="_blank" rel="noreferrer">행사 원문 확인</a>}
              <Button kind="outline" disabled={reading} onClick={() => onEvent(event)}>
                {status === 'ended' ? '다음 회차 영업 검토' : '협업 후보로 검토'}
              </Button>
            </div>
          </article>
        })}
        {pageCount > 1 && <div className="row wrap sales-pager" aria-label="문화행사 검색 페이지">
          <Button kind="outline" disabled={reading || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</Button>
          <span>{currentPage} / {pageCount}페이지</span>
          <Button kind="outline" disabled={reading || currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>다음</Button>
        </div>}
      </section>
    </>}
  </section>
}
