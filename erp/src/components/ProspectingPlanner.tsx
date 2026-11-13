import { useState } from 'react'
import { todayKey } from '../lib/date'
import { PROSPECT_PLAYS, RESEARCH_SOURCES, newProspectPlan, prospectPlay, researchLinks, prospectTimeline, researchReadiness, buildProspectDraft, type ProspectPlan } from '../lib/prospecting'
import type { SalesDraft } from '../lib/sales'
import { Button, Field } from './ui'

export function ProspectingPlanner({ owner, disabled, onPending, onApply }: { owner: string; disabled: boolean; onPending: (pending: boolean) => void; onApply: (draft: SalesDraft) => boolean }) {
  const [plan, setPlan] = useState(newProspectPlan)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(false)
  const patch = (value: Partial<ProspectPlan>) => { setPlan(p => ({ ...p, ...value })); setApplied(false); onPending(true); setError('') }
  const play = prospectPlay(plan.play), today = todayKey(), timeline = prospectTimeline(plan, today), readiness = researchReadiness(plan, today)
  const apply = () => {
    try { const draft = buildProspectDraft(plan, owner, today); if (onApply(draft)) { onPending(false); setApplied(true); setError('') } }
    catch (e) { setError(e instanceof Error ? e.message : '발굴 계획을 확인해 주세요.') }
  }
  const field = (label: string, key: 'target'|'industry'|'region'|'event'|'contact'|'sourceUrl'|'verifiedOn'|'start'|'end'|'month', type = 'text', max = 80) => <Field label={label}><input className="input" type={type} maxLength={max} value={plan[key]} onChange={e => patch({ [key]: e.target.value })} /></Field>
  return <section className="prospect-planner" aria-label="신규 대상 발굴 계획">
    <h3 className="t-sub">대상 찾기 → 공식 일정 확인 → 맞춤 제안</h3>
    <a href="/manual/growth.html#prospecting" target="_blank" rel="noopener noreferrer">발굴 계획 따라 하기</a>
    <p className="t-small">검색 링크는 새 창에서 열립니다. 확인한 사실을 아래에 적고 영업 정보에 적용한 뒤 저장하세요. 자동 수집·발송은 하지 않습니다.</p>
    <fieldset disabled={disabled} className="sales-fieldset form-grid">
      <Field label="발굴 경로" className="full"><select className="select" autoFocus value={plan.play} onChange={e => { const selected = prospectPlay(e.target.value as ProspectPlan['play']); patch({ play: selected.id, leadDays: selected.lead }) }}>{PROSPECT_PLAYS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
      <div className="full prospect-strategy"><strong>찾아볼 대상: {play.target}</strong><p>제안: {play.offer}</p><p>확인 자료: {play.evidence}</p><p>첫 질문: {play.question}</p></div>
      {field('대상 브랜드·기관 *', 'target')}{field('업종·제품', 'industry')}{field('관심 지역', 'region')}{field('검색 연월', 'month', 'month')}
      <div className="full prospect-searches"><h4>검색할 항목</h4>{researchLinks(plan).map(link => <div key={link.label}><strong>{link.label}</strong><small>{link.query}</small><a href={link.google} target="_blank" rel="noopener noreferrer">Google 검색</a> · <a href={link.naver} target="_blank" rel="noopener noreferrer">네이버 검색</a></div>)}</div>
      <div className="full prospect-sources"><h4>공식 일정·사업 확인</h4>{RESEARCH_SOURCES.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a> · {s.hint}</p>)}<p><a href="/tenders" target="_blank" rel="noopener noreferrer">인트라넷 나라장터</a> · 공고 원문·질의/제출 마감은 별도로 확인</p><p><a href="/clients" target="_blank" rel="noopener noreferrer">기존 거래처·담당자</a> · 재접촉 전 기존 활동·제안 여부를 확인</p></div>
      {field('행사·사업명', 'event', 'text', 120)}
      <Field label="일정 확인 상태"><select className="select" value={plan.certainty} onChange={e => patch({ certainty: e.target.value as ProspectPlan['certainty'] })}>{['미확인','예정','확인'].map(x => <option key={x}>{x}</option>)}</select></Field>
      {field('행사·사업 시작일', 'start', 'date')}{field('종료일 (선택)', 'end', 'date')}
      {field('공식 출처 주소', 'sourceUrl', 'url', 2000)}{field('출처 확인일', 'verifiedOn', 'date')}
      <Field label="확인 근거" className="full"><textarea className="textarea" rows={2} maxLength={2000} value={plan.evidence} onChange={e => patch({ evidence: e.target.value })} placeholder="공식 공지의 날짜·장소와 변경 여부. 검색 요약만으로 확정하지 마세요." /></Field>
      {field('담당 부서·공개 문의 창구', 'contact', 'text', 300)}
      <Field label="권장 준비 기간 (일)"><input className="input" type="number" min={7} max={180} step={1} value={plan.leadDays} onChange={e => patch({ leadDays: Number(e.target.value) })} /><small>업무별 제안값입니다. 실제 일정에 맞게 조정하세요.</small></Field>
      <Field label="수요·접근 계기" className="full"><textarea className="textarea" rows={3} maxLength={1000} value={plan.need} onChange={e => patch({ need: e.target.value })} placeholder="왜 지금 연락해야 하는지, 어떤 도움을 제안할지 적어 주세요." /></Field>
      <div className="full prospect-readiness"><strong>검토 준비도 {readiness.score}/100</strong><p className="t-cap">입력 충실도이며 수주 확률·검증된 신뢰 점수가 아닙니다.</p>{readiness.checks.map(c => <span key={c.label}>{c.done ? '✓' : '○'} {c.label} {c.points}점</span>)}</div>
      <div className="full"><h4>행사일에서 역산한 제안 일정</h4>{timeline.length ? <><p className="t-cap">{plan.certainty === '확인' ? '입력한 확인 일정 기준' : '미확정 일정 기준 가안'} · 한국 날짜 · 계약 마감과 입찰 마감은 별도 확인</p><ol className="prospect-timeline">{timeline.map((item,i) => <li key={i}><time>{item.date}</time><strong>{item.label}</strong>{item.overdue && <span className="sales-due">경과 · 일정 재조정</span>}</li>)}</ol></> : <p>행사 시작일을 확인하면 권장 일정이 표시됩니다.</p>}{plan.start && (plan.end || plan.start) < today && <p className="sales-notice">종료된 행사입니다. 결과 분석·다음 회차 제안으로 전환하세요.</p>}</div>
      <div className="full row wrap"><Button kind="outline" onClick={apply}>발굴 계획을 영업 정보에 적용</Button>{applied && <span role="status">적용했습니다. 아래 영업 정보를 확인한 뒤 저장하세요.</span>}</div>
      {error && <p role="alert" className="full sales-error">{error}</p>}
    </fieldset>
  </section>
}
