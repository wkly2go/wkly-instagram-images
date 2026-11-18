// 인터뷰 질문 은행 — 관리자 전용 메뉴 (2026-11-19 대표 지시 '관리자 전용에 만들어')
// 서면 인터뷰지의 자리(Q1~Q10)마다 기본 문안 · 다른 문안을 관리한다. 브랜드별 인터뷰지는 영업·수주 › 서면 인터뷰에서 만든다.
import { Shell } from '../components/Shell'
import { InterviewQuestionBank } from '../components/InterviewQuestionBank'
import { Empty } from '../components/ui'
import { useApp } from '../lib/app'
import '../components/SalesInterviews.css'

export default function InterviewQuestions() {
  const { me } = useApp()
  return (
    <Shell active="interviewQuestions">
      {me.role !== 'admin' ? (
        <Empty>관리자만 볼 수 있는 화면입니다.</Empty>
      ) : (
        <div className="design-page">
          <header className="design-head">
            <h1 className="t-title">인터뷰 질문 은행</h1>
            <p className="t-cap">서면 인터뷰지에 들어가는 질문 문안입니다. 브랜드별 인터뷰지는 영업·수주 › 서면 인터뷰에서 이 문안으로 만들어지고, 여기서 고친 글은 다음에 만드는 인터뷰지부터 쓰입니다.</p>
          </header>
          <div className="design-block sales-iv">
            <InterviewQuestionBank />
          </div>
        </div>
      )}
    </Shell>
  )
}
