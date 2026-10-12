import { useState, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { todayKey } from '../lib/date'
import { openGmail } from '../lib/links'
import { LOG_KINDS, type Client, type LogKind, type Project } from '../lib/types'
import { Button, Chip, Field } from './ui'

export interface LogDraft {
  kind: LogKind
  content: string
  counterpart: string
  subject: string
  clientId: string
  projectId: string
  minutes: string
}

const empty = (kind: LogKind = '업무', clientId = '', projectId = ''): LogDraft => ({ kind, content: '', counterpart: '', subject: '', clientId, projectId, minutes: '' })

export const isMail = (k: LogKind) => k === '메일 발신' || k === '메일 수신'

function useLookups() {
  const { api, version } = useApp()
  return useAsync<{ clients: Client[]; projects: Project[] }>(
    async () => {
      const [clients, projects] = await Promise.all([api.listClients(), api.listProjects()])
      return { clients, projects: projects.filter(p => p.status !== '완료') }
    },
    [version],
    { clients: [], projects: [] },
  ).data
}

/** 기록 저장 + (선택) Gmail 작성창 / 메일 발송 승인 요청 */
function useSubmit(date: string | undefined, onDone: () => void) {
  const { api, bump, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const submit = async (d: LogDraft, mode: 'log' | 'gmail' | 'approval') => {
    const content = d.content.trim() || d.subject.trim()
    if (!content) {
      toast('무엇을 했는지 적어 주세요.')
      return
    }
    // 팝업 차단을 피하려면 클릭 직후 바로 열어야 함
    if (mode === 'gmail') openGmail({ to: d.counterpart, subject: d.subject, body: d.content })
    setBusy(true)
    try {
      if (mode === 'approval') {
        await api.createApproval({
          kind: '메일 발송',
          title: d.subject.trim() || content.slice(0, 40),
          content: null,
          target_id: d.clientId || null,
          payload: { to: d.counterpart.trim(), subject: d.subject.trim(), body: d.content.trim() },
        })
        toast('메일 발송 승인을 요청했습니다.')
      } else {
        await api.saveWorkLog({
          log_date: date ?? todayKey(),
          kind: d.kind,
          content,
          email_counterpart: isMail(d.kind) ? d.counterpart.trim() || null : null,
          email_subject: isMail(d.kind) ? d.subject.trim() || null : null,
          client_id: d.clientId || null,
          project_id: d.projectId || null,
          minutes: d.minutes ? Math.max(0, parseInt(d.minutes, 10) || 0) : null,
        })
        toast('기록했습니다.')
      }
      bump()
      onDone()
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, submit }
}

function Selects({ d, set, clients, projects }: { d: LogDraft; set: (p: Partial<LogDraft>) => void; clients: Client[]; projects: Project[] }) {
  return (
    <>
      <select className="select" value={d.clientId} onChange={e => set({ clientId: e.target.value })} aria-label="거래처">
        <option value="">거래처 ▾</option>
        {clients.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="select" value={d.projectId} onChange={e => set({ projectId: e.target.value })} aria-label="프로젝트">
        <option value="">프로젝트 ▾</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </>
  )
}

/** 업무 일지 화면 하단: 채팅처럼 쓰는 입력줄 */
export function LogComposer({ date, initialClientId = '' }: { date: string; initialClientId?: string }) {
  const { clients, projects } = useLookups()
  const [d, setD] = useState<LogDraft>(() => empty('업무', initialClientId))
  const set = (p: Partial<LogDraft>) => setD(prev => ({ ...prev, ...p }))
  const { busy, submit } = useSubmit(date, () => setD(prev => empty(prev.kind, prev.clientId, prev.projectId)))
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit(d, 'log')
    }
  }
  return (
    <div className="col gap-6" style={{ borderTop: '1px solid var(--line)', padding: '10px 12px', background: 'var(--white)' }}>
      <div className="chips" role="group" aria-label="기록 종류">
        {LOG_KINDS.map(k => (
          <Chip key={k} active={d.kind === k} onClick={() => set({ kind: k })}>
            {k}
          </Chip>
        ))}
      </div>
      {isMail(d.kind) && (
        <div className="row">
          <input className="input" placeholder={d.kind === '메일 발신' ? '받는 사람 이메일' : '보낸 사람 이메일'} value={d.counterpart} onChange={e => set({ counterpart: e.target.value })} />
          <input className="input" placeholder="메일 제목" value={d.subject} onChange={e => set({ subject: e.target.value })} />
        </div>
      )}
      <div className="row composer-row">
        <textarea
          className="textarea grow"
          style={{ minHeight: 36, height: 36 }}
          placeholder="무엇을 했나요? (Enter 기록, Shift+Enter 줄바꿈)"
          value={d.content}
          onChange={e => set({ content: e.target.value })}
          onKeyDown={onKey}
          aria-label="기록 내용"
        />
        <div className="row composer-meta">
          <Selects d={d} set={set} clients={clients} projects={projects} />
          <input className="input" style={{ width: 64, flexShrink: 0 }} inputMode="numeric" placeholder="분" value={d.minutes} onChange={e => set({ minutes: e.target.value.replace(/\D/g, '') })} aria-label="소요 시간(분)" />
        </div>
        {d.kind === '메일 발신' && (
          <Button kind="outline" disabled={busy} onClick={() => submit(d, 'gmail')} title="Gmail 작성창을 열고 기록도 남깁니다">
            Gmail로 작성
          </Button>
        )}
        <Button disabled={busy} onClick={() => submit(d, 'log')}>
          기록
        </Button>
      </div>
    </div>
  )
}

/** 빠른 기록 창(PiP·팝업)용 세로 폼 */
export function QuickLogForm() {
  const { clients, projects } = useLookups()
  const [d, setD] = useState<LogDraft>(() => empty())
  const set = (p: Partial<LogDraft>) => setD(prev => ({ ...prev, ...p }))
  const { busy, submit } = useSubmit(undefined, () => setD(prev => empty(prev.kind, prev.clientId)))
  return (
    <div className="col gap-10">
      <div className="chips" role="group" aria-label="기록 종류">
        {LOG_KINDS.slice(0, 5).map(k => (
          <Chip key={k} active={d.kind === k} onClick={() => set({ kind: k })}>
            {k}
          </Chip>
        ))}
      </div>
      {isMail(d.kind) && (
        <>
          <Field label={d.kind === '메일 발신' ? '받는 사람' : '보낸 사람'}>
            <input className="input" value={d.counterpart} onChange={e => set({ counterpart: e.target.value })} placeholder="name@example.com" />
          </Field>
          <Field label="제목">
            <input className="input" value={d.subject} onChange={e => set({ subject: e.target.value })} />
          </Field>
        </>
      )}
      <Field label={isMail(d.kind) ? '내용 메모' : '무엇을 했나요?'}>
        <textarea
          className="textarea"
          rows={3}
          value={d.content}
          onChange={e => set({ content: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(d, 'log')
          }}
          placeholder="Ctrl+Enter 로 바로 기록"
        />
      </Field>
      <div className="row">
        <Selects d={d} set={set} clients={clients} projects={projects} />
      </div>
      <div className="row">
        <input className="input" style={{ width: 90 }} inputMode="numeric" placeholder="소요(분)" value={d.minutes} onChange={e => set({ minutes: e.target.value.replace(/\D/g, '') })} aria-label="소요 시간(분)" />
        <span className="grow" />
      </div>
      <div className="row">
        {d.kind === '메일 발신' && (
          <>
            <Button kind="outline" className="grow" disabled={busy} onClick={() => submit(d, 'gmail')}>
              Gmail로 작성
            </Button>
            <Button kind="yellow" className="grow" disabled={busy} onClick={() => submit(d, 'approval')}>
              승인 요청
            </Button>
          </>
        )}
        <Button className="grow" disabled={busy} onClick={() => submit(d, 'log')}>
          <Send size={14} /> 기록
        </Button>
      </div>
    </div>
  )
}
