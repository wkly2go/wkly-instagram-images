// 결재 부품 — 홈과 결재 화면이 함께 쓰는 것만 (2026-11-19 성능)
// 홈이 결재 화면 파일(pages/Approvals.tsx)을 통째로 끌고 오지 않게 승인 · 반려 단추와 일일 보고 표시를 여기로 옮겼다.
// 결재 화면 · 새 결재 · 회의 녹음 · 보고 대시보드는 결재 메뉴를 열 때만 불러온다.
import { useState } from 'react'
import { useAction, useApp } from '../lib/app'
import type { Approval, ApprovalSummary } from '../lib/types'
import { Meter } from './charts'
import { Button, Linkify, Modal } from './ui'

/** 승인/반려 버튼 (홈·상세 공용) */
export function DecideButtons({ approval, compact }: { approval: ApprovalSummary; compact?: boolean }) {
  const { api } = useApp()
  const { busy, run } = useAction()
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState('')
  const [commenting, setCommenting] = useState(false)
  if (!approval.can_decide) return null
  // 승인된 보고서도 나중에 반려 (대표 지시 2026-10-18). 지출은 결제 대장에 등록돼 있어 제외
  if (approval.status === '승인') {
    if (approval.kind === '지출') return null
    return (
      <>
        <Button kind="outline" size={compact ? 'sm' : undefined} disabled={busy} onClick={() => setRejecting(true)} title="승인한 보고서를 반려로 바꿈 (요청자에게 알림)">
          반려
        </Button>
        {rejecting && (
          <Modal
            title="승인한 보고서 반려"
            onClose={() => setRejecting(false)}
            actions={
              <>
                <Button kind="ghost" onClick={() => setRejecting(false)}>
                  취소
                </Button>
                <Button
                  disabled={busy || !comment.trim()}
                  onClick={async () => {
                    if (await run(() => api.decideApproval(approval.id, '반려', comment.trim()), '반려로 바꿨습니다.')) setRejecting(false)
                  }}
                >
                  반려하기
                </Button>
              </>
            }
          >
            <p className="t-small" style={{ margin: 0 }}>
              <b className="t-blue">{approval.title}</b> — 이미 {approval.kind === '일일 보고' ? '확인' : '승인'}한 보고서입니다. 반려하면 요청자에게 알림이 가고, 업무 보고는 다시 미승인으로 할 일에 남습니다.
            </p>
            <textarea className="textarea" autoFocus rows={3} placeholder="반려 사유 (필수)" value={comment} onChange={e => setComment(e.target.value)} />
          </Modal>
        )}
      </>
    )
  }
  if (approval.status !== '대기') return null
  if (approval.kind === '일일 보고') {
    return (
      <>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          <Button kind="outline" size={compact ? 'sm' : undefined} disabled={busy} onClick={() => setCommenting(true)}>
            의견 남기기
          </Button>
          <Button kind="yellow" size={compact ? 'sm' : undefined} disabled={busy} onClick={() => run(() => api.decideApproval(approval.id, '승인'), '확인했습니다.')}>
            확인
          </Button>
        </div>
        {commenting && (
          <Modal
            title="일일 보고에 의견 남기기"
            onClose={() => setCommenting(false)}
            actions={
              <>
                <Button kind="ghost" onClick={() => setCommenting(false)}>
                  취소
                </Button>
                <Button disabled={busy || !comment.trim()} onClick={async () => (await run(() => api.decideApproval(approval.id, '승인', comment.trim()), '의견을 남기고 확인했습니다.')) && setCommenting(false)}>
                  남기고 확인
                </Button>
              </>
            }
          >
            <textarea className="textarea" autoFocus rows={4} placeholder="예) 루프앤코 중도금은 제가 오늘 통화할게요. 내일 보고에 결과 반영해 주세요." value={comment} onChange={e => setComment(e.target.value)} />
          </Modal>
        )}
      </>
    )
  }
  return (
    <>
      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
        <Button kind="outline" size={compact ? 'sm' : undefined} disabled={busy} onClick={() => setRejecting(true)}>
          반려
        </Button>
        <Button kind="yellow" size={compact ? 'sm' : undefined} disabled={busy} onClick={() => run(() => api.decideApproval(approval.id, '승인', comment), '승인했습니다.')}>
          승인
        </Button>
      </div>
      {rejecting && (
        <Modal
          title="반려 사유"
          onClose={() => setRejecting(false)}
          actions={
            <>
              <Button kind="ghost" onClick={() => setRejecting(false)}>
                취소
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (await run(() => api.decideApproval(approval.id, '반려', comment), "반려했습니다. '반려' 탭으로 옮겼습니다.")) setRejecting(false)
                }}
              >
                반려하기
              </Button>
            </>
          }
        >
          <p className="t-small" style={{ margin: 0 }}>
            <b className="t-blue">{approval.title}</b>
          </p>
          <textarea className="textarea" autoFocus rows={3} placeholder="요청자에게 전달할 사유 (선택)" value={comment} onChange={e => setComment(e.target.value)} />
        </Modal>
      )}
    </>
  )
}

