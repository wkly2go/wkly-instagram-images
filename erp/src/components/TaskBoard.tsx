import { CalendarClock, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../lib/app'
import { shortDate, timeLabel, toDateKey, todayKey, weekday } from '../lib/date'
import { Link } from '../lib/router'
import type { Project, Task, TaskStatus } from '../lib/types'
import { Board, type BoardCol } from './Board'
import { ProjectOptions } from './ProjectOptions'
import { StatusBadge } from './ui'
import { postponePatch } from '../lib/taskPostpone'

/** 상태를 누를 때마다 다음 단계로 (할 일 → 진행 중 → 완료 → 할 일) */
export const NEXT_TASK_STATUS: Record<TaskStatus, TaskStatus> = { '할 일': '진행 중', '진행 중': '완료', 완료: '할 일' }
export const alarmLabel = (iso: string) => `${shortDate(toDateKey(iso))} ${timeLabel(iso)}`

/** 할 일 게시판: 번호 · 상태 · 할 일 · 프로젝트 · 담당 · 마감 · 알람 · 고치기 */
export function TaskBoard({ list, late, projects, onStatus, onEdit, onDelete }: { list: Task[]; late?: boolean; projects: Project[]; onStatus: (t: Task) => void; onEdit?: (t: Task) => void; onDelete?: (t: Task) => void }) {
  const { me, profileName, profileOf, profiles, api, bump, toast } = useApp()
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
  // 표에서 바로 고치기 (대표 지시 2026-11-18 '할일을 바로 수정할 수 있게') — 바꾸면 곧바로 저장,
  // 상태 · 제목 · 프로젝트 변경은 서버 트리거가 업무 일지에 이어 적고 주간 보고는 그 일지를 모음
  const patch = async (t: Task, p: Partial<Task>) => {
    try {
      await api.saveTask({ id: t.id, ...p })
      bump()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다.')
      return false
    }
  }
  const people = profiles.filter(p => p.active !== false && !p.is_agent)
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
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
            <InlineTitle task={t} onSave={title => void patch(t, { title })} />
            {sub && <span className="cell-sub">{sub}</span>}
          </>
        )
      },
    },
    {
      key: 'project',
      label: '프로젝트',
      width: 170,
      hideNarrow: true,
      cell: t => (
        <span className="task-inline" onClick={stop}>
          <select className="task-inline-sel" value={t.project_id ?? ''} onChange={e => void patch(t, { project_id: e.target.value || null })} aria-label={`${t.title} 프로젝트`} title="프로젝트 바꾸기">
            <option value="">프로젝트 없음</option>
            <ProjectOptions projects={projects} />
          </select>
          {t.project_id && <Link to={`/projects?id=${t.project_id}`} className="task-inline-go" title="프로젝트 열기">›</Link>}
        </span>
      ),
    },
    {
      key: 'assignee',
      label: '담당',
      width: 96,
      cell: t => (
        <select className={`task-inline-sel ${t.assignee_id === me.id ? 't-smallb' : ''}`} value={t.assignee_id ?? ''} onClick={stop} onChange={e => void patch(t, { assignee_id: e.target.value || null })} aria-label={`${t.title} 담당`} title="담당 바꾸기">
          <option value="">담당 없음</option>
          {t.assignee_id && !people.some(p => p.id === t.assignee_id) && <option value={t.assignee_id}>{profileName(t.assignee_id)}</option>}
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ),
    },
    {
      key: 'due',
      label: '마감',
      width: 96,
      cell: t => (
        <label className={`task-inline task-inline-due t-meta ${t.status !== '완료' && t.due_date && t.due_date < today ? 't-red' : ''}`} onClick={stop} title="눌러서 마감 바꾸기">
          {t.due_date ? (t.due_date === today ? '오늘' : `${shortDate(t.due_date)} ${weekday(t.due_date)}`) : '마감 정하기'}
          <input
            type="date"
            className="task-inline-date"
            value={t.due_date ?? ''}
            onClick={e => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.() } catch { /* 눌러 고르기 */ } }}
            onChange={e => void patch(t, { due_date: e.target.value || null })}
            aria-label={`${t.title} 마감`}
          />
        </label>
      ),
    },
    // 완료일 (대표 지시 2026-11-18 '완료일까지 표시해') — 완료로 바꾼 날을 서버가 기록(tasks.completed_at)
    { key: 'doneAt', label: '완료일', width: 90, cell: t => (t.status === '완료' && t.completed_at ? <span className="t-meta t-green" title={`${shortDate(toDateKey(t.completed_at))} ${timeLabel(t.completed_at)} 완료`}>{shortDate(toDateKey(t.completed_at))} {weekday(toDateKey(t.completed_at))}</span> : '-') },
    { key: 'alarm', label: '알람', width: 100, hideNarrow: true, cell: t => (t.remind_at && t.status !== '완료' ? <span className="t-meta">{alarmLabel(t.remind_at)}</span> : '-') },
    {
      key: 'act',
      label: '',
      width: onDelete ? 82 : 60,
      kind: 'center',
      cell: t => (
        <>
          {t.status !== '완료' && (
            <button type="button" className="icon-btn sm" onClick={e => { e.stopPropagation(); const p = postponePatch(t, today); void patch(t, p).then(ok => ok && toast(`${shortDate(p.due_date!)} ${weekday(p.due_date!)}로 미뤘습니다`)) }} aria-label={`${t.title} 다음날로 연기`} title="다음날로 연기 (지났으면 내일로)">
              <CalendarClock size={13} />
            </button>
          )}
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


/** 제목 바로 고치기: 누르면 입력 칸 · Enter 또는 칸 밖을 누르면 저장 · Esc 는 취소 */
function InlineTitle({ task, onSave }: { task: Task; onSave: (title: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(task.title)
  useEffect(() => setV(task.title), [task.title])
  const done = task.status === '완료'
  if (!editing)
    return (
      <button type="button" className="task-inline-title t-smallb" style={done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined} onClick={e => (e.stopPropagation(), setEditing(true))} title="눌러서 제목 고치기">
        {task.title}
      </button>
    )
  const finish = (save: boolean) => {
    setEditing(false)
    const next = v.trim()
    if (save && next && next !== task.title) onSave(next)
    else setV(task.title)
  }
  return (
    <input
      className="input task-inline-input"
      autoFocus
      value={v}
      maxLength={200}
      onClick={e => e.stopPropagation()}
      onChange={e => setV(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(true)
        if (e.key === 'Escape') finish(false)
      }}
      aria-label="할 일 제목"
    />
  )
}
