import { Pencil, Trash2 } from 'lucide-react'
import { useApp } from '../lib/app'
import { shortDate, timeLabel, toDateKey, todayKey, weekday } from '../lib/date'
import { Link } from '../lib/router'
import type { Project, Task, TaskStatus } from '../lib/types'
import { Board, type BoardCol } from './Board'
import { StatusBadge } from './ui'

/** 상태를 누를 때마다 다음 단계로 (할 일 → 진행 중 → 완료 → 할 일) */
export const NEXT_TASK_STATUS: Record<TaskStatus, TaskStatus> = { '할 일': '진행 중', '진행 중': '완료', 완료: '할 일' }
export const alarmLabel = (iso: string) => `${shortDate(toDateKey(iso))} ${timeLabel(iso)}`

/** 할 일 게시판: 번호 · 상태 · 할 일 · 프로젝트 · 담당 · 마감 · 알람 · 고치기 */
export function TaskBoard({ list, late, projects, onStatus, onEdit, onDelete }: { list: Task[]; late?: boolean; projects: Project[]; onStatus: (t: Task) => void; onEdit?: (t: Task) => void; onDelete?: (t: Task) => void }) {
  const { me, profileName, profileOf, api, bump, toast } = useApp()
  const today = todayKey()
  // 체크박스로 바로 완료 · 다시 열기 (대표 지시 2026-11-02 "할 일 목록에 체크박스")
  const toggle = async (t: Task) => {
    try {
      await api.saveTask({ id: t.id, status: t.status === '완료' ? '할 일' : '완료' })
      bump()
    } catch (e) {
      toast(e instanceof Error ? e.message : '바꾸지 못했습니다.')
    }
  }
  const cols: BoardCol<Task>[] = [
    {
      key: 'check',
      label: '',
      width: 34,
      kind: 'center',
      cell: t => (
        <input
          type="checkbox"
          className="task-check"
          checked={t.status === '완료'}
          onClick={e => e.stopPropagation()}
          onChange={() => void toggle(t)}
          aria-label={t.status === '완료' ? `${t.title} 다시 열기` : `${t.title} 완료`}
          title={t.status === '완료' ? '체크 해제 → 다시 할 일' : '체크 → 완료'}
        />
      ),
    },
    {
      key: 'status',
      label: '상태',
      width: 72,
      cell: t => (
        <button type="button" className="link-btn" onClick={e => (e.stopPropagation(), onStatus(t))} title="눌러서 상태 변경 (할 일 → 진행 중 → 완료)">
          <StatusBadge status={late || (t.status !== '완료' && !!t.due_date && t.due_date < today) ? '지연' : t.status} />
        </button>
      ),
    },
    {
      key: 'title',
      label: '할 일',
      kind: 'title',
      cell: t => {
        const creator = profileOf(t.created_by)
        const sub = [t.phase, creator?.is_agent ? `${creator.name} 배정` : creator && creator.id !== t.assignee_id ? `${creator.name} 지시` : null, t.start_date && t.due_date && t.start_date !== t.due_date ? `${shortDate(t.start_date)}~${shortDate(t.due_date)}` : null].filter(Boolean).join(' · ')
        return (
          <>
            <span className="t-smallb" style={t.status === '완료' ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
              {t.title}
            </span>
            {sub && <span className="cell-sub">{sub}</span>}
          </>
        )
      },
    },
    { key: 'project', label: '프로젝트', width: 170, hideNarrow: true, cell: t => (t.project_id ? <span onClick={e => e.stopPropagation()}><Link to={`/projects?id=${t.project_id}`}>{projects.find(p => p.id === t.project_id)?.name ?? ''}</Link></span> : '-') },
    { key: 'assignee', label: '담당', width: 80, cell: t => (t.assignee_id ? <span className={t.assignee_id === me.id ? 't-smallb' : ''}>{profileName(t.assignee_id)}</span> : '-') },
    { key: 'due', label: '마감', width: 96, cell: t => (t.due_date ? <span className={`t-meta ${t.status !== '완료' && t.due_date < today ? 't-red' : ''}`}>{t.due_date === today ? '오늘' : `${shortDate(t.due_date)} ${weekday(t.due_date)}`}</span> : '-') },
    { key: 'alarm', label: '알람', width: 100, hideNarrow: true, cell: t => (t.remind_at && t.status !== '완료' ? <span className="t-meta">{alarmLabel(t.remind_at)}</span> : '-') },
    {
      key: 'act',
      label: '',
      width: onDelete ? 56 : 34,
      kind: 'center',
      cell: t => (
        <>
          {onEdit && (
            <button type="button" className="icon-btn sm" onClick={e => (e.stopPropagation(), onEdit(t))} aria-label={`${t.title} 고치기`} title="고치기 (제목 · 담당 · 날짜 · 메모)">
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button type="button" className="icon-btn sm" onClick={e => (e.stopPropagation(), onDelete(t))} aria-label="할 일 삭제" title="삭제">
              <Trash2 size={13} />
            </button>
          )}
        </>
      ),
    },
  ]
  return <Board rows={list} cols={cols} rowKey={t => t.id} onRow={onEdit} rowClass={t => (t.status === '완료' ? 'done' : undefined)} compact empty="할 일이 없습니다." />
}
