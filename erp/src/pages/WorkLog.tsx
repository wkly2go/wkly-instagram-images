import { useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { addDays, dateLabel, minutesLabel, timeLabel, todayKey } from '../lib/date'
import { Link, useRouter, withQuery } from '../lib/router'
import { presenceOf, useAttendance } from '../lib/attendance'
import type { Client, Project, WorkLog as Log } from '../lib/types'
import { Shell } from '../components/Shell'
import { LogComposer, isMail } from '../components/LogForm'
import { Avatar, Button, Chip, Empty, KindBadge, TodayBadge } from '../components/ui'
import { NewApproval } from './Approvals'

export default function WorkLog() {
  const { api, me, version, profileOf, profileName } = useApp()
  const { query, path, navigate } = useRouter()
  const today = todayKey()
  const date = query.get('date') || today
  const userParam = query.get('user')
  const team = query.get('team') === '1' && !userParam
  const viewUser = userParam ?? (team ? undefined : me.id)
  const other = userParam && userParam !== me.id ? profileOf(userParam) : undefined
  const attendance = useAttendance()
  const [reporting, setReporting] = useState(false)
  const { run } = useAction()

  const { data } = useAsync(
    async () => {
      const [logs, clients, projects] = await Promise.all([api.listWorkLogs({ date, userId: viewUser }), api.listClients(), api.listProjects()])
      return { logs, clients, projects }
    },
    [version, date, viewUser],
    { logs: [] as Log[], clients: [] as Client[], projects: [] as Project[] },
  )
  const clientName = (id: string | null) => data.clients.find(c => c.id === id)?.name
  const projectName = (id: string | null) => data.projects.find(p => p.id === id)?.name
  const total = data.logs.reduce((s, l) => s + (l.minutes ?? 0), 0)
  const go = (patch: Record<string, string | null>) => navigate(withQuery(path, query, patch), { replace: true })

  return (
    <Shell active="work" flush>
      <div className="row wrap" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
        <button type="button" className="icon-btn" onClick={() => go({ date: addDays(date, -1) })} aria-label="이전 날">
          <ChevronLeft size={18} />
        </button>
        <button type="button" className="t-bodyb" style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }} onClick={() => go({ date: null })} title="오늘로">
          {dateLabel(date)}
        </button>
        <button type="button" className="icon-btn" onClick={() => go({ date: addDays(date, 1) })} aria-label="다음 날" disabled={date >= today}>
          <ChevronRight size={18} />
        </button>
        {other ? (
          <>
            <Avatar name={other.name} size="xs" />
            <span className="t-smallb">{other.name}님의 업무 기록</span>
            <TodayBadge status={presenceOf(other, attendance.get(other.id))} />
            <Chip onClick={() => go({ user: null })}>내 기록으로</Chip>
          </>
        ) : (
          <div className="chips">
            <Chip active={!team} onClick={() => go({ team: null })}>
              내 기록
            </Chip>
            <Chip active={team} onClick={() => go({ team: '1' })}>
              팀 전체
            </Chip>
          </div>
        )}
        <span className="grow" />
        <span className="t-cap">
          {date === today ? '오늘' : ''} {data.logs.length}건 · {minutesLabel(total)}
        </span>
        {!other && !team && (
          <Button kind="yellow" size="sm" onClick={() => setReporting(true)} disabled={data.logs.length === 0}>
            업무 보고 제출
          </Button>
        )}
      </div>
      {other?.status_message && <div className="t-small" style={{ padding: '6px 14px', background: 'var(--white)', borderBottom: '1px dashed var(--line)' }}>“{other.status_message}”</div>}
      <div className="chat-body" style={{ gap: 12 }}>
        {data.logs.length === 0 && <Empty>{other ? '이 날의 기록이 없습니다.' : '아래 입력창에 오늘 한 일을 남겨 보세요. 메일·미팅·전화도 모두 기록할 수 있어요.'}</Empty>}
        {data.logs.map(l => {
          const mine = l.user_id === me.id
          return (
            <div key={l.id} className={`log ${mine ? '' : 'other'}`}>
              <div className="who">
                {!mine && (
                  <>
                    <Avatar name={profileName(l.user_id)} size="xs" />
                    <span className="t-cap">{profileName(l.user_id)}</span>
                  </>
                )}
                <KindBadge kind={l.kind} />
                <span className="t-meta">
                  {timeLabel(l.created_at)}
                  {l.minutes ? ` · ${l.minutes}분` : ''}
                </span>
                {(mine || me.role === 'admin') && (
                  <button
                    type="button"
                    className="icon-btn sm del"
                    aria-label="기록 삭제"
                    title="삭제"
                    onClick={() => window.confirm('이 기록을 삭제할까요?') && run(() => api.deleteWorkLog(l.id), '삭제했습니다.')}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className={`bubble ${mine ? 'mine' : 'other'}`}>{l.content}</div>
              {isMail(l.kind) && (l.email_counterpart || l.email_subject) && (
                <div className="extra">
                  {l.kind === '메일 발신' ? '받는 사람' : '보낸 사람'} {l.email_counterpart || '-'}
                  {l.email_subject ? ` · ${l.email_subject}` : ''}
                </div>
              )}
              {(l.client_id || l.project_id) && (
                <div className="links">
                  {l.client_id && <Link to={`/clients?id=${l.client_id}`}>🏢 {clientName(l.client_id) ?? '거래처'}</Link>}
                  {l.project_id && <Link to={`/projects?id=${l.project_id}`}>📁 {projectName(l.project_id) ?? '프로젝트'}</Link>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!other && <LogComposer key={date} date={date} initialClientId={query.get('client') ?? ''} />}
      {reporting && <NewApproval preset={{ kind: '업무 보고', payload: { date } }} onClose={() => setReporting(false)} onCreated={id => navigate(`/approvals?view=mine&id=${id}`)} />}
    </Shell>
  )
}
