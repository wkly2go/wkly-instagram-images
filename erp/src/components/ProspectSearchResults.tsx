import { useEffect, useState } from 'react'
import { useApp } from '../lib/app'
import { safeWebUrl } from '../lib/growth'
import { todayKey } from '../lib/date'
import { fetchSeoulEvents } from '../lib/seoulEventClient'
import { validDate } from '../lib/prospecting'
import { defaultTenderQuery } from '../lib/tenderSearch'
import { Button } from './ui'

export interface ProspectSearchResult {
  id: string
  title: string
  sourceLabel: string
  sourceUrl: string
  snippet: string
  target?: string
  event?: string
  start?: string
  end?: string
  contact?: string
}

interface SearchGroup {
  label: string
  results?: ProspectSearchResult[]
  error?: string
  note?: string
}

type Sources = { local: boolean; official: boolean; publicTender?: boolean }

function matchQuery(text: string, terms: string[]): boolean {
  const content = text.toLocaleLowerCase('ko')
  return terms.every(term => content.includes(term))
}

export function ProspectSearchResults({ query, sources, onSelect, disabled = false }: {
  query: string
  sources: Sources
  onSelect: (result: ProspectSearchResult) => void
  disabled?: boolean
}) {
  const { api } = useApp()
  const { local, official, publicTender } = sources
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [selected, setSelected] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const term = query.trim()
    const words = term.toLocaleLowerCase('ko').split(/\s+/).filter(Boolean)

    const run = async (label: string, load: () => Promise<Pick<SearchGroup, 'results' | 'note'>>) => {
      try {
        const result = await load()
        if (!controller.signal.aborted) setGroups(current => current.map(group => group.label === label ? { label, ...result } : group))
      } catch {
        if (!controller.signal.aborted) setGroups(current => current.map(group => group.label === label ? { label, error: '자료를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.' } : group))
      }
    }

    const jobs: { label: string; load: () => Promise<Pick<SearchGroup, 'results' | 'note'>> }[] = []
    if (local) {
      const label = '기존 거래처·담당자'
      jobs.push({ label, load: async () => ({
        results: (await api.searchProspectingClients(term)).map(row => ({
          id: `client:${row.clientId}:${row.contactId ?? ''}`,
          title: row.clientName,
          sourceLabel: label,
          sourceUrl: row.website ?? '',
          snippet: [row.category, row.contactName, row.contactTitle].filter(Boolean).join(' · '),
          target: row.clientName,
          contact: [row.contactName, row.contactTitle].filter(Boolean).join(' · '),
        })),
      }) })
    }
    if (official) {
      const label = '서울 문화행사'
      jobs.push({ label, load: async () => {
        let snapshot, archived = false
        try { snapshot = await fetchSeoulEvents(controller.signal) }
        catch (error) {
          if (controller.signal.aborted) throw error
          snapshot = await fetchSeoulEvents(controller.signal, true)
          archived = true
        }
        const today = todayKey()
        const items = snapshot.events.filter(event => event.end >= today && matchQuery(
          [event.title, event.category, event.district, event.venue, event.organization].join(' '), words,
        ))
        return {
          note: archived || snapshot.archived ? `이전에 확보한 공개 자료 · ${snapshot.fetchedAt.slice(0, 10)} 조회` : '공개 목록의 조회 범위 안에서 검색합니다.',
          results: items.slice(0, 8).map(event => ({
            id: `seoul:${event.id}`, title: event.title, sourceLabel: label, sourceUrl: event.url,
            snippet: [`${event.start} ~ ${event.end}`, event.district, event.venue, event.organization, event.category].filter(Boolean).join(' · '),
            target: event.organization, event: event.title, start: event.start, end: event.end,
          })),
        }
      } })
    }
    if (official) {
      const label = '코엑스 일정'
      jobs.push({ label, load: async () => {
        const read = async (path: string) => {
          const response = await fetch(path, { signal: controller.signal, headers: { Accept: 'application/json' } })
          if (!response.ok) throw new Error('코엑스 조회 오류')
          return await response.json() as { rows?: unknown; fetchedAt?: unknown } | null
        }
        let data, archived = false
        try { data = await read('/api/prospect-events') }
        catch (error) {
          if (controller.signal.aborted) throw error
          data = await read('/data/coex-events.json')
          archived = true
        }
        const rows = data?.rows
        if (!Array.isArray(rows) || rows.length > 12) throw new Error('잘못된 코엑스 행사 목록')
        const results: ProspectSearchResult[] = []
        for (const row of rows) {
          if (!row || !['id','title','category','venue','start','end','url'].every(key => typeof row[key] === 'string')) continue
          if (!row.id || !row.title || !row.url || !safeWebUrl(row.url) || !validDate(row.start) || !validDate(row.end) || row.end < row.start) continue
          const url = new URL(row.url)
          if (url.protocol !== 'https:' || url.hostname !== 'www.coex.co.kr' || !/^\/exhibitions\/[^/]+\/$/.test(url.pathname) || row.end < todayKey()) continue
          if (!matchQuery([row.title, row.category, row.venue].join(' '), words)) continue
          results.push({ id: `coex:${row.id}`, title: row.title, sourceLabel: label, sourceUrl: url.href,
            snippet: [`${row.start} ~ ${row.end}`, row.venue, row.category].filter(Boolean).join(' · '),
            target: '', event: row.title, start: row.start, end: row.end })
        }
        return { results: results.slice(0, 8), note: archived && typeof data?.fetchedAt === 'string'
          ? `이전에 확보한 코엑스 공개 일정 · ${data.fetchedAt.slice(0, 10)} 조회`
          : '코엑스 공개 일정 첫 페이지의 조회 범위입니다.' }
      } })
    }
    if (publicTender) {
      const label = '나라장터 공고'
      jobs.push({ label, load: async () => {
        const params = defaultTenderQuery()
        const data = await api.searchTenders({ ...params, category: /인테리어|실내건축|리모델링|공사|시공/.test(term) ? 'construction' : 'service', keyword: term.slice(0, 100) })
        return {
          note: '최근 7일 등록 공고 중 첫 페이지를 조회합니다.',
          results: data.items.slice(0, 8).map(item => ({
            id: `g2b:${item.number}:${item.round}`, title: item.title, sourceLabel: label, sourceUrl: item.source_url,
            snippet: [item.agency, item.number, item.deadline && `마감 ${new Date(item.deadline).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`].filter(Boolean).join(' · '),
            target: item.agency, event: item.title,
          })),
        }
      } })
    }

    setGroups(jobs.map(({ label }) => ({ label })))
    setSelected('')
    for (const job of jobs) void run(job.label, job.load)
    return () => controller.abort()
  }, [api, local, official, publicTender, query])

  return <section className="prospect-search-results" aria-label="자료 검색 결과">
    <h4>자료 검색 결과 · {query}</h4>
    {groups.map(group => <section className="prospect-search-group" key={group.label} aria-label={group.label}>
      <h5>{group.label}</h5>
      {group.note && <p className="t-cap">{group.note}</p>}
      {group.error ? <p role="alert" className="sales-error">{group.error}</p>
        : group.results ? (group.results.length ? <div className="prospect-search-cards">
            {group.results.map(result => <article key={result.id}>
              <strong>{result.title}</strong>
              {result.snippet && <p>{result.snippet}</p>}
              <div className="row wrap">
                <Button kind="outline" size="sm" disabled={disabled} onClick={() => { onSelect(result); setSelected(result.id) }}>계획에 넣기</Button>
                {result.sourceUrl && safeWebUrl(result.sourceUrl) && <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer">원문 보기</a>}
              </div>
              {selected === result.id && <p className="t-cap" role="status">후보를 선택했습니다. 아래 적용 안내를 확인해 주세요.</p>}
            </article>)}
          </div> : <p className="t-small">조회한 범위에서 해당 자료를 찾지 못했습니다.</p>)
          : <p className="t-small" role="status">자료를 불러오는 중…</p>}
    </section>)}
  </section>
}
