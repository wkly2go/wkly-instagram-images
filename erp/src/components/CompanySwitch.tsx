import { COMPANIES, COMPANY_KEYS, setCompany, useCompany } from '../lib/company'

/** 회사 고르기 칩: 전체 · 아트리어 · 더위클리 (회계 · 거래처 화면 공통) */
export function CompanySwitch({ allowAll = true, onChange }: { allowAll?: boolean; onChange?: () => void }) {
  const pick = useCompany()
  const choose = (v: typeof pick) => {
    if (v === pick) return
    setCompany(v)
    onChange?.()
  }
  return (
    <div className="chips company-switch" role="tablist" aria-label="회사">
      {allowAll && (
        <button type="button" role="tab" aria-selected={pick === 'all'} className={`chip ${pick === 'all' ? 'active' : ''}`} onClick={() => choose('all')}>
          전체 회사
        </button>
      )}
      {COMPANY_KEYS.map(k => (
        <button key={k} type="button" role="tab" aria-selected={pick === k} className={`chip ${pick === k ? 'active' : ''}`} onClick={() => choose(k)} title={COMPANIES[k].full}>
          <span className="company-dot" style={{ background: COMPANIES[k].color }} />
          {COMPANIES[k].label}
        </button>
      ))}
    </div>
  )
}

/** 회사 작은 표시 (거래처 줄 등) */
export function CompanyTag({ k }: { k: keyof typeof COMPANIES }) {
  return (
    <span className="company-tag" style={{ borderColor: COMPANIES[k].color, color: COMPANIES[k].color }}>
      {COMPANIES[k].label}
    </span>
  )
}
