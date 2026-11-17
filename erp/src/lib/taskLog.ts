/**
 * 할 일 → 업무 일지 연동 (2026-11-17 대표 지시 '내할일을 수정하면 업무일지 까지 연동되게 만들어')
 * 할 일을 '진행 중' · '완료'로 바꾸면 서버(트리거 tasks_work_log · private.task_to_work_log)가 그날 업무 일지에 한 줄을 적는다.
 * 여기 글 모양은 SQL private.task_log_text 와 같아야 한다 — 한쪽을 바꾸면 다른 쪽도 함께 바꿀 것.
 */
export const TASK_LOG_DONE = ' — 완료'
export const TASK_LOG_DOING = ' — 진행 중'

/** 일지에 자동으로 적히는 글: '제목 — 완료' / '제목 — 진행 중' */
export const taskLogText = (title: string, status: string): string => `${(title ?? '').trim().slice(0, 300)}${status === '완료' ? TASK_LOG_DONE : TASK_LOG_DOING}`

/** 사람이 고치지 않은 자동 기록인지 (고친 기록은 서버가 덮어쓰거나 지우지 않는다) */
export const isTaskLogText = (content: string, title: string): boolean => content === taskLogText(title, '완료') || content === taskLogText(title, '진행 중')