/** 일일 보고: '■ 제목' 줄은 소제목, '· 이름 (할 일 x/y) — 메모' 는 진행 막대, 숫자 요약은 칸으로 */
export function reportSections(content: string | null): { title: string; lines: string[] }[] {
  const sections: { title: string; lines: string[] }[] = []
  for (const raw of (content ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^■/.test(line)) sections.push({ title: line.replace(/^■\s*/, ''), lines: [] })
    else {
      if (!sections.length) sections.push({ title: '', lines: [] })
      sections[sections.length - 1].lines.push(line)
    }
  }
  return sections
}

export function DailyReport({ a }: { a: Approval }) {
  const sections = reportSections(a.content)
  const statsPayload = a.payload.stats as Record<string, number> | undefined
  const summary = sections.find(x => /요약/.test(x.title))
  const tiles: [string, number][] = statsPayload
    ? Object.entries({ '진행 프로젝트': statsPayload.active_projects, '오늘 완료한 할 일': statsPayload.done_today, 지연: statsPayload.overdue, '새 리서치': statsPayload.new_research }).filter((e): e is [string, number] => typeof e[1] === 'number')
    : [...(summary?.lines.join(' ') ?? '').matchAll(/([가-힣][가-힣\s]*?)\s*(\d+)/g)].map(m => [m[1].trim(), Number(m[2])] as [string, number]).slice(0, 4)
  return (
    <div className="col gap-10">
      {tiles.length > 0 && (
        <div className="kpis" style={{ gridTemplateColumns: `repeat(${Math.min(4, tiles.length)}, minmax(0, 1fr))` }}>
          {tiles.map(([label, n]) => (
            <div key={label} className="kpi" style={{ background: 'var(--white)' }}>
              <span className="t-cap">{label}</span>
              <span className="v" style={label.includes('지연') && n ? { color: 'var(--red)' } : undefined}>
                {n}
              </span>
            </div>
          ))}
        </div>
      )}
      {sections
        .filter(x => x !== summary || !tiles.length)
        .map((sec, i) => (
          <div key={i} className="col gap-2">
            {sec.title && <span className="t-smallb">{sec.title}</span>}
            {sec.lines.map((l, j) => {
              const m = l.match(/^[·•-]\s*(.+?)\s*\(할 일 (\d+)\/(\d+)\)\s*[—–-]?\s*(.*)$/)
              if (m) {
                const done = Number(m[2])
                const total = Number(m[3])
                const pct = total ? (done / total) * 100 : 0
                return (
                  <div key={j} className="row t-small" style={{ gap: 8 }}>
                    <span className="t-smallb truncate" style={{ width: 170, flexShrink: 0 }}>
                      {m[1]}
                    </span>
                    <span style={{ width: 90, display: 'flex' }}>
                      <Meter value={pct} label={`${m[1]} 할 일 완료율`} />
                    </span>
                    <span className="t-meta t-blue">{Math.round(pct)}%</span>
                    <span className="t-cap truncate grow"><Linkify text={m[4]} /></span>
                  </div>
                )
              }
              return (
                <span key={j} className="t-small">
                  <Linkify text={l.replace(/^[·•-]\s*/, '· ')} />
                </span>
              )
            })}
          </div>
        ))}
    </div>
  )
}
