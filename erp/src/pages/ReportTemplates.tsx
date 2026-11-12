// 메뉴 '리서치' (대표 지시 2026-11-12 "리서치와 보고서를 두개로 분리해")
//  - 리서치 자료 목록 · 거래처 리서치 보고서 양식 (리서치 대시보드는 대표 지시로 삭제 2026-11-12)
//  - /research · 예전 주소 /report-templates · /approvals?section=research 모두 여기로
import { lazy, Suspense } from 'react'
import { ReportTemplates } from '../components/Reports'
import { Shell } from '../components/Shell'
import { Link } from '../lib/router'

const Research = lazy(() => import('./Library').then(module => ({ default: module.Research })))

export default function ResearchPage() {
  return (
    <Shell active="reportTemplates">
      <h1 className="t-title" style={{ margin: 0 }}>리서치</h1>
      <section role="region" aria-label="리서치 자료" className="col gap-10" style={{ minWidth: 0 }}>
        <p className="t-cap" style={{ margin: 0 }}>수집한 자료와 거래처 리서치 보고서를 찾아보고 관리합니다.</p>
        <Suspense fallback={<p className="t-cap" role="status">리서치 자료를 불러오는 중…</p>}>
          <Research
            tabs={
              <nav className="row wrap" aria-label="리서치 관련 자료" style={{ gap: 12 }}>
                <Link to="/library?tab=contacts" className="t-small">브랜드 담당자</Link>
                <Link to="/library?tab=templates" className="t-small">메일 템플릿</Link>
                <Link to="/library?tab=agents" className="t-small">에이전트 연결 안내</Link>
              </nav>
            }
          />
        </Suspense>
      </section>
      <ReportTemplates tabs={<h2 className="t-title" style={{ margin: 0 }}>리서치 보고서 양식</h2>} />
    </Shell>
  )
}
