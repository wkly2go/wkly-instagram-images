// 프로젝트 '대화' 모아 보기 (2026-11-19 대표 지시 '개선해' · 기획 '메신저 협업 단순화' — 같은 일이 다섯 군데에 흩어지던 것을 한 줄로)
// 인트라넷 채팅 · 슬랙 · 카톡 · 메일 · 외부 협업방을 출처 표시와 함께 날짜별로. 읽기만 — 원래 칸(아래 슬랙 · 카톡 · 메일 · 협업방)은 그대로.
import { useMemo, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { timeLabel } from '../lib/date'
import { countBySource, groupByDay, PAGE_SIZE, timelineLink, TIMELINE_SOURCES, type TimelineItem, type TimelineSource } from '../lib/projectTimeline'
import type { Project } from '../lib/types'
import { Linkify, SectionHead } from './ui'
import './ProjectTalk.css'

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const dayLabel = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))} (${DOW[new Date(`${d}T00:00:00+09:00`).getDay()]})`

export function ProjectTalk({ project }: { project: Project }) {
  const { api, version } = useApp()
  const first = useAsync(() => api.projectTimeline(project.id), [api, project.id, version], [] as TimelineItem[])
  const [more, setMore] = useState<TimelineItem[]>([])
  const [ended, setEnded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState<TimelineSource | '전체'>('전체')
  const [open, setOpen] = useState(true)
  const all = useMemo(() => [...first.data, ...more], [first.data, more])
  const counts = useMemo(() => countBySource(all), [all])
  const shown = useMemo(() => (pick === '전체' ? all : all.filter(i => i.source === pick)), [all, pick])
  const days = useMemo(() => groupByDay(shown), [shown])
  const loadMore = async () => {
    const last = all[all.length - 1]
    if (!last) return
    setBusy(true)
    try {
      const next = await api.projectTimeline(project.id, last.at)
      setMore(m => [...m, ...next])
      if (next.length < PAGE_SIZE) setEnded(true)
    } finally { setBusy(false) }
  }
  if (!first.loading && !first.error && all.length === 0) return null
  return (
    <section className="section ptalk" aria-label="프로젝트 대화 모아 보기">
      <SectionHead
        title="대화 모아 보기"
        count={all.length ? `${all.length}${ended || all.length < PAGE_SIZE ? '' : '+'}` : undefined}
        right={<button type="button" className="ptalk-fold" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '접기' : '펼치기'}</button>}
      />
      {open && (
        <>
          <p className="ptalk-note">인트라넷 채팅 · 슬랙 · 카톡 · 메일 · 외부 협업방에서 이 프로젝트에 붙은 글을 한 줄로 모았습니다. 원문은 줄을 눌러 엽니다.</p>
          <div className="chips" role="group" aria-label="출처로 거르기">
            <button type="button" className={`chip${pick === '전체' ? ' active' : ''}`} aria-pressed={pick === '전체'} onClick={() => setPick('전체')}>전체 {all.length}</button>
            {TIMELINE_SOURCES.filter(s => counts[s] > 0).map(s => (
              <button key={s} type="button" className={`chip${pick === s ? ' active' : ''}`} aria-pressed={pick === s} onClick={() => setPick(s)}>{s} {counts[s]}</button>
            ))}
          </div>
          {first.error && <p className="ptalk-note" role="alert">{first.error}</p>}
          {first.loading ? <p className="ptalk-note" role="status">대화를 모으고 있습니다.</p> : (
            <ol className="ptalk-days">
              {days.map(d => (
                <li key={d.day}>
                  <h4>{dayLabel(d.day)}</h4>
                  <ul>
                    {d.items.map((it, i) => {
                      const link = timelineLink(it)
                      const inner = (
                        <>
                          <span className={`ptalk-src s-${it.source}`}>{it.source}</span>
                          <span className="ptalk-time">{timeLabel(it.at)}</span>
                          <b className="ptalk-who">{it.who || '이름 없음'}</b>
                          <span className="ptalk-body"><Linkify text={it.body} /></span>
                        </>
                      )
                      return (
                        <li key={`${it.ref}-${it.at}-${i}`}>
                          {link ? <a className="ptalk-row" href={link.href} target={link.external ? '_blank' : undefined} rel={link.external ? 'noopener noreferrer' : undefined}>{inner}</a> : <div className="ptalk-row">{inner}</div>}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          )}
          {!first.loading && !ended && all.length >= PAGE_SIZE && (
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void loadMore()}>{busy ? '불러오는 중…' : '더 지난 대화'}</button>
          )}
        </>
      )}
    </section>
  )
}
