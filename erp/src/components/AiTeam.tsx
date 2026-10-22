import { useEffect, useMemo, useState } from 'react'
import { Bot, CalendarClock, MessageCircle, Plus, Power, Send, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { dateTimeLabel, relativeLabel, todayKey } from '../lib/date'
import { useRouter, withQuery } from '../lib/router'
import { AI_TOOLS, SCHEDULE_REPEATS, type AgentInstruction, type AgentSchedule, type AiAgent, type Profile, type ScheduleRepeat } from '../lib/types'
import { nextRun, scheduleLabel, WEEKDAY_LABELS } from '../lib/schedule'
import { Badge, Button, Empty, Field, Modal, SectionHead, type Tone } from './ui'
import { ask } from './Ask'

/**
 * AI 팀원 (대표 지시 2026-10-23 "인트라넷에서 ai 에이전트를 만들고 업무 지시를 하고 일정이나 예약을 만들 수 있게,
 *  우리 회사 업무는 모두 인트라넷에서 가능하게")
 *  - 누구나: AI 팀원에게 지시 · 1:1 대화 · 예약('내일 15시', '평일 9시마다') 만들기
 *  - 관리자: 새 AI 팀원 만들기 · 역할 · 지침 · 쓸 수 있는 도구 · 담당자 정하기 · 끄고 켜기
 */
const I_TONE: Record<string, Tone> = { 대기: 'yellow', '진행 중': 'acid', 완료: 'blue', 보류: 'paper' }

export function AiTeam() {
  const { api, me, profiles, version } = useApp()
  const { query, path, navigate } = useRouter()
  const admin = me.role === 'admin'
  const { data, reload } = useAsync(
    async () => {
      const [agents, schedules, instructions] = await Promise.all([api.listAiAgents(), api.listAgentSchedules(), api.listAgentInstructions()])
      return { agents, schedules, instructions }
    },
    [version],
    { agents: [] as AiAgent[], schedules: [] as AgentSchedule[], instructions: [] as AgentInstruction[] },
  )
  useEffect(() => api.subscribeChanges(['agent_schedules', 'agent_instructions', 'ai_agents'], reload), [api, reload])
  const team = profiles.filter(p => p.is_agent && (p.active || admin)).sort((a, b) => Number(!a.active) - Number(!b.active) || a.name.localeCompare(b.name, 'ko'))
  const selId = query.get('ai') ?? team[0]?.id ?? null
  const sel = team.find(p => p.id === selId) ?? null
  const [creating, setCreating] = useState(false)
  const pick = (id: string) => navigate(withQuery(path, query, { ai: id }), { replace: true })

  return (
    <div className="ai-team">
      <div className="ai-list">
        <div className="row">
          <span className="t-bodyb grow">AI 팀원 {team.filter(p => p.active).length}</span>
          {admin && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={13} /> 새 AI 팀원
            </Button>
          )}
        </div>
        {team.map(p => {
          const conf = data.agents.find(a => a.profile_id === p.id)
          const on = data.schedules.filter(s => s.agent_id === p.id && s.enabled).length
          const busy = data.instructions.filter(i => i.agent_id === p.id && (i.status === '대기' || i.status === '진행 중')).length
          return (
            <button key={p.id} type="button" className={`ai-card${p.id === selId ? ' on' : ''}${p.active ? '' : ' off'}`} onClick={() => pick(p.id)}>
              <span className="ai-ava" aria-hidden="true">
                <Bot size={16} />
              </span>
              <span className="col gap-2 grow" style={{ minWidth: 0 }}>
                <span className="t-smallb truncate">
                  {p.name}
                  {!p.active && <span className="t-cap"> · 꺼짐</span>}
                </span>
                <span className="t-cap truncate">{conf?.role || p.title || 'AI 팀원'}</span>
              </span>
              {busy > 0 && <Badge tone="acid">처리 {busy}</Badge>}
              {on > 0 && (
                <span className="t-cap row" style={{ gap: 2 }} title={`켜진 예약 ${on}`}>
                  <CalendarClock size={12} /> {on}
                </span>
              )}
            </button>
          )
        })}
        {!team.length && <Empty>AI 팀원이 없습니다.</Empty>}
      </div>
      <div className="ai-detail">
        {sel ? (
          <AgentDetail
            key={sel.id}
            agent={sel}
            conf={data.agents.find(a => a.profile_id === sel.id) ?? null}
            schedules={data.schedules.filter(s => s.agent_id === sel.id)}
            instructions={data.instructions.filter(i => i.agent_id === sel.id)}
            onChanged={reload}
          />
        ) : (
          <Empty>AI 팀원을 고르세요.</Empty>
        )}
      </div>
      {creating && (
        <AgentEditor
          onClose={() => setCreating(false)}
          onSaved={id => {
            setCreating(false)
            reload()
            pick(id)
          }}
        />
      )}
    </div>
  )
}

