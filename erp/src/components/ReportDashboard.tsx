// 보고서 대시보드 (대표 지시 2026-11-12 "첫페이지에 대시보드 만들어" · 보고서 양식 화면 맨 위)
//  - 2026-11-12 대표 지시 '보고와 리서치만': 보고(업무 · 일일 보고) · 리서치 자료 · 거래처 리서치 보고서만 셈
//  - 최근 6개월 작성 추이 · 리서치 종류별 · 작성자별(사람 · AI) · 보고 결재 대기 목록
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

export function ReportDashboard() {
  const { api, version, profileOf, profileName } = useApp()
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([])
  const [research, setResearch] = useState<ResearchSummary[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let on = true
    Promise.all([api.listApprovals().catch(() => [] as ApprovalSummary[]), api.listResearch().catch(() => [] as ResearchSummary[])])
      .then(([a, r]) => {
        if (!on) return
        setApprovals(a)
        setResearch(r)
      })
      .finally(() => on && setLoading(false))
    return () => {
      on = false
    }
  }, [api, version])

  const month = todayKey().slice(0, 7)
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => addMonth(month, i - 5)), [month])
  const reportsOnly = approvals.filter(a => a.kind.includes('보고'))
  const reports = research.filter(r => r.kind === '거래처 리포트')
  const thisA = reportsOnly.filter(a => ym(a.created_at) === month)
  const thisRes = research.filter(r => ym(r.created_at) === month)
  const thisR = reports.filter(r => ym(r.created_at) === month)
  const waiting = reportsOnly.filter(a => a.status === '대기').sort((a, b) => a.created_at.localeCompare(b.created_at))
  const lastA = reportsOnly.filter(a => ym(a.created_at) === addMonth(month, -1)).length

  const trend = months.map(m => ({ m, a: reportsOnly.filter(x => ym(x.created_at) === m).length, r: research.filter(x => ym(x.created_at) === m).length }))
  const tMax = Math.max(1, ...trend.map(t => Math.max(t.a, t.r)))
  const kinds = useMemo(() => {
    const mm = new Map<string, number>()
    for (const r of thisRes) mm.set(r.kind, (mm.get(r.kind) ?? 0) + 1)
    return [...mm].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [thisRes])
  const kMax = Math.max(1, ...kinds.map(k => k[1]))
  const writers = useMemo(() => {
    const mm = new Map<string, number>()
    for (const a of thisA) if (a.requested_by) mm.set(a.requested_by, (mm.get(a.requested_by) ?? 0) + 1)
    for (const r of thisRes) {
      const w = r.created_by ?? null
      if (w) mm.set(w, (mm.get(w) ?? 0) + 1)
    }
    return [...mm].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [thisA, thisRes])
  const wMax = Math.max(1, ...writers.map(w => w[1]))
  const days = (s: string) => Math.max(0, Math.round((Date.parse(`${todayKey()}T00:00:00`) - Date.parse(s.slice(0, 10) + 'T00:00:00')) / 864e5))

  if (loading) return <section className="rd card t-cap">보고서 현황 불러오는 중…</section>

  return (
    <section className="rd col gap-10" aria-label="보고 · 리서치 현황">
      <div className="ledger-kpis four">
        <div className="ledger-kpi in">
          <span className="t-cap">이번 달 보고</span>
          <b>{thisA.length}건</b>
          <span className="t-meta">지난달 {lastA}건</span>
        </div>
        <Link to="/approvals" className={`ledger-kpi rd-kpi ${waiting.length ? 'out' : ''}`}>
          <span className="t-cap">보고 결재 대기</span>
          <b>{waiting.length}건</b>
          <span className="t-meta">{waiting[0] ? `가장 오래된 것 ${days(waiting[0].created_at)}일 전` : '모두 처리됨'}</span>
        </Link>
        <Link to="/approvals?section=research" className="ledger-kpi rd-kpi net">
          <span className="t-cap">이번 달 리서치 보고서</span>
          <b>{thisR.length}건</b>
          <span className="t-meta">누적 {reports.length}건</span>
        </Link>
        <Link to="/approvals?section=research" className="ledger-kpi rd-kpi">
          <span className="t-cap">이번 달 리서치 자료</span>
          <b>{thisRes.length}건</b>
          <span className="t-meta">누적 {research.length}건</span>
        </Link>
      </div>

      <div className="rd-grid">
        <section className="rd-box" aria-label="최근 6개월 작성 추이">
          <div className="row t-cap">
            <b className="grow">최근 6개월 작성</b>
            <span className="lg-key in" /> 보고 <span className="lg-key net" /> 리서치
          </div>
          <div className="rd-bars">
            {trend.map(t => (
              <div key={t.m} className={`rd-month${t.m === month ? ' cur' : ''}`} title={`${t.m} · 보고 ${t.a}건 · 리서치 ${t.r}건`}>
                <div className="bar-pair">
                  <i className="in" style={{ height: `${(t.a / tMax) * 100}%` }} />
                  <i className="net" style={{ height: `${(t.r / tMax) * 100}%` }} />
                </div>
                <span>{Number(t.m.slice(5))}월</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rd-box" aria-label="이번 달 리서치 종류별">
          <b className="t-cap">이번 달 리서치 종류별</b>
          {kinds.length === 0 && <span className="t-meta">아직 없음</span>}
          {kinds.map(([k, v]) => (
            <Link key={k} to="/approvals?section=research" className="ledger-cat">
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

        <section className="rd-box" aria-label="결재 대기">
          <div className="row t-cap">
            <b className="grow">보고 결재 대기</b>
            <Link to="/approvals" className="link-btn">
              전체 보기
            </Link>
          </div>
          {waiting.length === 0 && <span className="t-meta">대기 중인 보고가 없습니다.</span>}
          {waiting.slice(0, 5).map(a => (
            <Link key={a.id} to={`/approvals?id=${a.id}`} className="rd-wait">
              <span className="truncate">{a.title}</span>
              <span className="t-meta">
                {profileName(a.requested_by)} · {days(a.created_at)}일 전
              </span>
            </Link>
          ))}
        </section>
      </div>
    </section>
  )
}
