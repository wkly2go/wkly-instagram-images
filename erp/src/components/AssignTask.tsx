import { useState } from 'react'
import { Send } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { addDays, todayKey } from '../lib/date'
import type { Project, Task } from '../lib/types'
import { TaskAssignModal } from '../pages/Schedule'

/** 업무 지시 창: 프로젝트 · 업무 목록을 열 때 불러옴 (팀원 미리 선택 가능) */
export function AssignTaskModal({ assignee, onClose }: { assignee?: string | null; onClose: () => void }) {
  const { api } = useApp()
  const today = todayKey()
  const { data, loading } = useAsync(
    async () => {
      const [projects, tasks] = await Promise.all([api.listProjects(), api.listTasks({ from: addDays(today, -60), to: addDays(today, 120) })])
      return { projects, tasks }
    },
    [],
    { projects: [] as Project[], tasks: [] as Task[] },
  )
  if (loading && !data.projects.length) return null
  return <TaskAssignModal projects={data.projects} tasks={data.tasks} presetAssignee={assignee} onClose={onClose} />
}

/** 업무 지시 버튼 (아이콘만 또는 글자 포함) */
export function AssignTaskButton({ assignee, label, className = 'icon-btn', title }: { assignee?: string | null; label?: string; className?: string; title?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title={title ?? '업무 지시'} aria-label={title ?? '업무 지시'}>
        <Send size={13} />
        {label && <span>{label}</span>}
      </button>
      {open && <AssignTaskModal assignee={assignee} onClose={() => setOpen(false)} />}
    </>
  )
}
