// 보고 · 리서치 대시보드 (대표 지시 2026-11-12 "첫페이지에 대시보드 만들어" → "리서치와 보고서를 두개로 분리해")
//  - mode 'report' : 메뉴 '보고서' 맨 위 — 보고(업무 · 일일 보고)만: 이번 달 보고 · 결재 대기 · 승인 · 반려, 추이 · 종류별 · 작성자 · 대기 목록
//  - mode 'research': 메뉴 '리서치' 맨 위 — 리서치 자료 · 거래처 리서치 보고서: 이번 달 · 새 자료 · 누적, 추이 · 종류별 · 작성자 · 최근 자료
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { Link } from '../lib/router'
import { todayKey } from '../lib/date'
import type { ApprovalSummary, ResearchSummary } from '../lib/types'

const ym = (s: string) => s.slice(0, 7)
const addMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function ReportDashboard({ mode }: { mode: 'report' | 'research' }) {
  const { api, version, profileOf, profileName } = useApp()
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([])
  const [research, setResearch] = useState<ResearchSummary[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let on = true
    const load = mode === 'report' ? api.listApprovals().then(a => on && setApprovals(a)) : api.listResearch().then(r => on && setResearch(r))
    load.catch(() => undefined).finally(() => on && setLoading(false))
    return () => {
      on = false
    }
  }, [api, version, mode])

  const month = todayKey().slice(0, 7)
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => addMonth(month, i - 5)), [month])
  const days = (s: string) => Math.max(0, Math.round((Date.parse(`${todayKey()}T00:00:00`) - Date.parse(s.slice(0, 10) + 'T00:00:00')) / 864e5))
  // 공통 모양: 작성일 · 종류 · 작성자
  const items = useMemo(
    () =>
      mode === 'report'
        ? approvals.filter(a => a.kind.includes('보고')).map(a => ({ id: a.id, at: a.created_at, kind: a.kind as string, by: a.requested_by, title: a.title, status: a.status as string, src: null as string | null }))
        : research.map(r => ({ id: r.id, at: r.created_at, kind: r.kind as string, by: r.created_by, title: r.title, status: r.status as string, src: r.collected_by_agent })),
    [mode, approvals, research],
  )
  const thisM = items.filter(x => ym(x.at) === month)
  const lastM = items.filter(x => ym(x.at) === addMonth(month, -1)).length
  const trend = months.map(m => ({ m, n: items.filter(x => ym(x.at) === m).length }))
  const tMax = Math.max(1, ...trend.map(t => t.n))
  const count = (list: typeof items, key: (x: (typeof items)[number]) => string | null) => {
    const mm = new Map<string, number>()
    for (const x of list) {
      const k = key(x)
      if (k) mm.set(k, (mm.get(k) ?? 0) + 1)
    }
    return [...mm].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }
  const kinds = count(thisM, x => x.kind)
  const kMax = Math.max(1, ...kinds.map(k => k[1]))
  const writers = count(thisM, x => x.by)
  const wMax = Math.max(1, ...writers.map(w => w[1]))
  const waiting = items.filter(x => x.status === '대기').sort((a, b) => a.at.localeCompare(b.at))
  const isReport = mode === 'report'
  const home = isReport ? '/approvals' : '/research'
  const word = isReport ? '보고' : '리서치'

  if (loading) return <section className="rd card t-cap">{word} 현황 불러오는 중…</section>

  return (
    <section className="rd col gap-10" aria-label={`${word} 현황`}>
      <div className="ledger-kpis four">
        <div className="ledger-kpi in">
          <span className="t-cap">이번 달 {isReport ? '보고' : '리서치 자료'}</span>
          <b>{thisM.length}건</b>
          <span className="t-meta">지난달 {lastM}건</span>
        </div>
        {isReport ? (
          <>
            <Link to="/approvals" className={`ledger-kpi rd-kpi ${waiting.length ? 'out' : ''}`}>
              <span className="t-cap">결재 대기</span>
              <b>{waiting.length}건</b>
              <span className="t-meta">{waiting[0] ? `가장 오래된 것 ${days(waiting[0].at)}일 전` : '모두 처리됨'}</span>
            </Link>
            <div className="ledger-kpi net">
              <span className="t-cap">이번 달 승인</span>
              <b>{thisM.filter(x => x.status === '승인').length}건</b>
              <span className="t-meta">반려 {thisM.filter(x => x.status === '반려').length}건</span>
            </div>
            <div className="ledger-kpi">
              <span className="t-cap">누적 보고</span>
              <b>{items.length}건</b>
              <span className="t-meta">업무 · 일일 보고</span>
            </div>
          </>
        ) : (
          <>
            <div className="ledger-kpi net">
              <span className="t-cap">이번 달 거래처 리서치 보고서</span>
              <b>{thisM.filter(x => x.kind === '거래처 리포트').length}건</b>
              <span className="t-meta">누적 {items.filter(x => x.kind === '거래처 리포트').length}건</span>
            </div>
            <div className={`ledger-kpi ${items.some(x => x.status === '새 자료') ? 'out' : ''}`}>
              <span className="t-cap">아직 검토 안 한 새 자료</span>
              <b>{items.filter(x => x.status === '새 자료').length}건</b>
              <span className="t-meta">검토 완료 {items.filter(x => x.status === '검토 완료').length}건</span>
            </div>
            <div className="ledger-kpi">
              <span className="t-cap">누적 리서치</span>
              <b>{items.length}건</b>
              <span className="t-meta">활용 {items.filter(x => x.status === '활용').length}건</span>
            </div>
          </>
        )}
      </div>

      <div className="rd-grid">
        <section className="rd-box" aria-label="최근 6개월 작성">
          <b className="t-cap">최근 6개월 {word}</b>
          <div className="rd-bars">
            {trend.map(t => (
              <div key={t.m} className={`rd-month${t.m === month ? ' cur' : ''}`} title={`${t.m} · ${word} ${t.n}건`}>
                <div className="bar-pair">
                  <i className={isReport ? 'in' : 'net'} style={{ height: `${(t.n / tMax) * 100}%` }} />
                </div>
                <span>{Number(t.m.slice(5))}월</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rd-box" aria-label="이번 달 종류별">
          <b className="t-cap">이번 달 {word} 종류별</b>
          {kinds.length === 0 && <span className="t-meta">아직 없음</span>}
          {kinds.map(([k, v]) => (
            <Link key={k} to={isReport ? `/approvals?kind=${encodeURIComponent(k)}` : home} className="ledger-cat">
              <span className="truncate">{k}</span>
              <span className="meter">
                <i className="in" style={{ width: `${(v / kMax) * 100}%` }} />
              </span>
              <span className="t-meta">{v}건</span>
            </Link>
          ))}
        </section>

        <section className="rd-box" aria-label="이번 달 작성자">
          <b className="t-cap">이번 달 작성자 (사람 · AI)</b>
          {writers.length === 0 && <span className="t-meta">아직 없음</span>}
          {writers.map(([id, v]) => (
            <div key={id} className="ledger-cat">
              <span className="truncate">
                {profileName(id)}
                {profileOf(id)?.is_agent ? <span className="rd-ai">AI</span> : null}
              </span>
              <span className="meter">
                <i className="net" style={{ width: `${(v / wMax) * 100}%` }} />
              </span>
              <span className="t-meta">{v}건</span>
            </div>
          ))}
        </section>

        <section className="rd-box" aria-label={isReport ? '결재 대기' : '최근 리서치'}>
          <b className="t-cap">{isReport ? '결재 대기' : '최근 리서치'}</b>
          {(isReport ? waiting : [...items].sort((a, b) => b.at.localeCompare(a.at))).length === 0 && <span className="t-meta">{isReport ? '대기 중인 보고가 없습니다.' : '아직 없음'}</span>}
          {(isReport ? waiting : [...items].sort((a, b) => b.at.localeCompare(a.at))).slice(0, 5).map(x => (
            <Link key={x.id} to={isReport ? `/approvals?id=${x.id}` : home} className="rd-wait">
              <span className="truncate">{isReport ? x.title : `[${x.kind}] ${x.title}`}</span>
              <span className="t-meta">
                {x.by ? profileName(x.by) : x.src || '자동 수집'} · {days(x.at)}일 전
              </span>
            </Link>
          ))}
        </section>
      </div>
    </section>
  )
}
