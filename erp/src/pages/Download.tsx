import { DOWNLOADS, desktop } from '../lib/desktop'
import { Link } from '../lib/router'
import { LogoTile } from '../components/Shell'

const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent)

/** PC 설치 프로그램 내려받기 (로그인 전에도 열림) */
export default function Download() {
  const app = desktop()
  return (
    <div className="page">
      <div className="center-page grow">
        <div className="login download-card">
          <div className="inner">
            <LogoTile />
            <h1 className="t-title" style={{ textAlign: 'center', margin: 0 }}>
              PC 프로그램 내려받기
            </h1>
            {app ? (
              <p className="t-small" style={{ textAlign: 'center', margin: 0 }}>
                지금 PC 프로그램(버전 {app.version})으로 접속 중입니다. 새 버전은 자동으로 설치됩니다.
              </p>
            ) : (
              <p className="t-small" style={{ textAlign: 'center', margin: 0 }}>
                회사 컴퓨터에는 PC 프로그램을 설치하세요. <b>출근 기록은 PC 프로그램으로 로그인할 때 남습니다.</b>
              </p>
            )}
            <div className="col gap-6">
              <a className={`btn ${isMac ? 'btn-outline' : 'btn-blue'} btn-block`} href={DOWNLOADS.windows}>
                윈도우용 내려받기 (.exe)
              </a>
              <a className={`btn ${isMac ? 'btn-blue' : 'btn-outline'} btn-block`} href={DOWNLOADS.mac}>
                맥용 내려받기 (.dmg)
              </a>
            </div>

            <div className="col gap-6">
              <span className="t-bodyb">
                설치 방법
              </span>
              <ol className="guide-steps">
                <li>
                  <b>윈도우</b>: 내려받은 파일을 실행합니다. '알 수 없는 게시자' · 'PC 보호' 창이 뜨면 <b>추가 정보 › 실행</b>을 누르세요.
                </li>
                <li>
                  <b>맥</b>: .dmg를 열고 WKLY 아이콘을 <b>응용 프로그램</b> 폴더로 끌어 놓습니다. 처음 열 때 막히면 <b>시스템 설정 › 개인정보 보호 및 보안</b> 아래쪽의 <b>그래도 열기</b>를 누르세요.
                </li>
                <li>회사 계정으로 로그인하면 끝입니다. 다음부터는 컴퓨터를 켜면 자동으로 열립니다.</li>
              </ol>
            </div>

            <div className="col gap-6">
              <span className="t-bodyb">PC 프로그램 규칙</span>
              <ul className="guide-steps">
                <li>컴퓨터를 켜면 자동으로 열리고, 로그인하기 전에는 창을 닫을 수 없습니다.</li>
                <li>로그인은 그날만 유지됩니다. 다음 날에는 다시 로그인하세요.</li>
                <li>컴퓨터를 30분 동안 쓰지 않거나 화면을 잠그면 인트라넷도 잠깁니다. 비밀번호를 넣으면 이어서 쓸 수 있습니다.</li>
                <li>X를 누르면 꺼지지 않고 오른쪽 아래(맥은 위쪽 메뉴 막대) 아이콘으로 숨습니다. 알림 · 소리는 계속 옵니다.</li>
                <li>휴대폰 · 브라우저 접속도 그대로 쓸 수 있지만, 근태에는 '외부 접속'으로 표시됩니다.</li>
              </ul>
            </div>

            <Link to="/" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }}>
              인트라넷으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
