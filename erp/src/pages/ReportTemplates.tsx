import { ReportTemplates } from '../components/Reports'
import { Shell } from '../components/Shell'
import { Link } from '../lib/router'

export default function ReportTemplatesPage() {
  return (
    <Shell active="reportTemplates">
      <ReportTemplates tabs={<h1 className="t-title" style={{ margin: 0 }}>보고서 양식</h1>} />
      <nav className="row wrap" aria-label="보고서 관련 화면" style={{ gap: 12 }}>
        <Link to="/library" className="btn btn-outline">리서치 자료 보기</Link>
        <Link to="/approvals" className="btn btn-outline">보고서 결제 보기</Link>
      </nav>
    </Shell>
  )
}
