// AI 팀·비용 › 'API 에이전트' (관리자) — 인트라넷 서버가 Claude 콘솔 API 로 돌리는 예약 에이전트
// 켜기 · 끄기 · 지금 실행 · 지시문 보기 · 이번 달 비용과 한도 · 최근 실행 기록
import { useState } from 'react'
import { Play } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import { MODEL_LABEL, scheduleLabel, type ApiAgent, type ApiAgentBudget, type ApiAgentRun } from '../lib/apiAgentsApi'
import { Badge, Button, Empty, SectionHead, type Tone } from './ui'

const S_TONE: Record<string, Tone> = { 완료: 'acid', 실패: 'red', '실행 중': 'blue', '한도 초과': 'yellow' }
const usd = (n: number) => `$${Number(n).toFixed(2)}`

export function ApiAgents() {
  const { api, toast } = useApp()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const agents = useAsync<ApiAgent[]>(() => api.apiAgents(), [api, tick], []).data ?? []
  const runs = useAsync<ApiAgentRun[]>(() => api.apiAgentRuns(40), [api, tick], []).data ?? []
  const budget = useAsync<ApiAgentBudget | null>(() => api.apiAgentBudget().catch(() => null), [api, tick], null).data
  const name = (id: string) => agents.find(a => a.id === id)?.name ?? '—'
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try { await fn(); toast(ok) } catch (e) { toast(e instanceof Error ? e.message : '처리하지 못했습니다.') } finally { setBusy(null); setTick(t => t + 1) }
  }
  const pct = budget && budget.cap_usd > 0 ? Math.min(100, Math.round((budget.month_usd / budget.cap_usd) * 100)) : 0
  return <div className="api-agents">
    <SectionHead title="API 에이전트" />
    <p className="tx-sub">인트라넷 서버가 Claude 콘솔 API 키로 정해진 시각에 돌립니다. 에이전트는 허락된 인트라넷 기능만 부르고, 메일 발송 · 게시 · 결제는 하지 않습니다.</p>
    {budget && <div className="api-budget">
      <span>이번 달 사용 <b>{usd(budget.month_usd)}</b> / 한도 {usd(budget.cap_usd)}</span>
      <span className="api-bar"><span style={{ width: `${pct}%` }} className={pct >= 80 ? 'warn' : ''} /></span>
      <span className="tx-sub">한도에 닿으면 그달은 실행하지 않습니다 · 비용은 토큰 · 웹 검색으로 계산한 추정값</span>
    </div>}
    {!agents.length ? <Empty>등록된 API 에이전트가 없습니다.</Empty> : <table className="table api-table">
      <thead><tr><th>에이전트</th><th>일정</th><th>모델</th><th>도구</th><th>마지막 실행</th><th /></tr></thead>
      <tbody>{agents.map(a => <tr key={a.id} className={a.enabled ? '' : 'off'}>
        <td><button type="button" className="link" onClick={() => setOpen(open === a.id ? null : a.id)}>{a.name}</button><div className="tx-sub">{a.group_name} · {a.code}</div>
          {open === a.id && <pre className="api-instr">{a.instructions}</pre>}</td>
        <td>{scheduleLabel(a)}</td>
        <td>{MODEL_LABEL[a.model] ?? a.model}</td>
        <td className="tx-sub">{a.web_search ? `웹 검색 ${a.web_max}회 · ` : ''}인트라넷 {a.rpcs.length}개</td>
        <td>{a.last_status ? <Badge tone={S_TONE[a.last_status] ?? 'gray'}>{a.last_status}</Badge> : <span className="tx-sub">아직 없음</span>}
          {a.last_run_at && <div className="tx-sub">{dateTimeLabel(a.last_run_at)}</div>}
          {a.last_summary && <div className="tx-sub api-sum">{a.last_summary}</div>}</td>
        <td className="api-actions">
          <Button size="sm" kind="outline" disabled={!!busy} onClick={() => void act(`run-${a.id}`, () => api.apiAgentRunNow(a.code), `${a.name} 실행을 시작했습니다. 몇 분 뒤 기록에 나옵니다.`)}><Play size={13} />{busy === `run-${a.id}` ? '시작 중…' : '지금 실행'}</Button>
          <Button size="sm" kind="ghost" disabled={!!busy} onClick={() => void act(`on-${a.id}`, () => api.apiAgentUpdate(a.id, { enabled: !a.enabled }), a.enabled ? '껐습니다.' : '켰습니다.')}>{a.enabled ? '끄기' : '켜기'}</Button>
        </td>
      </tr>)}</tbody>
    </table>}
    <SectionHead title="최근 실행" />
    {!runs.length ? <Empty>실행 기록이 없습니다.</Empty> : <table className="table api-table">
      <thead><tr><th>시작</th><th>에이전트</th><th>결과</th><th>토큰 (입력 · 출력)</th><th>웹 검색</th><th>비용</th></tr></thead>
      <tbody>{runs.map(r => <tr key={r.id}>
        <td>{dateTimeLabel(r.started_at)}<div className="tx-sub">{r.slot === 'manual' ? '지금 실행' : '예약'}</div></td>
        <td>{name(r.agent_id)}</td>
        <td><Badge tone={S_TONE[r.status] ?? 'gray'}>{r.status}</Badge><div className="tx-sub api-sum">{r.error ?? r.result ?? ''}</div></td>
        <td>{r.input_tokens.toLocaleString('ko-KR')} · {r.output_tokens.toLocaleString('ko-KR')}</td>
        <td>{r.web_searches}</td>
        <td>{usd(r.usd)}</td>
      </tr>)}</tbody>
    </table>}
  </div>
}
