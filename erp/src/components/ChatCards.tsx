import { createContext, useContext, type ReactNode } from 'react'
import { CheckSquare, FileText, Stamp } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { addDays, dateLabel, todayKey } from '../lib/date'
import { useRouter } from '../lib/router'
import type { Approval, ChatCard, Task } from '../lib/types'
import { useOpenDoc } from './DriveFiles'

/**
 * 대화 속 카드 (2026-10-23 "손에 붙게"): 할 일 · 결재 · 파일이 대화에 올라오고, 카드 버튼으로 바로 처리
 *  - 지금 상태(완료 · 승인 등)는 방을 열 때 한 번 불러온 목록에서 보여 줌
 */
type CardData = { tasks: Task[]; approvals: Approval[]; reload: () => void }
const Ctx = createContext<CardData | null>(null)

export function CardDataProvider({ children }: { children: ReactNode }) {
  const { api, version } = useApp()
  const { data, reload } = useAsync(
    async () => {
      const [tasks, approvals] = await Promise.all([api.listTasks().catch(() => []), api.listApprovals().catch(() => [])])
      return { tasks, approvals }
    },
    [version],
    { tasks: [] as Task[], approvals: [] as Approval[] },
  )
  return <Ctx.Provider value={{ ...data, reload }}>{children}</Ctx.Provider>
}

export function CardView({ card }: { card: ChatCard }) {
  const data = useContext(Ctx)
  if (card.kind === 'task') return <TaskCard card={card} task={data?.tasks.find(t => t.id === card.id)} reload={data?.reload} />
  if (card.kind === 'approval') return <ApprovalCard card={card} a={data?.approvals.find(x => x.id === card.id)} reload={data?.reload} />
  return <FileCard card={card} />
}

function Shell({ tone, icon, label, title, sub, children }: { tone: string; icon: ReactNode; label: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`chat-card ${tone}`}>
      <div className="chat-card-h">
        <span className="chat-card-kind">
          {icon}
          {label}
        </span>
        <b className="chat-card-title">{title}</b>
      </div>
      {sub && <div className="chat-card-sub">{sub}</div>}
      {children && <div className="chat-card-actions">{children}</div>}
    </div>
  )
}

function TaskCard({ card, task, reload }: { card: ChatCard; task?: Task; reload?: () => void }) {
  const { api, profileName, toast, bump } = useApp()
  const { navigate } = useRouter()
  const save = async (patch: Partial<Task>, msg: string) => {
    if (!task) return
    try {
      await api.saveTask({ id: task.id, ...patch })
      toast(msg)
      reload?.()
      bump()
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  const done = task?.status === '완료'
  const late = !!task?.due_date && !done && task.due_date < todayKey()
  return (
    <Shell
      tone={done ? 'done' : late ? 'late' : 'task'}
      icon={<CheckSquare size={12} />}
      label={done ? '완료' : late ? '지연' : '할 일'}
      title={task?.title ?? card.title}
      sub={task ? [task.assignee_id ? `담당 ${profileName(task.assignee_id)}` : '담당 미정', task.due_date ? `마감 ${dateLabel(task.due_date)}` : null].filter(Boolean).join(' · ') : '지워졌거나 볼 수 없는 할 일'}
    >
      {task && !done && (
        <>
          <button type="button" className="btn btn-yellow btn-sm" onClick={() => void save({ status: '완료' }, '완료했습니다.')}>
            완료
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void save({ due_date: addDays(task.due_date && task.due_date > todayKey() ? task.due_date : todayKey(), 1) }, '마감을 하루 미뤘습니다.')}>
            내일로
          </button>
        </>
      )}
      {task && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(task.project_id ? `/projects?id=${task.project_id}` : '/projects?view=mine')}>
          열기
        </button>
      )}
    </Shell>
  )
}

function ApprovalCard({ card, a, reload }: { card: ChatCard; a?: Approval; reload?: () => void }) {
  const { api, me, profileName, toast, bump } = useApp()
  const { navigate } = useRouter()
  const decide = async (status: '승인' | '반려') => {
    if (!a) return
    try {
      await api.decideApproval(a.id, status)
      toast(status === '승인' ? '승인했습니다.' : '반려했습니다.')
      reload?.()
      bump()
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  const canDecide = !!a && a.status === '대기' && !!a.can_decide && (a.requested_by !== me.id || me.role === 'admin')
  return (
    <Shell
      tone={a?.status === '승인' ? 'done' : a?.status === '반려' ? 'late' : 'approval'}
      icon={<Stamp size={12} />}
      label={a ? `${a.kind} · ${a.status}` : '결재'}
      title={a?.title ?? card.title}
      sub={a ? `올린 사람 ${profileName(a.requested_by)}` : '볼 수 없는 결재'}
    >
      {canDecide && (
        <>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void decide('반려')}>
            반려
          </button>
          <button type="button" className="btn btn-yellow btn-sm" onClick={() => void decide('승인')}>
            승인
          </button>
        </>
      )}
      {a && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/approvals?id=${a.id}`)}>
          의견 · 자세히
        </button>
      )}
    </Shell>
  )
}

function FileCard({ card }: { card: ChatCard }) {
  const openDoc = useOpenDoc()
  return (
    <Shell tone="file" icon={<FileText size={12} />} label="파일" title={card.title}>
      {card.url && (
        <button type="button" className="btn btn-outline btn-sm" onClick={() => openDoc(card.url!)}>
          열기
        </button>
      )}
    </Shell>
  )
}
