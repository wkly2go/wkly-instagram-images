import { useEffect, useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { relativeLabel } from '../lib/date'
import { useRouter } from '../lib/router'
import type { AgentInstruction, InstructionStatus } from '../lib/types'
import { Badge, Button, SectionHead, type Tone } from './ui'

const TONE: Record<InstructionStatus, Tone> = { 대기: 'yellow', '진행 중': 'acid', 완료: 'blue', 보류: 'paper' }

/** AI 팀원(WKLY 총괄)에게 직접 지시. 바로 처리하고 답을 남김 (메일 확인이 필요한 일은 평일 08:24 정기 실행) */
export function AgentDesk() {
  const { api, me, profiles, version, profileName } = useApp()
  const { busy, run } = useAction()
  const { query, navigate } = useRouter()
  const agents = profiles.filter(p => p.is_agent && p.active)
  const [agentId, setAgentId] = useState('')
  const [text, setText] = useState('')
  const ref = useRef<HTMLElement>(null)
  const { data: list, reload } = useAsync(() => api.listAgentInstructions(), [version], [] as AgentInstruction[])
  useEffect(() => api.subscribeChanges(['agent_instructions'], reload), [api, reload])
  useEffect(() => {
    if (query.get('agent')) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [query])
  if (!agents.length) return null
  const target = agentId || agents[0].id
  const send = async () => {
    const v = text.trim()
    if (!v) return
    if (await run(() => api.instructAgent(target, v), `${profileName(target)}에게 지시했습니다. 바로 처리하고 여기에 답을 남깁니다.`)) setText('')
  }
  const recent = list.slice(0, 6)
  return (
    <section className="section" ref={ref} aria-label="AI 팀원에게 지시">
      <SectionHead title="AI 팀원에게 지시" right={
          <span className="row gap-6">
            <span className="t-cap">바로 처리 · 메일 확인은 평일 08:24</span>
            <Button kind="outline" size="sm" onClick={() => navigate(`/chat?dm=${target}`)}>
              1:1 대화
            </Button>
          </span>
        } />
      <div className="box col gap-6" style={{ background: 'var(--white)' }}>
        <div className="row top gap-6">
          <Bot size={18} className="t-blue" style={{ marginTop: 8, flexShrink: 0 }} />
          {agents.length > 1 && (
            <select className="select" style={{ width: 130 }} value={target} onChange={e => setAgentId(e.target.value)} aria-label="AI 팀원">
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <textarea
            className="textarea grow"
            style={{ minHeight: 40 }}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
            }}
            placeholder={`${agents[0].name}에게 지시 (예: 다음 주 수금 예정 건 거래처별로 정리해 줘) · Ctrl+Enter 보내기`}
            maxLength={2000}
            aria-label="지시 내용"
          />
          <Button onClick={send} disabled={busy || !text.trim()}>
            지시
          </Button>
        </div>
        {recent.map(i => (
          <div key={i.id} className="instr">
            <div className="row">
              <Badge tone={TONE[i.status]}>{i.status}</Badge>
              <span className="t-smallb grow">{i.instruction}</span>
              <span className="t-cap nowrap">
                {profileName(i.created_by)} · {relativeLabel(i.created_at)}
              </span>
              {(i.status === '대기' && (i.created_by === me.id || me.role === 'admin')) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.confirm('이 지시를 취소할까요?') && run(() => api.deleteAgentInstruction(i.id), '지시를 취소했습니다.')}>
                  취소
                </button>
              )}
            </div>
            {i.response && (
              <p className="instr-res pre">
                <b>{profileName(i.agent_id)}</b> {i.response}
              </p>
            )}
          </div>
        ))}
        {recent.length === 0 && <span className="t-cap">아직 지시가 없습니다. 일정 정리 · 지연 업무 독촉 · 수금 현황 보고 · 리서치 등을 맡겨 보세요.</span>}
      </div>
    </section>
  )
}
