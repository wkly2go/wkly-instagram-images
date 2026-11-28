import { useState, type ReactNode } from 'react'
import { CalendarDays, ChevronDown, ChevronUp, ListTodo } from 'lucide-react'
import { useAction, useApp, useAsync } from '../lib/app'
import { todayKey } from '../lib/date'
import { Link } from '../lib/router'
import type { ApprovalSummary, Task } from '../lib/types'
import { AttendanceTodo, useAttendanceTodo } from './AttendanceTodo'
import { todayTasks } from './TodayWork'

const KEY = 'wkly-dock-todo'
/** 위쪽 칸에 무엇을 둘지: 할 일 · 결재 / 달력 (대표 지시 2026-11-18 '이곳을 할 일 또는 캘린더로 선택할 수 있게') */
const MODE_KEY = 'wkly-dock-mode'

/**
 * 채팅 칸 위쪽 '오늘 할 일 · 결재 대기' (대표 지시 2026-11-13 "채팅창이 너무 길어 위쪽에 다른 아이템")
 *  - 내 오늘 업무(지연 포함) · 대기 결재 건수 · 관리자는 근태 결재(휴가 · 외근 · 휴대폰 출근)를 그 자리에서 승인 · 반려
 *  - 머리글을 누르면 접힘 (기억함) · 길어지면 이 칸 안에서만 스크롤
 */
export function DockTodo({ calendar }: { calendar?: ReactNode }) {
  const { api, me, version } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const [mode, setModeState] = useState<'todo' | 'calendar'>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'calendar' ? 'calendar' : 'todo'
    } catch {
      return 'todo'
    }
  })
  const setMode = (m: 'todo' | 'calendar') => {
    setModeState(m)
    if (!open) setOpen(true)
    try {
      localStorage.setItem(MODE_KEY, m)
      localStorage.setItem(KEY, 'open')
    } catch {
      /* 저장 못 해도 화면은 그대로 */
    }
  }
  const { data } = useAsync(
    async () => {
      const [tasks, approvals] = await Promise.all([api.listTasks(), api.listApprovals().catch(() => [] as ApprovalSummary[])])
      return { tasks, approvals }
    },
    [version, today],
    { tasks: [] as Task[], approvals: [] as ApprovalSummary[] },
  )
  const att = useAttendanceTodo()
  const mine = todayTasks(data.tasks, today).filter(t => t.assignee_id === me.id)
  const waiting = data.approvals.filter(a => a.status === '대기').length
  const count = mine.length + waiting + (att.admin ? att.count : 0)
  const toggle = () => {
    setOpen(o => {
      try {
        localStorage.setItem(KEY, o ? 'closed' : 'open')
      } catch {
        /* 저장 못 해도 화면은 그대로 */
      }
      return !o
    })
  }
  return (
    <section className={`dock-todo${open ? '' : ' closed'}`} aria-label="오늘 할 일 · 결재 대기">
      <div className="dock-todo-h">
        <div className="dock-mode" role="tablist" aria-label="위쪽 칸 보기">
          <button type="button" role="tab" aria-selected={mode === 'todo'} className={mode === 'todo' ? 'on' : ''} onClick={() => setMode('todo')}>
            <ListTodo size={14} aria-hidden="true" /> 할 일 · 결재
            {count > 0 && <span className="side-n">{count > 99 ? '99+' : count}</span>}
          </button>
          {calendar && (
            <button type="button" role="tab" aria-selected={mode === 'calendar'} className={mode === 'calendar' ? 'on' : ''} onClick={() => setMode('calendar')}>
              <CalendarDays size={14} aria-hidden="true" /> 캘린더
            </button>
          )}
        </div>
        <span className="grow" />
        <button type="button" className="icon-btn sm" onClick={toggle} aria-expanded={open} title={open ? '접기' : '펼치기'} aria-label={open ? '접기' : '펼치기'}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {open && mode === 'calendar' && calendar && <div className="dock-todo-body dock-cal">{calendar}</div>}
      {open && mode === 'todo' && (
        <div className="dock-todo-body">
          {att.admin && <AttendanceTodo todo={att} />}
          <Link to="/approvals" className="today-row dock-todo-link">
            <span className="today-title">결재 대기</span>
            <span className={`t-cap nowrap${waiting ? ' t-red' : ''}`}>{waiting ? `${waiting}건 ›` : '없음 ›'}</span>
          </Link>
          {mine.length === 0 && <div className="dock-todo-empty">오늘 할 업무가 없습니다.</div>}
          {mine.slice(0, 8).map(t => {
            const late = !!t.due_date && t.due_date < today
            return (
              <div key={t.id} className={`today-row${late ? ' late' : ''}`}>
                <input type="checkbox" checked={false} disabled={busy} onChange={() => run(() => api.saveTask({ id: t.id, status: '완료' }), '완료했습니다.')} aria-label={`${t.title} 완료`} />
                <Link to={`/projects?view=mine&task=${t.id}`} className="today-title task-detail-link" title={`${t.title} 상세 보기`}>{t.title}</Link>
                <span className={`t-cap nowrap${late ? ' t-red' : ''}`}>{late ? `지연 · ${t.due_date!.slice(5)}` : t.due_date === today ? '오늘' : `~${t.due_date?.slice(5) ?? ''}`}</span>
              </div>
            )
          })}
          {mine.length > 8 && (
            <Link to="/my" className="today-row dock-todo-link">
              <span className="today-title">외 {mine.length - 8}건</span>
              <span className="t-cap nowrap">개인 업무에서 보기 ›</span>
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
