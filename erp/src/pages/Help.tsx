import type { ReactNode } from 'react'
import { useApp } from '../lib/app'
import { Link } from '../lib/router'
import { Shell } from '../components/Shell'
import { SectionHead } from '../components/ui'
import { AutoStartGuide, PushToggle } from '../components/PushSetup'

/** 사용법: 직원·관리자용 짧은 설명서 (관리자 전용 부분은 관리자에게만 보임) */
export default function Help() {
  const { me } = useApp()
  const admin = me.role === 'admin'
  return (
    <Shell active="team">
      <SectionHead title="사용법" right={<Link to="/team">‹ 팀으로</Link>} />
      <div className="note">업무 기록 · 승인 · 프로젝트를 한곳에서 관리하는 사내 인트라넷입니다. 왼쪽 사진 아래가 메뉴(숫자 = 처리할 것)이고, 맨 위 '+ 새로 만들기'로 할 일 · 결재 · 프로젝트를 바로 만듭니다. 휴대폰은 아래 메뉴입니다.</div>

      <Part title="처음 로그인했을 때">
        <Step n={1}>관리자에게 받은 회사 이메일과 임시 비밀번호로 로그인합니다.</Step>
        <Step n={2}>
          <Link to="/team?tab=me">팀 › 내 정보</Link>에서 새 비밀번호로 바꿉니다.
        </Step>
        <Step n={3}>위쪽 종 모양 › 'PC 알림 (창을 닫아도)' 켜기를 누릅니다. 인트라넷 창을 닫아 둬도 채팅·승인 요청·할 일 알람이 PC 알림으로 옵니다.</Step>
        <Step n={4}>PC 크롬·엣지는 주소창 오른쪽 '앱 설치', 휴대폰은 공유 › '홈 화면에 추가'로 앱처럼 씁니다.</Step>
      </Part>

      <Part title="손에 붙게 쓰기 (2026.10 새 기능)">
        <Step n={1}>
          위쪽 <b>찾기 칸</b>(Ctrl K) 하나로 사람 · 프로젝트 · 파일을 찾고, 그대로 <b>Ctrl+Enter</b> 면 WKLY 총괄에게, <b>Shift+Enter</b> 면 인터넷 검색입니다.
        </Step>
        <Step n={2}>
          진행 중인 프로젝트마다 <b>채팅 › 프로젝트 대화</b> 방이 있습니다. 그 프로젝트의 할 일 · 결재 · 파일이 카드로 올라오고, 카드의 <b>완료 · 내일로 · 승인 · 반려</b> 버튼으로 바로 처리합니다.
        </Step>
        <Step n={3}>
          채팅 입력칸에 <code>/</code> 를 치면 명령이 나옵니다. 예) <code>/할일 현장 사진 셀렉 @김하늘 내일 6시</code> · <code>/일정 현장 미팅 10/28 14:00</code> · <code>/결재 촬영 소품 구매</code> · <code>/ai 이번 주 할 일 정리해줘</code>
        </Step>
        <Step n={4}>
          방 위쪽 <b>알림</b>에서 전체 · 멘션만 · 끄기를 고릅니다. 다른 사람 프로젝트 방은 처음에 '멘션만' 입니다. 결재 · 할 일 배정 알림은 항상 옵니다.
        </Step>
        <Step n={5}>
          메시지에 마우스를 올리고 <b>책갈피</b>를 누르면 '나중에 보기' 에 저장되고, 고른 시각(1시간 뒤 · 내일 9시 등)에 다시 알려 줍니다.
        </Step>
        <Step n={6}>
          단축키는 <b>?</b> 키로 봅니다. Alt+1~9 메뉴 이동, Alt+↑↓ 채팅방 이동, Esc 읽음 처리.
        </Step>
      </Part>

      <Part title="창을 닫아도 알림 받기 · 컴퓨터 켤 때 자동 시작">
        <div className="row wrap">
          <span className="t-small">이 컴퓨터의 PC 알림</span>
          <PushToggle />
        </div>
        <span className="t-cap">알림은 크롬·엣지가 백그라운드에서 켜져 있으면 옵니다. 앱으로 설치하고 아래처럼 자동 시작을 켜 두면 컴퓨터를 켤 때마다 인트라넷이 열립니다.</span>
        <AutoStartGuide />
      </Part>

      <Part title="인트라넷을 항상 화면 위에 두기">
        <Step n={1}>작은 창은 위쪽 <b>빠른 창 띄우기</b>를 누를 때만 열립니다. 본창과 따로 쓰고, 본창을 눌러도 저절로 뜨지 않습니다.</Step>
        <Step n={2}>빠른 창 위쪽의 <b>📌</b>를 누르면 다른 프로그램 위에 항상 떠 있는 창으로 바뀝니다. (크롬 · 엣지)</Step>
        <Step n={3}>
          <b>큰 인트라넷 창 전체</b>를 항상 위에 두려면 윈도우는 Microsoft <b>PowerToys</b>를 설치한 뒤 인트라넷 창에서 <code>Win + Ctrl + T</code>를 누르세요 (다시 누르면 해제). 맥은 기본 기능이 없어 별도 앱이 필요합니다.
        </Step>
      </Part>

      <Part title="PC 프로그램 (출근 기록)">
        <Step n={1}>
          회사 컴퓨터에는 <Link to="/download">PC 프로그램</Link>을 설치하세요. 컴퓨터를 켜면 자동으로 열리고, 로그인 전에는 닫을 수 없습니다.
        </Step>
        <Step n={2}>로그인은 그날만 유지되고, 1시간 동안 쓰지 않으면 화면이 잠깁니다 (브라우저 · 휴대폰도 같음). 비밀번호를 넣으면 이어서 쓸 수 있습니다.</Step>
        <Step n={3}>관리자가 'PC 프로그램 접속만 출근'으로 정하면 출근은 PC 프로그램 로그인으로만 기록되고, 휴대폰 · 브라우저 접속은 '외부 접속'으로 따로 보입니다.</Step>
      </Part>

      <Part title="휴대폰에서 쓰기">
        <Step n={1}>휴대폰 브라우저(아이폰 사파리 · 안드로이드 크롬)로 <b>{window.location.host}</b>에 들어가 같은 계정으로 로그인합니다.</Step>
        <Step n={2}>
          아이폰은 <b>공유 › 홈 화면에 추가</b>, 안드로이드는 <b>⋮ › 홈 화면에 추가(앱 설치)</b>를 누르면 앱처럼 아이콘이 생깁니다.
        </Step>
        <Step n={3}>메뉴는 화면 아래에 있고 옆으로 밀면 나머지 메뉴가 보입니다. 프로필 · 작은 달력은 홈에서만 보입니다.</Step>
      </Part>

      <Part title="구글 캘린더 연동">
        <Step n={1}>
          <b>프로젝트 › 캘린더 › 구글 캘린더 연동</b>을 누르고 <b>내 일정</b>(또는 팀 전체 일정) 주소를 복사합니다.
        </Step>
        <Step n={2}>PC에서 구글 캘린더 › 다른 캘린더 <b>+</b> › <b>URL로 추가</b>에 붙여 넣으면 인트라넷 할 일 · 프로젝트 기간 · 휴가가 들어옵니다. 같은 구글 계정이면 휴대폰 구글 캘린더 앱에도 보입니다.</Step>
        <Step n={3}>업무 하나만 넣으려면 업무 창의 <b>구글 캘린더에 추가</b>를 누르세요. 구글이 몇 시간마다 갱신하며, 구글 캘린더에서 고친 내용은 인트라넷으로 돌아오지 않습니다.</Step>
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
        <Step n={5}>다른 사람에게 일을 맡길 때는 프로젝트 › <b>업무 지시</b>로 받는 사람 · 단계 · 시작일 · 마감일을 넣습니다. 받는 사람의 '내 할 일'과 프로젝트 일정표 · 캘린더에 바로 들어갑니다.</Step>
        <Step n={6}>쉬는 날은 팀·근태 › 연차 · 휴가에서 신청합니다. 관리자가 승인하면 연차에서 차감됩니다.</Step>
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
  ['홈', '승인 대기 바로 처리, 오늘 현황, 일일 보고, AI 팀원에게 지시(평일 08:24 · 17:54 처리), 팀 한마디'],
  ['승인', '업무 보고 · 일일 보고 · 메일 발송 · 지출 요청과 결정. 지출이 승인되면 결제 대장에 자동 등록'],
  ['채팅', '팀·프로젝트 채팅방, @이름으로 알림'],
  ['업무', '업무 일지(채팅처럼 입력), 메일 발신·수신 기록, 업무 보고 제출, 팀원 파도타기'],
  ['프로젝트', '대시보드(수주 · 진행 · 마진율 그래프), 일정표(주 단위), 캘린더, 업무 지시 · 내 할 일 · 내가 지시한 업무 (재무·결제 대장은 관리자)'],
  ['거래처', '담당자, 연락 이력, 전화·메일 바로가기'],
  ['자료실', '리서치 자료 활용, 브랜드 담당자, 메일 템플릿'],
  ['팀·근태', '팀원 상태 · 근태 관리(출근 시각 · 미출근), 연차 · 휴가 신청(입사일 기준 자동 계산), 이름을 누르면 인사기록'],
  ['관리', '팀원(이름 변경 · 비밀번호 재설정 · 삭제) · 승인 담당 · WKLY 총괄 · 연결 키 · 백업', true],
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
