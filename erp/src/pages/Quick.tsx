import { X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { timeLabel, todayKey } from '../lib/date'
import type { WorkLog } from '../lib/types'
import { QuickLogForm } from '../components/LogForm'
import { KindBadge } from '../components/ui'

/** 빠른 기록 창: PiP 창이나 /quick 팝업에서 렌더링 */
export default function Quick({ onClose }: { onClose?: () => void }) {
  const { api, me, version } = useApp()
  const today = todayKey()
  const { data } = useAsync(() => api.listWorkLogs({ date: today, userId: me.id }), [version, today, me.id], [] as WorkLog[])
  const recent = [...data].reverse().slice(0, 4)
  return (
    <div className="quick">
      <div className="card">
        <div className="inner" style={{ gap: 10 }}>
          <div className="row">
            <span className="t-bodyb">빠른 기록</span>
            <span className="t-meta">{me.name}</span>
            <span className="grow" />
            {onClose && (
              <button type="button" className="icon-btn sm" onClick={onClose} aria-label="닫기">
                <X size={16} />
              </button>
            )}
          </div>
          <QuickLogForm />
          <div className="dashed" />
          <span className="t-cap">오늘 내 기록 {data.length}건</span>
          {recent.map(l => (
            <div key={l.id} className="row t-cap">
              <span className="t-meta">{timeLabel(l.created_at)}</span>
              <KindBadge kind={l.kind} />
              <span className="truncate t-blue">{l.content}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
