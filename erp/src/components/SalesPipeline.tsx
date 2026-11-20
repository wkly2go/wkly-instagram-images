import { useState } from 'react'
import { useApp, useAsync } from '../lib/app'
import { Link } from '../lib/router'
import type { SalesPipelineStage } from '../lib/api'

/**
 * 영업 파이프라인 한 화면 (2026-11-20 메신저 협업 · 영업 기획 2~4주차 마지막)
 * 새 문의 → 영업 대상 → 기획안 승인 대기 → 실행 준비 → 상담 중 → 계약 전 → 진행. 건수를 누르면 그 단계의 최근 5건.
 * 읽기만 (RPC sales_pipeline · 부르는 사람 권한 그대로). 손으로 옮겨 적는 칸 없음 — 단계는 각 화면에서 바뀐 것이 저절로 반영된다.
 */
export function SalesPipeline() {
  const { api } = useApp()
  const state = useAsync(() => api.salesPipeline().catch(() => [] as SalesPipelineStage[]), [api], [] as SalesPipelineStage[])
  const [open, setOpen] = useState<string | null>(null)
  const stages = state.data
  if (!state.loading && !stages.length) return null
  const cur = stages.find(s => s.key === open)
  return (
    <section className="sales-pipe" aria-label="영업 파이프라인">
      <h2 className="tx-em">영업 파이프라인</h2>
      <ol className="sales-pipe-row">
        {(state.loading ? [] : stages).map(s => (
          <li key={s.key}>
            <button type="button" className={`sales-pipe-step${open === s.key ? ' on' : ''}${s.count ? '' : ' zero'}`} aria-expanded={open === s.key} title={s.hint}
              onClick={() => setOpen(open === s.key ? null : s.key)}>
              <span className="n">{s.count.toLocaleString('ko-KR')}</span>
              <span className="l">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      {state.loading && <p className="tx-sub" role="status">불러오는 중…</p>}
      {cur && (
        <div className="sales-pipe-list">
          <p className="tx-sub">{cur.hint}{cur.count > cur.items.length ? ` · 최근 ${cur.items.length}건` : ''}</p>
          {cur.items.length === 0 ? <p className="tx-sub">없습니다.</p> : (
            <ul>
              {cur.items.map((it, i) => (
                <li key={i}>
                  <Link to={it.link} className="truncate">{it.title}</Link>
                  <span className="tx-sub">{it.sub}{it.at ? ` · ${it.at.slice(5, 10).replace('-', '.')}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
