import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { todayKey } from '../lib/date'
import { safeWebUrl } from '../lib/growth'
import { parseSeoulEvents, readSeoulCsv, SEOUL_EVENT_DATASET, type SeoulEvent } from '../lib/seoulSales'
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
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [district, setDistrict] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)
  const readingRef = useRef(false)
  const today = todayKey()

  const districts = useMemo(() => [...new Set(events.map(event => event.district).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko')), [events])

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
    setReading(true)
    setError('')
    try {
      const imported = parseSeoulEvents(readSeoulCsv(await picked.arrayBuffer()))
      if (!imported.length) throw new Error('읽을 수 있는 행사 정보가 없습니다.')
      setEvents(imported)
      setFileName(picked.name)
      setDistrict('')
      setKeyword('')
      setFilter('active')
      setPage(1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '파일을 읽지 못했습니다.')
    } finally {
      readingRef.current = false
      setReading(false)
    }
  }

  return <section className="sales-pipeline" aria-label="서울시 문화행사 발굴">
    <h3 className="t-sub">문화행사에서 협업 후보 찾기</h3>
    <p className="sales-notice">행사 일정과 주최기관을 보고 연계 팝업 또는 다음 회차를 검토하세요. 참가·협업 모집 여부, 예산, 미발주 범위는 주최기관 원문이나 문의로 확인합니다.</p>
    <div className="sales-filters">
      <Field label="서울시 문화행사 CSV">
        <input type="file" className="input" accept=".csv,text/csv" disabled={reading} onChange={loadFile} />
      </Field>
      <a className="btn btn-outline" href={SEOUL_EVENT_DATASET} target="_blank" rel="noreferrer">서울시 원본 데이터</a>
    </div>
    <p className="t-small">원본 데이터의 Sheet 탭에서 내려받기(CSV)를 선택한 뒤 파일을 불러오세요.</p>
    {reading && <p role="status">행사 파일을 읽는 중입니다.</p>}
    {error && <p role="alert" className="sales-error">{error}</p>}
    {fileName && <>
      <p className="t-small">불러온 파일 {fileName} · 행사 {events.length.toLocaleString('ko-KR')}건</p>
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
        <p role="status">조건에 맞는 행사 {results.length.toLocaleString('ko-KR')}건</p>
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
