import { useApp, useAction } from '../lib/app'
import { addDays, todayKey } from '../lib/date'
import type { Task } from '../lib/types'
import { ask } from './Ask'

/**
 * 할 일 바로 관리 (대표 지시 2026-11-10 "완료 · 미결 · 연장 등 다양한 옵션으로 일정 관리")
 *  - 상태: 완료 · 진행 중 · 미결(할 일로 되돌리기)
 *  - 연장: 마감 +1일 · +3일 · +1주 · 날짜 고르기 (시작일이 새 마감보다 늦으면 같이 당김)
 *  - 담당 바꾸기 · 개인 일정으로(내 일) · 삭제 · 자세히 수정
 */
export function TaskActions({ t, onEdit }: { t: Task; onEdit?: () => void }) {
  const { api, me, profiles } = useApp()
  const { busy, run } = useAction()
  const today = todayKey()
  const due = t.due_date ?? t.start_date ?? today
  const late = t.status !== '완료' && !!t.due_date && t.due_date < today
  const setStatus = (status: Task['status'], msg: string) => run(() => api.saveTask({ id: t.id, status }), msg)
  const extend = (to: string) => {
    if (!to) return
    const patch: Partial<Task> = { id: t.id, due_date: to }
    if (t.start_date && t.start_date > to) patch.start_date = to
    // 지난 마감을 미루면 다시 할 일로 (완료였던 것도)
    if (t.status === '완료') patch.status = '할 일'
    return run(() => api.saveTask(patch as Task), `마감을 ${to.slice(5).replace('-', '.')}(으)로 바꿨습니다.`)
  }
  // 지난 일정은 오늘 기준으로, 아니면 원래 마감 기준으로 미룸
  const base = late ? today : due
  const toPersonal = async () => {
    if (!(await ask(`'${t.title}'을(를) 개인 일정(나만 보임)으로 바꿀까요?\n팀 업무 목록 · 달력에서는 빠집니다.`))) return
    const s0 = t.start_date ?? t.due_date ?? today
    const e0 = t.due_date ?? s0
    await run(async () => {
      await api.savePersonalEvent({ title: t.title, start_date: s0, end_date: e0 < s0 ? s0 : e0, start_time: null, memo: t.memo ?? null })
      await api.deleteTask(t.id)
    }, '개인 일정으로 바꿨습니다.')
  }
  const remove = async () => {
    if (await ask(`'${t.title}' 할 일을 삭제할까요?`)) await run(() => api.deleteTask(t.id), '삭제했습니다.')
  }
  return (
    <div className="task-act">
      <div className="task-act-row">
        <span className="task-act-l">상태</span>
        <button type="button" className={`ta-btn ta-done${t.status === '완료' ? ' on' : ''}`} disabled={busy || t.status === '완료'} onClick={() => setStatus('완료', '완료했습니다.')}>
          ✓ 완료
        </button>
        <button type="button" className={`ta-btn${t.status === '진행 중' ? ' on' : ''}`} disabled={busy || t.status === '진행 중'} onClick={() => setStatus('진행 중', '진행 중으로 바꿨습니다.')}>
          진행 중
        </button>
        <button type="button" className={`ta-btn ta-open${t.status === '할 일' ? ' on' : ''}`} disabled={busy || t.status === '할 일'} onClick={() => setStatus('할 일', '미결(할 일)로 되돌렸습니다.')} title="아직 끝나지 않음 · 할 일로 되돌리기">
          미결
        </button>
        {late && <span className="ta-late">마감 지남</span>}
      </div>
      <div className="task-act-row">
        <span className="task-act-l">연장</span>
        <button type="button" className="ta-btn" disabled={busy} onClick={() => extend(addDays(base, 1))}>
          +1일
        </button>
        <button type="button" className="ta-btn" disabled={busy} onClick={() => extend(addDays(base, 3))}>
          +3일
        </button>
        <button type="button" className="ta-btn" disabled={busy} onClick={() => extend(addDays(base, 7))}>
          +1주
        </button>
        <input className="input ta-date" type="date" value={t.due_date ?? ''} disabled={busy} onChange={e => extend(e.target.value)} aria-label="마감일" title="마감일 고르기" />
      </div>
      <div className="task-act-row">
        <span className="task-act-l">담당</span>
        <select className="select ta-who" value={t.assignee_id ?? ''} disabled={busy} onChange={e => run(() => api.saveTask({ id: t.id, assignee_id: e.target.value || null }), '담당을 바꿨습니다.')} aria-label="담당">
          <option value="">담당 미정</option>
          {profiles
            .filter(p => p.active && !p.is_agent)
            .map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <span className="grow" />
        {t.assignee_id === me.id && (
          <button type="button" className="ta-btn ta-personal" disabled={busy} onClick={toPersonal} title="나만 보는 개인 일정으로">
            🔒 개인으로
          </button>
        )}
        <button type="button" className="ta-btn ta-del" disabled={busy} onClick={remove}>
          삭제
        </button>
        {onEdit && (
          <button type="button" className="ta-btn" onClick={onEdit}>
            ✎ 수정
          </button>
        )}
      </div>
    </div>
  )
}
