import { Link } from '../lib/router'

/**
 * 광고 운영팀 구성 기획 (대표 지시 2026-11-16 '광고기획 · 퍼포먼스 마케팅 · 컨텐츠 크리에이팅 · UI·UX·AX 디자이너 · 영상 광고 디렉터가 한 팀으로 · 결재는 대표')
 * 기획 초안을 광고·콘텐츠 화면에 그대로 둔다. 예약 작업은 아직 만들지 않았음 (대표 승인 뒤).
 */
const ROLES: [string, string, string, string][] = [
  ['AD-PLAN', '광고 기획 (팀장 겸임)', '주간 가설 2~3개 · 타깃 · 메시지 · 오퍼 · 채널 배분 · 판정 기준 · 팀 지시와 종합', '주간 캠페인 기획서'],
  ['ADS (기존)', '퍼포먼스 마케팅', '메타 · 구글 · 네이버 집행, 입찰 · 예산 반영, 성과 · 무효 클릭 집계, 판정', '일일 수치 · 금요일 판정표'],
  ['AD-CREA', '콘텐츠 크리에이팅', '카피 · 이미지 소재 시안 · 소재 변형 (가설당 2~3종)', '소재 묶음 (드라이브 광고소재 폴더)'],
  ['AD-UX', 'UI · UX · AX 디자인', '광고 → 랜딩 → 문의 경로 설계, 문의 폼, AI 응대 (채팅 · AI 검색 노출) 경로', '랜딩 수정안 · 문의 경로 점검표'],
  ['AD-FILM', '영상 광고 디렉터', '릴스 · 쇼츠 광고 콘티, 촬영본 편집 지시, 영상 소재', '콘티 · 영상 시안'],
]
const WEEK: [string, string, string, boolean][] = [
  ['금', 'ADS', '지난 주 가설 판정표 (중단 · 유지 · 증액)', false],
  ['월 오전', 'AD-PLAN', '판정표를 반영해 주간 기획서 작성 → 결재 ① 기획 · 예산', true],
  ['월~화', 'AD-CREA · AD-FILM · AD-UX', '승인된 기획서 기준으로 소재 · 영상 · 랜딩 수정안 제작 (병행)', false],
  ['수', 'AD-PLAN', '소재 · 랜딩 묶음 검수 → 결재 ② 소재 · 랜딩', true],
  ['수~목', 'ADS', '승인 건 집행 (22~07시에는 집행 · 결제 없음)', false],
  ['매일', 'ADS', '수치 기록, 기준 이탈 시 팀장에게 보고', false],
]
const STEPS: [string, string][] = [
  ['과거 광고 · 문의 데이터 정리, 승패 소재 분류', '정리본 1건'],
  ['역할별 지침 · 양식 작성 (기획서 · 소재 묶음 · 랜딩 점검표 · 콘티)', '양식 4종'],
  ['예약 작업 4개 생성, AI 팀원 명단 등록', '각 1회 시험 실행'],
  ['첫 주간 순환 (기획 → 결재 → 제작 → 결재 → 집행 → 판정)', '가설 2~3개 집행'],
  ['4주 운영 뒤 평가, 역할 통합 · 분리 조정', '평가 보고 1건'],
]
const OPEN: string[] = [
  '콘텐츠팀 디자인 · 영상(GFX)과의 관계: 광고 전용 AD-CREA · AD-FILM 을 새로 둘지, GFX 에 광고 업무를 더할지',
  '범위: 자사 광고 전용인지, 팝업 대행 고객사 광고까지 포함인지',
  "AX 의 뜻: 지금은 'AI 를 거쳐 들어오는 고객 경험'(문의 채팅 응대 · AI 검색 답변 노출)으로 해석",
]

export function AdTeamPlan() {
  return (
    <div className="adteam">
      <div className="adteam-state">
        <b>기획 초안 · 아직 만들지 않음</b>
        <span>2026-11-16 대표 지시로 정리한 안입니다. 예약 작업을 만들거나 기존 작업을 고치는 일은 대표 승인 뒤에 합니다.</span>
      </div>

      <section className="adteam-sec">
        <h2>결재는 대표</h2>
        <ul className="adteam-list">
          <li><b>주 2회로 묶음</b> — ① 월요일 기획 · 예산, ② 수요일 소재 · 랜딩. <Link to="/approvals">보고서 › 결재</Link>에 '[AI 결재 요청] 광고 …'로 올라옵니다.</li>
          <li><b>수시 결재</b> — 일 예산 증감, 새 채널, 랜딩 페이지 배포, 유료 도구.</li>
          <li>팀은 초안까지만 만듭니다. 승인 전에는 집행 · 게시 · 배포를 하지 않습니다. 알림 제목에 금액을 넣지 않습니다.</li>
          <li>소재 컨펌도 대표 결재로 합니다 (11-16 지시 '광고 컨텐츠 팀의 결재는 대표가').</li>
          <li>대표 보고는 총괄 18:00 보고의 광고 항목과 주간 성과 보고 1건.</li>
        </ul>
      </section>

      <section className="adteam-sec">
        <h2>팀 구성 · 5역할</h2>
        <div className="adteam-roles">
          {ROLES.map(([code, role, work, out]) => (
            <article key={code} className="adteam-role">
              <span className="adteam-code">{code}</span>
              <h3>{role}</h3>
              <p>{work}</p>
              <p className="adteam-out"><b>산출물</b> {out}</p>
            </article>
          ))}
        </div>
        <p className="adteam-note">기존 통합 광고 작업(광고 성과 · 입찰 · 부정클릭)은 퍼포먼스 역할로 그대로 쓰고, 새 예약 작업은 4개입니다. 이미지 · 영상 생성 비용은 기존 월 상한 안에서 씁니다.</p>
      </section>

      <section className="adteam-sec">
        <h2>주간 운영 순서</h2>
        <table className="table adteam-table">
          <thead><tr><th>요일</th><th>담당</th><th>작업</th></tr></thead>
          <tbody>
            {WEEK.map(([day, who, work, gate]) => (
              <tr key={day} className={gate ? 'gate' : ''}><td>{day}</td><td>{who}</td><td>{work}{gate && <span className="adteam-gate">대표 결재</span>}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="adteam-note">팀원 사이 전달은 지시 · 보고 기록으로 하고 사람에게 직접 알림을 보내지 않습니다. 기획서의 근거 수치와 가설 논리는 감사가 따로 검수합니다.</p>
      </section>

      <section className="adteam-sec adteam-two">
        <div>
          <h2>평가 지표</h2>
          <ul className="adteam-list">
            <li><b>1차</b> 문의당 비용 · 월 문의 수 (목표 월 30건)</li>
            <li><b>2차</b> 가설 적중률 · 소재 교체 주기 · 랜딩 문의 전환율</li>
            <li><b>장기</b> 광고 유입 문의의 수주 전환</li>
          </ul>
        </div>
        <div>
          <h2>구축 순서</h2>
          <ol className="adteam-steps">
            {STEPS.map(([work, done]) => <li key={work}>{work}<span>{done}</span></li>)}
          </ol>
        </div>
      </section>

      <section className="adteam-sec">
        <h2>대표 결정이 남은 것</h2>
        <ul className="adteam-list">{OPEN.map(x => <li key={x}>{x}</li>)}</ul>
      </section>
    </div>
  )
}
