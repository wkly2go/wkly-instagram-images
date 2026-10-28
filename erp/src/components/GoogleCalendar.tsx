import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useApp } from '../lib/app'
import { friendlyError } from '../lib/api'
import type { Task } from '../lib/types'
import { addDays } from '../lib/date'
import { Button, Modal } from './ui'
import { ask, askText } from './Ask'

const ADD_BY_URL = 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl'

/** 할 일 하나를 구글 캘린더에 바로 넣는 주소 (하루 종일 일정) */
export function googleEventLink(t: Pick<Task, 'title' | 'start_date' | 'due_date' | 'memo'>, extra?: string): string | null {
  const s = t.start_date ?? t.due_date
  const e = t.due_date ?? t.start_date
  if (!s || !e) return null
  const d = (k: string) => k.replace(/-/g, '')
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: t.title,
    dates: `${d(s)}/${d(addDays(e >= s ? e : s, 1))}`,
    details: [extra, t.memo, 'THE WKLY 사내 인트라넷'].filter(Boolean).join('\n'),
    ctz: 'Asia/Seoul',
  })
  return `https://calendar.google.com/calendar/render?${q}`
}

/** 구독 주소를 구글 캘린더에 한 번에 추가하는 링크 */
export const googleSubscribeLink = (feed: string) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.replace(/^https:/, 'webcal:'))}`

function FeedRow({ label, help, url }: { label: string; help: string; url: string }) {
  const { toast } = useApp()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast('주소를 복사했습니다. 구글 캘린더에 붙여 넣으세요.')
    } catch {
      (await askText('아래 주소를 복사하세요', url))
    }
  }
  return (
    <div className="gcal-feed">
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="t-bodyb grow">{label}</span>
        <a className="btn btn-primary btn-sm" href={googleSubscribeLink(url)} target="_blank" rel="noreferrer" title="구글 캘린더에 자동 등록 (한 번만)">
          구글 캘린더에 추가
        </a>
        <Button size="sm" kind="outline" onClick={copy}>
          주소 복사
        </Button>
        <a className="btn btn-outline btn-sm" href={url.replace(/^https:/, 'webcal:')} title="아이폰 · 맥 캘린더에 바로 추가">
          아이폰 캘린더
        </a>
      </div>
      <span className="t-cap">{help}</span>
      <input className="input gcal-url" readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label={`${label} 구독 주소`} />
    </div>
  )
}

/** 구글 캘린더 연동: 개인 구독 주소 발급 · 복사 · 안내 */
export function GoogleCalendarModal({ onClose }: { onClose: () => void }) {
  const { api, toast } = useApp()
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.calendarFeedUrl().then(setUrl, e => {
      toast(friendlyError(e))
      setUrl(null)
    })
  }, [api, toast])
  const reset = async () => {
    if (!(await ask('새 주소를 만들까요? 예전 주소로 연결한 캘린더는 더 이상 갱신되지 않습니다.'))) return
    setBusy(true)
    try {
      setUrl(await api.calendarFeedUrl(true))
      toast('새 주소를 만들었습니다. 구글 캘린더에 다시 추가해 주세요.')
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="구글 캘린더 연동" onClose={onClose}>
      {url === undefined ? (
        <div className="empty">주소를 만드는 중…</div>
      ) : url === null ? (
        <div className="empty">체험 모드에서는 쓸 수 없습니다. 실제 인트라넷에 로그인하면 내 구독 주소가 만들어집니다.</div>
      ) : (
        <div className="col gap-10">
          <p className="t-cap" style={{ margin: 0 }}>
            인트라넷의 모든 일정(할 일 · 프로젝트 기간 · 승인된 휴가 · 외근 · 재택)이 내 구글 캘린더에 자동으로 들어옵니다. 휴대폰 구글 캘린더 앱에도 같은 계정이면 그대로 보입니다. 금액 정보는 보내지 않습니다.
          </p>
          <FeedRow label="내 일정" help="나에게 배정된 할 일 + 프로젝트 기간 + 내 휴가 · 외근 · 재택" url={url} />
          <FeedRow label="팀 전체 일정" help="팀원 모두의 할 일 · 휴가 · 외근 · 재택 (이름 표시)" url={`${url}&scope=team`} />
          <ol className="guide-steps">
            <li><b>구글 캘린더에 추가</b>를 누르고 구글 화면에서 <b>추가</b>를 한 번 누르면 끝입니다. 이후 일정은 자동으로 들어옵니다.</li>
            <li>
              버튼이 안 되면 <b>주소 복사</b> 후 PC에서 <a href={ADD_BY_URL} target="_blank" rel="noreferrer">구글 캘린더 › 다른 캘린더 › URL로 추가 <ExternalLink size={11} /></a>를 열고 주소를 붙여 넣은 뒤 <b>캘린더 추가</b>를 누릅니다.
            </li>
            <li>휴대폰 구글 캘린더 앱 › 설정에서 새로 생긴 'WKLY 내 일정'을 켜면 폰에도 보입니다.</li>
            <li>아이폰 기본 캘린더는 <b>아이폰 캘린더</b> 버튼을 누르면 바로 구독됩니다.</li>
          </ol>
          <p className="t-cap" style={{ margin: 0 }}>
            구글이 몇 시간마다 주소를 다시 읽어 갱신합니다 (구글 쪽 주기라 바로 반영되지 않을 수 있음). 인트라넷에서 고친 일정이 기준이며, 구글 캘린더에서 고친 내용은 인트라넷으로 돌아오지 않습니다.
            이 주소는 비밀번호처럼 다루세요. 남에게 알려졌다면 새 주소를 만드세요.
          </p>
          <div className="row">
            <span className="grow" />
            <Button kind="ghost" size="sm" onClick={reset} disabled={busy}>
              새 주소 만들기
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
