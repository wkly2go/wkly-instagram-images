import { isDesktopApp } from '../lib/desktop'
import { useState } from 'react'
import { BellRing, Download, Power } from 'lucide-react'
import { useApp } from '../lib/app'
import { friendlyError } from '../lib/api'
import { usePush, useInstall } from '../lib/push'
import { Badge, Button } from './ui'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)
const isEdge = typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent)

/** 컴퓨터를 켜고 로그인하면 인트라넷이 저절로 열리게 하는 방법 */
export function AutoStartGuide() {
  return (
    <ol className="guide-steps">
      {isEdge ? (
        <li>
          주소창에 <code>edge://apps</code> 입력 › <b>THE WKLY</b> 앱의 <b>⋯</b> › <b>장치 로그인 시 자동 시작</b> 켜기
        </li>
      ) : (
        <li>
          주소창에 <code>chrome://apps</code> 입력 › <b>WKLY ERP</b> 아이콘 오른쪽 클릭 › <b>로그인할 때 앱 시작</b>(Start app when you sign in) 체크
        </li>
      )}
      {isMac ? (
        <li>
          위 메뉴가 없으면: <b>시스템 설정 › 일반 › 로그인 항목</b> › <b>+</b> › <b>응용 프로그램 › Chrome 앱 › WKLY ERP</b> 추가
        </li>
      ) : (
        <li>
          위 메뉴가 없으면: <b>Win + R</b> › <code>shell:startup</code> 입력 › 열린 폴더에 바탕화면의 <b>WKLY ERP</b> 바로가기를 복사
        </li>
      )}
      <li>컴퓨터를 켜면 인트라넷이 열리고, 로그인돼 있지 않으면 로그인 화면이 먼저 나옵니다. 처음 접속한 시각이 출근으로 기록됩니다.</li>
    </ol>
  )
}

/** 홈 상단: 창을 닫아도 알림 받기 · 앱 설치 · 자동 시작 (모두 끝나면 숨김) */
export function PushSetupCard() {
  const { api, toast } = useApp()
  const push = usePush(api)
  const app = useInstall()
  const [guide, setGuide] = useState(false)
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('wkly-erp-setup-hidden') === '1'
    } catch {
      return false
    }
  })
  if (push.state === 'demo' || push.state === 'unsupported') return null
  const done = push.state === 'on' && app.installed
  if (done || (hidden && push.state === 'on')) return null

  const enable = async () => {
    try {
      await push.enable()
      toast('PC 알림을 켰습니다. 인트라넷 창을 닫아 둬도 채팅·알림이 옵니다.')
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  const install = async () => {
    if (await app.install()) {
      toast('앱으로 설치했습니다. 아래 방법으로 컴퓨터를 켤 때 자동으로 열리게 해 두세요.')
      setGuide(true)
    }
  }
  // PC 프로그램은 늘 켜져 있어 따로 설정할 필요 없음
  if (isDesktopApp()) return null
  return (
    <div className="setup-card">
      <div className="row wrap">
        <BellRing size={16} />
        <span className="t-bodyb grow">창을 닫아 둬도 채팅·알림 받기</span>
        {push.state === 'on' ? (
          <Badge tone="acid">알림 켜짐</Badge>
        ) : push.state === 'denied' ? (
          <span className="t-cap">알림이 차단돼 있습니다. 주소창 왼쪽 자물쇠 › 알림 › 허용</span>
        ) : (
          <Button size="sm" onClick={enable} disabled={push.busy}>
            {push.busy ? '켜는 중…' : 'PC 알림 켜기'}
          </Button>
        )}
      </div>
      <div className="row wrap">
        <Download size={16} />
        <span className="t-bodyb grow">앱으로 설치하고 컴퓨터 켤 때 자동 시작</span>
        {app.installed ? (
          <Badge tone="acid">설치됨</Badge>
        ) : app.canInstall ? (
          <Button size="sm" kind="outline" onClick={install}>
            앱으로 설치
          </Button>
        ) : (
          <span className="t-cap">주소창 오른쪽 설치 아이콘(⊕)을 눌러도 됩니다</span>
        )}
        <Button size="sm" kind="ghost" onClick={() => setGuide(g => !g)} aria-expanded={guide}>
          <Power size={13} /> 자동 시작 방법
        </Button>
      </div>
      {guide && <AutoStartGuide />}
      {push.state === 'on' && (
        <div className="row">
          <span className="grow" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              try {
                localStorage.setItem('wkly-erp-setup-hidden', '1')
              } catch {
                /* noop */
              }
              setHidden(true)
            }}
          >
            다시 보지 않기
          </button>
        </div>
      )}
    </div>
  )
}

/** 알림 종 아래: 켜기·끄기 */
export function PushToggle() {
  const { api, toast } = useApp()
  const push = usePush(api)
  if (push.state === 'unsupported') return <Badge tone="paper">지원 안 함</Badge>
  if (push.state === 'demo') return <Badge tone="paper">체험 모드</Badge>
  if (push.state === 'denied')
    return (
      <span className="t-cap" title="주소창 왼쪽 자물쇠 › 알림 › 허용">
        <Badge tone="paper">차단됨</Badge>
      </span>
    )
  const run = async (f: () => Promise<void>, msg: string) => {
    try {
      await f()
      toast(msg)
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  return push.state === 'on' ? (
    <>
      <Badge tone="acid">켜짐</Badge>
      <button type="button" className="btn btn-ghost btn-sm" disabled={push.busy} onClick={() => run(push.disable, '이 컴퓨터의 PC 알림을 껐습니다.')}>
        끄기
      </button>
    </>
  ) : (
    <Button size="sm" disabled={push.busy} onClick={() => run(push.enable, 'PC 알림을 켰습니다. 창을 닫아 둬도 채팅·알림이 옵니다.')}>
      켜기
    </Button>
  )
}
