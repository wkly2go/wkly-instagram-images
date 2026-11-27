// 마케팅 자동화 흐름 (2026-11-27 대표 지시 '마케팅 자동화 프로그램 · 자동화 기획서를 바탕으로 제작')
// 광고·콘텐츠 › 콘텐츠·배포 › 자동화 흐름 — 분석 → 제작 → 승인·배포 → 광고 → 문의 → 수주를 한 줄로
// 이 화면은 스스로 만들거나 보내지 않는다 (제작은 사람이 원할 때만 · CRM 은 문의 · 요청이 있을 때만). 단계마다 '지금 할 일'만 알려 준다
import { ArrowRight, RefreshCw } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import { flowSteps, taggedRate, type MarketingFlow as Flow } from '../lib/marketingFlow'
import { Link } from '../lib/router'
import { Button, SectionHead } from './ui'
import './MarketingFlow.css'

export function MarketingFlow() {
  const { api, version, bump } = useApp()
  const flow = useAsync<Flow | null>(() => api.marketingFlow().catch(() => null), [api, version], null)
  const f = flow.data
  if (!f) return <section className="card mf-card"><SectionHead title="마케팅 자동화 흐름" /><p className="mf-empty">{flow.loading ? '불러오는 중…' : '아직 보여 줄 자료가 없습니다.'}</p></section>
  const steps = flowSteps(f)
  const todos = steps.filter(s => s.todo)
  const rate = taggedRate(f)
  return (
    <div className="mf">
      <section className="card mf-card">
        <SectionHead title="마케팅 자동화 흐름" right={<Button kind="outline" size="sm" onClick={bump}><RefreshCw size={13} /> 새로고침</Button>} />
        <p className="mf-rule">제작은 사람이 누를 때만 하고, 고객 관리는 문의 · 요청이 왔을 때만 진행합니다. 이 화면은 단계마다 지금 할 일만 알려 줍니다.</p>
        <ol className="mf-steps">
          {steps.map((s, i) => (
            <li key={s.key} className={`mf-step ${s.tone}`}>
              <div className="mf-step-head"><span className="mf-no">{i + 1}</span><b>{s.title}</b></div>
              {s.lines.map(line => <p key={line}>{line}</p>)}
              {s.todo && <p className="mf-todo">{s.todo}</p>}
              <Link to={s.link} className="mf-go">{s.linkLabel} <ArrowRight size={12} /></Link>
            </li>
          ))}
        </ol>
        <p className="mf-sum">{todos.length ? `지금 할 일 ${todos.length}가지: ${todos.map(t => t.title).join(' · ')}` : '지금 밀린 일이 없습니다.'} <small>({dateTimeLabel(f.at)} 기준)</small></p>
      </section>

      <section className="card mf-card">
        <SectionHead title="어디서 온 문의가 일이 되었나 (최근 90일)" />
        <p className="mf-rule">문의에 붙은 꼬리표(광고 · 게시물 주소의 캠페인 이름)별로 문의 → 프로젝트 → 진행 · 완료를 셉니다.{rate != null && ` 최근 30일 문의 중 꼬리표가 붙은 것은 ${rate}%입니다.`}</p>
        {f.by_campaign.length === 0 ? <p className="mf-empty">최근 90일 문의가 없습니다.</p> : (
          <div className="mf-table-wrap"><table className="mf-table">
            <thead><tr><th>꼬리표 (캠페인)</th><th>유입</th><th>문의</th><th>직접 문의</th><th>프로젝트</th><th>진행 · 완료</th></tr></thead>
            <tbody>{f.by_campaign.map(r => (
              <tr key={`${r.campaign}|${r.source}`}><td>{r.campaign}</td><td>{r.source}</td><td>{r.inquiries}</td><td>{r.direct}</td><td>{r.projects}</td><td>{r.won}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  )
}
