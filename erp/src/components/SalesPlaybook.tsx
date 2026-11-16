import { getSalesPlaybook, salesPlaybookActionPatch, type SalesPlaybookDraft } from '../lib/salesPlaybook'
import type { SalesDraft } from '../lib/sales'
import { Button } from './ui'

export function SalesPlaybook({ draft, onApply, disabled = false }: {
  draft: SalesPlaybookDraft
  onApply?: (patch: Pick<SalesDraft, 'next_action'>) => void
  disabled?: boolean
}) {
  const guide = getSalesPlaybook(draft)
  const apply = () => {
    if (!onApply || disabled) return
    const patch = salesPlaybookActionPatch(draft, message => window.confirm(message), disabled)
    if (patch) onApply(patch)
  }
  return <section className="sales-notice" aria-label="단계별 영업 실행 안내">
    <h3 className="t-sub">{guide.trackLabel} · {guide.stage} 실행 안내</h3>
    <p><strong>현재 목표:</strong> {guide.goal}</p>
    <details>
      <summary>담당자 할 일과 {guide.nextStep} 확인 자료</summary>
      <h4>담당자 할 일</h4>
      <ol>{guide.actions.map(action => <li key={action}>{action}</li>)}</ol>
      <h4>{guide.nextStep} 전에 확인할 자료</h4>
      <ul>{guide.evidence.map(item => <li key={item}>{item}</li>)}</ul>
      {guide.handoff.length > 0 && <><h4>수주 인계 준비 체크리스트</h4><ul>{guide.handoff.map(item => <li key={item}>{item}</li>)}</ul><p className="t-cap">확인할 목록입니다. 인계 완료로 자동 처리되지 않습니다.</p></>}
      <p className="t-small">{guide.caution}</p>
    </details>
    <p className="sales-copy"><strong>다음 행동 예시:</strong> {guide.nextAction}</p>
    {onApply && <><Button kind="outline" disabled={disabled || draft.next_action === guide.nextAction} onClick={apply}>다음 행동 예시 적용</Button><p className="t-cap">다음 행동만 입력합니다. 연락일은 직접 확인하고 변경 내용을 저장하세요.</p></>}
  </section>
}
