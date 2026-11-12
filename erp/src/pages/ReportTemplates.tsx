import { ReportTemplates } from '../components/Reports'
import { ReportDashboard } from '../components/ReportDashboard'
import { Shell } from '../components/Shell'
import { Link } from '../lib/router'

export default function ReportTemplatesPage() {
  return (
    <Shell active="reportTemplates">
      <h1 className="t-title" style={{ margin: 0 }}>리서치/보고서 결재</h1>
      <ReportDashboard />
      <ReportTemplates tabs={<h2 className="t-title" style={{ margin: 0 }}>보고서 양식</h2>} />
      <nav className="row wrap" aria-label="보고서 관련 화면" style={{ gap: 12 }}>
        <Link to="/approvals?section=research" className="btn btn-outline">리서치 자료 · 보고서 결재 보기</Link>
      </nav>
    </Shell>
  )
}
