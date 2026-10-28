import { useEffect, useMemo, useRef, useState } from 'react'
import { Linkify } from './ui'
import { Bot } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { dateLabel, timeLabel, toDateKey, todayKey } from '../lib/date'
import { useRouter } from '../lib/router'
import type { AgentInstruction, Department, InstructionStatus, Profile } from '../lib/types'
import { Badge, Button, SectionHead, type Tone } from './ui'
import { ask } from './Ask'

const TONE: Record<InstructionStatus, Tone> = { 대기: 'yellow', '진행 중': 'acid', 완료: 'blue', 보류: 'paper' }

/** AI 팀원(WKLY 총괄)에게 직접 지시. 바로 처리하고 답을 남김 (메일 확인이 필요한 일은 평일 08:24 정기 실행) */
export function AgentDesk() {
  const { api, me, version, profileName } = useApp()
  const { busy, run } = useAction()
  const { query, navigate } = useRouter()
  // 팀원은 자기 팀 AI 팀장, 대표는 총괄 먼저
  const agents = useMyAgents()
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
    let id = ''
    if (await run(async () => void (id = await api.instructAgent(target, v)), `${profileName(target)}에게 지시했습니다. 바로 처리하고 여기에 답을 남깁니다.`)) {
      setText('')
      if (id) setSent(s => new Set(s).add(id))
    }
  }
  const [showPast, setShowPast] = useState(false)
  // 기록은 늘 펼쳐 두지 않음 (대표 지시 2026-10-28): 방금 보낸 지시 · 처리 중인 내 지시만, 나머지는 '기록 보기'
  const [showLog, setShowLog] = useState(false)
  const [sent, setSent] = useState<Set<string>>(new Set())
  const todayList = list.filter(i => toDateKey(i.created_at) === todayKey())
  const pastCount = list.length - todayList.length
  const live = list.filter(i => sent.has(i.id) || (i.created_by === me.id && (i.status === '대기' || i.status === '진행 중') && toDateKey(i.created_at) === todayKey()))
  const recent = !showLog ? live : showPast ? list.slice(0, 40) : todayList
  // 일별로 묶어서 표시 (최근 날짜 먼저)
  const byDay = recent.reduce<{ day: string; items: AgentInstruction[] }[]>((acc, i) => {
    const day = toDateKey(i.created_at)
    const g = acc[acc.length - 1]
    if (g && g.day === day) g.items.push(i)
    else acc.push({ day, items: [i] })
    return acc
  }, [])
  return (
    <section className="section" ref={ref} aria-label="AI 팀원에게 지시">
      <SectionHead title="AI 팀원에게 지시" right={
          <span className="row gap-6">
            <span className="t-cap">바로 처리 · 메일 확인은 평일 08:24</span>
            <Button kind="outline" size="sm" onClick={() => (setShowLog(v => !v), setShowPast(false))}>
              {showLog ? '기록 접기' : `기록 보기${todayList.length ? ` (${todayList.length})` : ''}`}
            </Button>
            {showLog && pastCount > 0 && (
              <Button kind="outline" size="sm" onClick={() => setShowPast(v => !v)}>
                {showPast ? '오늘만' : `지난 지시 (${pastCount})`}
              </Button>
            )}
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
            placeholder={`${profileName(target)}에게 지시 (예: 다음 주 수금 예정 건 거래처별로 정리해 줘) · Ctrl+Enter 보내기`}
            maxLength={2000}
            aria-label="지시 내용"
          />
          <Button onClick={send} disabled={busy || !text.trim()}>
            지시
          </Button>
        </div>
        {byDay.map(g => (
          <div key={g.day} className="instr-day">
            <span className="instr-date">{g.day === todayKey() ? `오늘 · ${dateLabel(g.day)}` : dateLabel(g.day)}</span>
            {g.items.map(i => (
              <div key={i.id} className="instr">
                <div className="row">
                  <Badge tone={TONE[i.status]}>{i.status}</Badge>
                  <span className="t-smallb grow">{i.instruction}</span>
                  <span className="t-cap nowrap">
                    {profileName(i.created_by)} · {timeLabel(i.created_at)}
                  </span>
                  {(i.status === '대기' && (i.created_by === me.id || me.role === 'admin')) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={async () => (await ask('이 지시를 취소할까요?')) && run(() => api.deleteAgentInstruction(i.id), '지시를 취소했습니다.')}>
                      취소
                    </button>
                  )}
                </div>
                {i.response && (
                  <p className="instr-res pre">
                    <b>{profileName(i.agent_id)}</b> <Linkify text={i.response} />
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
        {showLog && recent.length === 0 && <span className="t-cap">{pastCount ? '오늘 지시한 내용이 없습니다.' : '아직 지시가 없습니다. 일정 정리 · 지연 업무 독촉 · 수금 현황 보고 · 리서치 등을 맡겨 보세요.'}</span>}
      </div>
    </section>
  )
}

/**
 * 위쪽 줄 AI 입력칸 (대표 지시 2026-10-22 "AI 검색창을 제일 상단으로") — 어느 화면에서나 WKLY 총괄에게 바로 묻기 · 지시
 *  - Enter 보내기 → 홈 'AI 팀원에게 지시'로 이동해 답을 바로 확인
 */
/**
 * 내가 지시할 AI (대표 지시 2026-10-28): 팀원은 자기 팀의 AI 팀장, 총괄은 대표(관리자)에게만
 *  - 팀 = 조직(departments)에서 내가 속한 팀. AI 팀장 직함이 '<팀 이름> 팀장 (AI)' 형태
 *  - 팀이 없거나 맞는 팀장이 없으면 AI 팀장 전체
 */
export function myAgents(profiles: Profile[], me: Profile, depts: Department[]): Profile[] {
  const agents = profiles.filter(p => p.is_agent && p.active)
  const hq = agents.filter(a => /총괄/.test(`${a.name} ${a.title ?? ''}`))
  const leads = agents.filter(a => !hq.includes(a))
  if (me.role === 'admin') return [...hq, ...leads]
  const mine = depts.filter(d => d.lead_id === me.id || d.member_ids.includes(me.id))
  const own = leads.filter(l => mine.some(d => (l.title ?? l.name).startsWith(d.name)))
  return own.length ? own : leads
}

export function useMyAgents(): Profile[] {
  const { api, profiles, me, version } = useApp()
  const { data: depts } = useAsync(() => api.listDepartments(), [version], [] as Department[])
  return useMemo(() => myAgents(profiles, me, depts), [profiles, me, depts])
}

