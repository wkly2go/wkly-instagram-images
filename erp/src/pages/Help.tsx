import type { ReactNode } from 'react'
import { useApp } from '../lib/app'
import { Link } from '../lib/router'
import { Shell } from '../components/Shell'
import { SectionHead } from '../components/ui'

/** 사용법: 직원·관리자용 짧은 설명서 (관리자 전용 부분은 관리자에게만 보임) */
export default function Help() {
  const { me } = useApp()
  const admin = me.role === 'admin'
  return (
    <Shell active="team">
      <SectionHead title="사용법" right={<Link to="/team">‹ 팀으로</Link>} />
      <div className="note">업무 기록 · 승인 · 프로젝트를 한곳에서 관리하는 사내 인트라넷입니다. 오른쪽 세로 탭이 메뉴이고, 휴대폰에서는 위쪽 가로 탭입니다.</div>

      <Part title="처음 로그인했을 때">
        <Step n={1}>관리자에게 받은 회사 이메일과 임시 비밀번호로 로그인합니다.</Step>
        <Step n={2}>
          <Link to="/team">팀 › 내 정보</Link>에서 새 비밀번호로 바꿉니다.
        </Step>
        <Step n={3}>위쪽 종 모양 › PC 알림 '켜기'를 누르면 할 일 알람·승인 요청을 화면 밖에서도 받습니다.</Step>
        <Step n={4}>PC 크롬·엣지는 주소창 오른쪽 '앱 설치', 휴대폰은 공유 › '홈 화면에 추가'로 앱처럼 씁니다.</Step>
      </Part>

      <Part title="메뉴별 사용법">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>메뉴</th>
                <th>하는 일</th>
              </tr>
            </thead>
            <tbody>
              {MENUS.filter(([, , onlyAdmin]) => admin || !onlyAdmin).map(([menu, what]) => (
                <tr key={menu}>
                  <td className="strong nowrap">{menu}</td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="t-cap">상단 '빠른 창 띄우기'는 작은 독립 창입니다. 전체 창을 닫아도 기록·채팅·메뉴를 그대로 쓸 수 있고, 핀 버튼을 누르면 다른 프로그램 위에 항상 떠 있습니다.</span>
      </Part>

      <Part title="매일 하는 일">
        <Step n={1}>출근하면 ERP나 빠른 창에 로그인합니다. 그날 처음 접속한 시각이 출근 시각이고, 접속하지 않으면 팀·근태에 '미출근'으로 보입니다. 홈에서 TODAY IS 상태와 오늘 할 일을 확인합니다.</Step>
        <Step n={2}>일한 내용은 업무 탭에 채팅하듯 짧게 남깁니다. 메일 발신·수신, 미팅, 전화도 종류를 골라 기록합니다.</Step>
        <Step n={3}>돈이 나가는 일은 승인 › 승인 요청 › '지출'로 올립니다. 금액 · 사용처 · 받는 계좌를 함께 적으면 승인 뒤 결제 대장에 자동으로 들어갑니다.</Step>
        <Step n={4}>채팅에서 @이름을 쓰면 그 사람에게 알림이 갑니다.</Step>
      </Part>

      {admin && (
        <Part title="관리자: 직원 계정 등록">
          <Step n={1}>
            <Link to="/admin">관리 › 팀원 관리</Link> 아래 입력줄에 이름 · 회사 이메일 · 임시 비밀번호(8자 이상) · 직함을 넣고 구분 '사람'으로 <b>팀원 추가</b>를 누릅니다.
          </Step>
          <Step n={2}>임시 비밀번호는 단체방이 아니라 본인에게만 따로 알려 줍니다.</Step>
          <Step n={3}>로그인이 안 된다는 직원은 같은 표의 <b>비밀번호 › 재설정</b>으로 새 임시 비밀번호를 만들어 이메일 주소와 함께 다시 알려 줍니다.</Step>
          <Step n={4}>권한은 기본 '멤버'입니다. 결제 대장·계약액을 봐야 하는 사람만 '관리자'로 바꿉니다.</Step>
          <Step n={4}>관리 › 승인 담당에서 종류별 승인자를 정합니다 (예: 일일 보고 · 지출 → 대표).</Step>
          <Step n={5}>퇴사·휴직이면 상태를 '비활성'으로 바꿉니다. 기록은 남고 로그인해도 아무것도 볼 수 없습니다.</Step>
        </Part>
      )}

      {admin && (
        <Part title="관리자: 결제 대장">
          <Step n={1}>프로젝트 › 결제 대장 › 엑셀 가져오기로 지금 쓰는 엑셀을 한 번 옮깁니다. 계약금액·수금은 VAT 포함으로 보고 공급가액으로 저장합니다.</Step>
          <Step n={2}>매주 월요일: 이번 주 지급 › 이체용 CSV로 은행 대량이체 → 지급 완료 처리.</Step>
          <Step n={3}>점검 탭이 0건이 되게 정리합니다 (연체 · 계좌 없음 · 세금계산서 · 예산 초과 · 노무비).</Step>
          <Step n={4}>현장소장이 먼저 낸 돈은 '대지급자' 칸에 이름을 적고, 돌려주면 대지급 정산 › 정산 완료.</Step>
          <Step n={5}>매달 첫 주: 노무비 대장 › 지난달 세무사용 CSV를 보내고, 관리 › 데이터 백업 › 전체 내려받기 파일을 회사 드라이브에 보관합니다.</Step>
        </Part>
      )}

      {admin && (
        <Part title="관리자: WKLY 총괄 (AI)">
          <Step n={1}>
            <Link to="/admin">관리 › WKLY 총괄</Link> › <b>등록하기</b>를 누르면 AI 팀원 계정과 연결 키가 함께 만들어지고, 넣을 값 3개가 한 번만 보입니다.
          </Step>
          <Step n={2}>세 값은 WKLY 총괄이 도는 Claude 환경 설정(세션 제목줄 환경 메뉴 › Edit)에 환경 변수로 넣고, Network access › Allowed domains에 Supabase 주소를 추가합니다. 채팅에는 붙여 넣지 않습니다.</Step>
          <Step n={3}>평일 아침 할 일 배정, 저녁 일일 보고가 승인 › 일일 보고로 옵니다. 금액이 들어간 재무 위험은 관리자 알림으로만 옵니다.</Step>
        </Part>
      )}

      <Part title="지켜야 할 것">
        <Rule>비밀번호와 연결 키는 채팅 · 메일 · 문서에 붙여 넣지 않습니다.</Rule>
        <Rule>브랜드 담당자는 어디서 알게 됐는지 출처를 꼭 남깁니다. 수신거부한 사람은 메일 버튼이 잠깁니다.</Rule>
        <Rule>협업·영업 제안 메일은 '광고성' 템플릿을 쓰면 제목의 (광고)와 수신거부 안내가 자동으로 붙습니다.</Rule>
        {admin && <Rule>계좌번호 · 계약액은 관리자만 봅니다. 결제 대장 화면을 캡처해 밖으로 보내지 않습니다.</Rule>}
        {admin && <Rule>Supabase 무료 프로젝트는 일주일 동안 아무도 쓰지 않으면 일시정지됩니다. 연휴 뒤 열리지 않으면 Supabase 대시보드에서 다시 켭니다.</Rule>}
      </Part>
    </Shell>
  )
}

const MENUS: [string, string, boolean?][] = [
  ['홈', '승인 대기 바로 처리, 오늘 현황, 일일 보고, 팀 한마디'],
  ['승인', '업무 보고 · 일일 보고 · 메일 발송 · 지출 요청과 결정. 지출이 승인되면 결제 대장에 자동 등록'],
  ['채팅', '팀·프로젝트 채팅방, @이름으로 알림'],
  ['업무', '업무 일지(채팅처럼 입력), 메일 발신·수신 기록, 업무 보고 제출, 팀원 파도타기'],
  ['프로젝트', '대시보드, 프로젝트 · 할 일 · 알람 (재무·결제 대장은 관리자)'],
  ['거래처', '담당자, 연락 이력, 전화·메일 바로가기'],
  ['자료실', '리서치 자료 활용, 브랜드 담당자, 메일 템플릿'],
  ['팀·근태', '팀원 상태 · 근태 관리(출근 시각 · 미출근), 내 정보 · 비밀번호'],
  ['관리', '팀원 · 승인 담당 · WKLY 총괄 · 연결 키 · 백업', true],
]

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-h">
        <span className="t-bodyb">{title}</span>
      </div>
      <div className="col gap-6">{children}</div>
    </section>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
      <span className="badge outline" style={{ flex: 'none' }}>
        {n}
      </span>
      <span className="t-small">{children}</span>
    </div>
  )
}

function Rule({ children }: { children: ReactNode }) {
  return <span className="t-small">· {children}</span>
}
