import { useState } from 'react'
import { useAction, useApp, useAsync } from '../lib/app'
import type { EstimateLine } from '../lib/design'

/** 견적 '단가 없음' 줄 아래: 물가 기준(조달청) 후보 3개 · 관리자는 골라서 판매 단가로 넣음 */
export function DesignPriceSuggest({ line, onAdded }: { line: EstimateLine; onAdded: () => void }) {
  const { api, me } = useApp()
  const { busy, run } = useAction()
  const [added, setAdded] = useState<number | null>(null)
  const { data, loading } = useAsync(() => api.suggestPriceRefs(line.item, line.spec, line.unit), [line.id], [])
  const admin = me.role === 'admin'
  if (loading) return <p className="t-cap">물가 기준에서 찾는 중…</p>
  if (!data.length) return <p className="t-cap">물가 기준(조달청)에 단위가 같고 이름이 비슷한 품목이 없습니다. '단가' 탭 › 물가 기준에서 낱말을 바꿔 찾아보세요.</p>
  const won = (n: number | null) => (n == null ? '-' : Math.round(n).toLocaleString('ko-KR'))
  return (
    <div className="design-suggest">
      <p className="t-cap">물가 기준(조달청) 후보 · 조달청 가격은 자재 단가이거나 시공 원가라 우리 이윤 · 현장 조건은 들어 있지 않습니다.</p>
      <ul>{data.map(s => (
        <li key={s.ref_id}>
          <span><b>{won(s.price)}</b>원/{s.unit} · {s.item} <span className="t-cap">{s.spec}</span>
            {s.labor != null && <span className="t-cap"> (재료 {won(s.material)} · 노무 {won(s.labor)} · 경비 {won(s.expense)})</span>}
            <span className="t-cap"> · {s.source_name} · {s.notice_date ?? ''}</span></span>
          {admin && (added === s.ref_id
            ? <span className="t-cap">판매 단가로 넣음 · 견적 다시 계산을 누르세요</span>
            : <button type="button" className="design-ref-find" disabled={busy || added !== null}
                onClick={() => run(async () => {
                  await api.addUnitPrice({ trade_code: line.trade_code, item: line.item, spec: line.spec, unit: line.unit, sell_price: Math.round(s.price), source_doc: `조달청 물가 기준 · ${s.source_name} · ${s.notice_date ?? ''}`.slice(0, 200), notes: `${s.item} ${s.spec}`.slice(0, 300) })
                  setAdded(s.ref_id); onAdded()
                }, '판매 단가로 넣었습니다')}>이 금액을 판매 단가로</button>)}
        </li>))}
      </ul>
    </div>
  )
}