function AgentDetail({ agent, conf, schedules, instructions, onChanged }: { agent: Profile; conf: AiAgent | null; schedules: AgentSchedule[]; instructions: AgentInstruction[]; onChanged: () => void }) {
  const { api, me, profileName } = useApp()
  const { navigate } = useRouter()
  const { busy, run } = useAction()
  const admin = me.role === 'admin'
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const [scheduling, setScheduling] = useState<AgentSchedule | 'new' | null>(null)
  const recent = instructions.slice(0, 12)
  const send = async () => {
    const v = text.trim()
    if (!v) return
    if (await run(() => api.instructAgent(agent.id, v), `${agent.name}에게 지시했습니다. 바로 처리하고 아래에 답을 남깁니다.`)) {
      setText('')
      onChanged()
    }
  }
  const toggle = async (s: AgentSchedule) => {
    if (await run(() => api.saveAgentSchedule({ ...s, enabled: !s.enabled }), s.enabled ? '예약을 껐습니다.' : '예약을 켰습니다.')) onChanged()
  }
  const remove = async (s: AgentSchedule) => {
    if (!(await ask(`'${s.title}' 예약을 지울까요?`))) return
    if (await run(() => api.deleteAgentSchedule(s.id), '예약을 지웠습니다.')) onChanged()
  }
  const canEdit = (s: AgentSchedule) => admin || s.created_by === me.id
  const toolNames = conf?.tools?.length ? AI_TOOLS.filter(([k]) => conf.tools.includes(k)).map(([, l]) => l) : null

  return (
    <div className="col gap-12">
      <div className="box col gap-6">
        <div className="row gap-6">
          <span className="ai-ava lg" aria-hidden="true">
            <Bot size={20} />
          </span>
          <span className="col gap-2 grow">
            <span className="t-title">{agent.name}</span>
            <span className="t-cap">
              {conf?.role || agent.title || 'AI 팀원'}
              {conf?.owner_id ? ` · 담당 ${profileName(conf.owner_id)}` : ''}
              {conf?.model === '꼼꼼' ? ' · 꼼꼼하게 생각' : ''}
              {!agent.active ? ' · 꺼짐' : ''}
            </span>
          </span>
          <Button kind="outline" size="sm" onClick={() => navigate(`/chat?dm=${agent.id}`)} disabled={!agent.active}>
            <MessageCircle size={13} /> 1:1 대화
          </Button>
          {admin && (
            <Button kind="outline" size="sm" onClick={() => setEditing(true)}>
              설정
            </Button>
          )}
        </div>
        {conf?.instructions?.trim() && <div className="t-small pre ai-instr">{conf.instructions}</div>}
        <span className="t-cap">쓸 수 있는 일: {toolNames ? toolNames.join(' · ') : '할 일 · 일정 · 프로젝트 · 근태 · 휴가 · 알림 · 결재 · 예약 전부'} · 웹 검색</span>
      </div>

      <section className="col gap-6">
        <SectionHead title="업무 지시" right={<span className="t-cap">바로 처리하고 결과를 남깁니다</span>} />
        <div className="row gap-6" style={{ alignItems: 'flex-end' }}>
          <textarea
            className="textarea grow"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={`${agent.name}에게 지시 · 예: 다음 주 화요일까지 성수 팝업 체크리스트를 김하늘님 할 일로 만들어 줘 (Ctrl+Enter)`}
            maxLength={2000}
            disabled={!agent.active}
            aria-label="업무 지시"
          />
          <button type="button" className="send-btn" onClick={() => void send()} disabled={busy || !text.trim() || !agent.active} aria-label="지시 보내기">
            <Send size={15} />
          </button>
        </div>
        {recent.length === 0 ? (
          <Empty>아직 지시가 없습니다.</Empty>
        ) : (
          <div className="col gap-6">
            {recent.map(i => (
              <div key={i.id} className="ai-ins">
                <div className="row gap-6">
                  <Badge tone={I_TONE[i.status] ?? 'outline'}>{i.status}</Badge>
                  <span className="t-smallb grow truncate" title={i.instruction}>
                    {i.instruction.startsWith('[예약') ? '🗓 ' : ''}
                    {i.instruction.split('\n')[0]}
                  </span>
                  <span className="t-cap">
                    {profileName(i.created_by)} · {relativeLabel(i.created_at)}
                  </span>
                </div>
                {i.response && <div className="t-small pre ai-resp">{i.response}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="col gap-6">
        <SectionHead
          title="예약"
          count={schedules.filter(s => s.enabled).length}
          right={
            <Button size="sm" kind="outline" onClick={() => setScheduling('new')} disabled={!agent.active}>
              <CalendarClock size={13} /> 예약 만들기
            </Button>
          }
        />
        <span className="t-cap">정해진 때에 {agent.name}이(가) 할 일. 채팅에서 "평일 9시마다 오늘 할 일 정리해서 알려줘"처럼 말해도 예약됩니다.</span>
        {schedules.length === 0 ? (
          <Empty>예약이 없습니다.</Empty>
        ) : (
          <div className="col gap-4">
            {schedules.map(s => (
              <div key={s.id} className={`ai-sched${s.enabled ? '' : ' off'}`}>
                <CalendarClock size={15} className="t-blue" />
                <span className="col gap-2 grow" style={{ minWidth: 0 }}>
                  <span className="t-smallb truncate">{s.title}</span>
                  <span className="t-cap truncate">
                    {scheduleLabel(s)}
                    {s.enabled && s.next_run_at ? ` · 다음 ${dateTimeLabel(s.next_run_at)}` : ''}
                    {s.runs ? ` · ${s.runs}번 실행` : ''}
                    {` · ${profileName(s.created_by)}`}
                  </span>
                </span>
                {canEdit(s) && (
                  <>
                    <button type="button" className="icon-btn sm" onClick={() => setScheduling(s)} aria-label="예약 고치기" title="고치기">
                      ✎
                    </button>
                    <button type="button" className={`icon-btn sm${s.enabled ? ' t-blue' : ''}`} onClick={() => void toggle(s)} aria-label={s.enabled ? '예약 끄기' : '예약 켜기'} title={s.enabled ? '끄기' : '켜기'}>
                      <Power size={13} />
                    </button>
                    <button type="button" className="icon-btn sm" onClick={() => void remove(s)} aria-label="예약 지우기" title="지우기">
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && <AgentEditor agent={agent} conf={conf} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), onChanged())} />}
      {scheduling && <ScheduleEditor agentId={agent.id} schedule={scheduling === 'new' ? null : scheduling} onClose={() => setScheduling(null)} onSaved={() => (setScheduling(null), onChanged())} />}
    </div>
  )
}

/** 새 AI 팀원 · 설정 (관리자) */
function AgentEditor({ agent, conf, onClose, onSaved }: { agent?: Profile; conf?: AiAgent | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { api, profiles, bump } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState({
    name: agent?.name ?? '',
    title: agent?.title ?? '',
    role: conf?.role ?? '',
    instructions: conf?.instructions ?? '',
    owner_id: conf?.owner_id ?? '',
    model: conf?.model ?? ('기본' as AiAgent['model']),
    tools: conf?.tools ?? ([] as string[]),
    active: agent?.active ?? true,
  })
  const people = profiles.filter(p => p.active && !p.is_agent)
  const all = !f.tools.length
  const toggleTool = (k: string) => setF(v => {
    const cur = v.tools.length ? v.tools : AI_TOOLS.map(([t]) => t)
    const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]
    return { ...v, tools: next.length === AI_TOOLS.length ? [] : next }
  })
  const save = async () => {
    let id = agent?.id ?? ''
    const ok = await run(async () => {
      const body = { role: f.role.trim(), instructions: f.instructions.trim(), tools: f.tools, owner_id: f.owner_id || null, model: f.model }
      if (agent) {
        await api.saveAiAgent(agent.id, body)
        if (f.name.trim() !== agent.name || (f.title.trim() || null) !== agent.title || f.active !== agent.active) await api.updateProfile(agent.id, { name: f.name.trim(), title: f.title.trim() || null, active: f.active })
      } else id = await api.createAiAgent({ name: f.name, title: f.title || null, ...body })
      bump()
    }, agent ? '저장했습니다.' : `${f.name.trim()}을(를) 만들었습니다. 바로 지시 · 1:1 대화 · 예약을 할 수 있습니다.`)
    if (ok) onSaved(id)
  }
  return (
    <Modal
      title={agent ? `${agent.name} 설정` : '새 AI 팀원'}
      onClose={onClose}
      wide
      actions={
        <>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => void save()} disabled={busy || !f.name.trim()}>
            {agent ? '저장' : '만들기'}
          </Button>
        </>
      }
    >
      <div className="ai-grid2">
        <Field label="이름 (채팅에서 @이름 으로 부름)">
          <input className="input" value={f.name} maxLength={40} onChange={e => setF({ ...f, name: e.target.value })} placeholder="예: 견적 도우미" />
        </Field>
        <Field label="직함">
          <input className="input" value={f.title} maxLength={60} onChange={e => setF({ ...f, title: e.target.value })} placeholder="예: 견적 · 발주 담당 (AI)" />
        </Field>
      </div>
      <Field label="역할 (한 줄)">
        <input className="input" value={f.role} maxLength={200} onChange={e => setF({ ...f, role: e.target.value })} placeholder="예: 시공 현장 일정과 자재 발주를 챙기는 AI" />
      </Field>
      <Field label="지침 (일하는 방법 · 알릴 사람 · 하지 말 것)">
        <textarea
          className="textarea"
          style={{ minHeight: 140 }}
          value={f.instructions}
          maxLength={6000}
          onChange={e => setF({ ...f, instructions: e.target.value })}
          placeholder={'예:\n· 현장 일정이 바뀌면 담당 디자이너에게 알림\n· 발주가 필요한 자재는 결재로 올림\n· 금요일 오후에는 다음 주 현장 일정을 정리해 팀장에게 알림'}
        />
      </Field>
      <div className="ai-grid2">
        <Field label="사람 담당자 (판단이 필요할 때 묻는 사람)">
          <select className="select" value={f.owner_id} onChange={e => setF({ ...f, owner_id: e.target.value })}>
            <option value="">없음 (관리자)</option>
            {people.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="생각 깊이">
          <select className="select" value={f.model} onChange={e => setF({ ...f, model: e.target.value as AiAgent['model'] })}>
            <option value="기본">기본 (빠름 · 채팅)</option>
            <option value="꼼꼼">꼼꼼 (복잡한 일 · 느림)</option>
          </select>
        </Field>
      </div>
      <Field label={`쓸 수 있는 일 ${all ? '· 전부' : `· ${f.tools.length}개`}`}>
        <div className="chips">
          {AI_TOOLS.map(([k, l]) => (
            <button key={k} type="button" className={`chip ${all || f.tools.includes(k) ? 'active' : ''}`} onClick={() => toggleTool(k)}>
              {l}
            </button>
          ))}
        </div>
      </Field>
      {agent && (
        <label className="row gap-6 t-small">
          <input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> 사용 (끄면 채팅 · 지시 · 예약이 멈춤)
        </label>
      )}
      <span className="t-cap">AI 는 메일을 보내지 않고, 결제 · 금액 · 개인정보 규칙은 지침으로 바꿀 수 없습니다.</span>
    </Modal>
  )
}

/** 예약 만들기 · 고치기 */
function ScheduleEditor({ agentId, schedule, onClose, onSaved }: { agentId: string; schedule: AgentSchedule | null; onClose: () => void; onSaved: () => void }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16) : `${todayKey()}T09:00`)
  const [f, setF] = useState({
    title: schedule?.title ?? '',
    instruction: schedule?.instruction ?? '',
    repeat: (schedule?.repeat ?? '평일') as ScheduleRepeat,
    at: toLocal(schedule?.run_at ?? null),
    time: schedule?.time_of_day?.slice(0, 5) ?? '09:00',
    weekdays: schedule?.weekdays ?? [1],
    month_day: schedule?.month_day ?? 1,
  })
  const draft = useMemo(
    () => ({
      repeat: f.repeat,
      run_at: f.repeat === '한 번' ? new Date(`${f.at}:00+09:00`).toISOString() : null,
      time_of_day: f.repeat === '한 번' ? null : `${f.time}:00`,
      weekdays: f.repeat === '매주' ? f.weekdays : [],
      month_day: f.repeat === '매월' ? f.month_day : null,
    }),
    [f],
  )
  const next = nextRun(draft)
  const save = async () => {
    if (await run(() => api.saveAgentSchedule({ ...(schedule ? { id: schedule.id } : {}), agent_id: agentId, title: f.title.trim(), instruction: f.instruction.trim(), enabled: true, ...draft }), '예약했습니다.')) onSaved()
  }
  return (
    <Modal
      title={schedule ? '예약 고치기' : '예약 만들기'}
      onClose={onClose}
      actions={
        <>
          <span className="t-cap grow">{next ? `다음 실행 ${dateTimeLabel(next.toISOString())}` : '실행할 때가 없습니다'}</span>
          <Button kind="ghost" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => void save()} disabled={busy || !f.title.trim() || !f.instruction.trim() || !next || (f.repeat === '매주' && !f.weekdays.length)}>
            저장
          </Button>
        </>
      }
    >
      <Field label="이름">
        <input className="input" value={f.title} maxLength={100} onChange={e => setF({ ...f, title: e.target.value })} placeholder="예: 아침 할 일 정리" />
      </Field>
      <Field label="그때 할 일">
        <textarea className="textarea" style={{ minHeight: 100 }} value={f.instruction} maxLength={2000} onChange={e => setF({ ...f, instruction: e.target.value })} placeholder="예: 오늘 마감인 할 일과 늦은 할 일을 담당자별로 정리해서 박기호님에게 알림" />
      </Field>
      <Field label="언제">
        <div className="chips">
          {SCHEDULE_REPEATS.map(r => (
            <button key={r} type="button" className={`chip ${f.repeat === r ? 'active' : ''}`} onClick={() => setF({ ...f, repeat: r })}>
              {r}
            </button>
          ))}
        </div>
      </Field>
      {f.repeat === '한 번' ? (
        <Field label="날짜 · 시각">
          <input className="input" type="datetime-local" value={f.at} onChange={e => setF({ ...f, at: e.target.value })} />
        </Field>
      ) : (
        <div className="row wrap gap-6">
          {f.repeat === '매주' && (
            <div className="chips">
              {WEEKDAY_LABELS.map((w, i) => (
                <button key={w} type="button" className={`chip ${f.weekdays.includes(i) ? 'active' : ''}`} onClick={() => setF({ ...f, weekdays: f.weekdays.includes(i) ? f.weekdays.filter(x => x !== i) : [...f.weekdays, i] })}>
                  {w}
                </button>
              ))}
            </div>
          )}
          {f.repeat === '매월' && (
            <label className="row gap-6 t-small">
              매월
              <input className="input" type="number" min={1} max={31} style={{ width: 70 }} value={f.month_day} onChange={e => setF({ ...f, month_day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />일
            </label>
          )}
          <input className="input" type="time" style={{ width: 120 }} value={f.time} onChange={e => setF({ ...f, time: e.target.value })} aria-label="시각" />
        </div>
      )}
    </Modal>
  )
}
