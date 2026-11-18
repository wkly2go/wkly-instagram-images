import { useEffect, useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import type { DesignBase, PriceRef } from '../lib/design'

/** 기호 앞 두 글자로 고르는 기본 공종 (비어 있을 때만 채움 · 건축 자재는 공종이 여러 가지라 비워 둔다) */
const GROUP_TRADE: Record<string, string> = { EM: 'T10', MM: 'T12', MC: 'T12' }

/**
 * 수량표 › 물가 기준에서 찾아 넣기 (2026-11-18 대표 지시 '물가정보를 기호화해서 견적이나 물량 산출에 사용')
 * 기호(BM053-015)나 이름으로 찾아 고르면 아래 '직접 넣기' 칸에 품목 · 규격 · 단위가 채워진다. 수량만 적고 넣으면 된다.
 * 금액은 여기서 견적에 넣지 않는다 — 견적 '단가 없음' 줄의 물가 기준 후보에서 관리자가 판매 단가로 고른다.
 */
export function DesignPriceRefPick({ base, onPick }: { base: DesignBase; onPick(r: PriceRef & { trade?: string }): void }) {
  const { api } = useApp()
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const t = window.setTimeout(() => setQ(text.trim()), 350); return () => window.clearTimeout(t) }, [text])
  const { data, loading } = useAsync(() => (q.length >= 2 ? api.listPriceRefs(q) : Promise.resolve({ rows: [] as PriceRef[], total: 0 })), [q], { rows: [] as PriceRef[], total: 0 })
  const trade = (code: string | null | undefined) => { const t = GROUP_TRADE[(code ?? '').slice(0, 2)]; return t && base.trades.some(x => x.code === t) ? t : undefined }
  return (
    <div className="design-refpick" aria-label="물가 기준에서 찾아 넣기">
      <input className="input" type="search" value={text} onChange={e => setText(e.target.value)} placeholder="물가 기준에서 찾아 넣기 — 기호(BM053-015)나 이름 (2글자 이상)" aria-label="물가 기준 찾기" />
      {q.length >= 2 && (loading ? <p className="t-cap" role="status">찾는 중…</p> : data.rows.length === 0 ? <p className="t-cap">맞는 물가 기준이 없습니다. 낱말을 바꿔 보세요.</p> : (
        <ul>{data.rows.slice(0, 12).map(r => (
          <li key={r.id}><button type="button" onClick={() => { onPick({ ...r, trade: trade(r.code) }); setText('') }}>
            <b>{r.code}</b><span>{r.item}</span><span className="t-cap">{r.spec}</span><span className="num">{Math.round(r.price).toLocaleString('ko-KR')}원/{r.unit}</span><span className="t-cap">{r.notice_date ?? ''}</span>
          </button></li>))}
          {data.total > 12 && <li className="t-cap">{data.total.toLocaleString('ko-KR')}건 중 12건 — 낱말을 더 넣어 좁혀 보세요.</li>}
        </ul>))}
    </div>
  )
}
