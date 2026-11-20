// 브랜드가 인터뷰지(/i/<토큰>)에서 올린 사진 · 자료 목록 — 서면 인터뷰 화면 · 광고 › 인터뷰 피드 공용 (2026-11-20)
import { useApp, useAsync } from '../lib/app'
import { dateTimeLabel } from '../lib/date'
import type { InterviewFile } from '../lib/interviewForms'
import './SalesInterviews.css'

const kb = (n: number | null) => (n == null ? '' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

/** 브랜드가 인터뷰지에서 올린 사진 · 자료 (2026-11-20): 올라오면 담당자 알림 · 단계 '자료 수령' 은 서버가 바꿈. 여기서는 보고 내려받기만 */
export function InterviewFiles({ interviewId }: { interviewId: string }) {
  const { api, toast } = useApp()
  const state = useAsync(() => api.listInterviewFiles(interviewId), [api, interviewId], [] as InterviewFile[])
  const open = async (f: InterviewFile) => {
    try { window.open(await api.interviewFileUrl(f.path, f.name), '_blank', 'noopener') } catch (e) { toast(e instanceof Error ? e.message : '내려받지 못했습니다.') }
  }
  if (state.loading || !state.data.length) return null
  return (
    <div className="sales-iv-files">
      <b>브랜드가 올린 자료 {state.data.length}개</b>
      <ul>
        {state.data.map(f => (
          <li key={f.id}>
            <button type="button" className="link-btn" onClick={() => void open(f)}>{f.name}</button>
            <span className="t-cap">{kb(f.size)} · {dateTimeLabel(f.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
