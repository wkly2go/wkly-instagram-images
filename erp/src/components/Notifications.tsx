import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { relativeLabel } from '../lib/date'
import { normalizePath, useRouter } from '../lib/router'
import type { AppNotification } from '../lib/types'
import { Badge } from './ui'
import { PushToggle } from './PushSetup'
import { pushOn } from '../lib/push'
import { playAlert, setSoundLevel, soundLevel, type SoundLevel } from '../lib/sound'

const SEEN_KEY = 'wkly-erp-notified-max'

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}
function writeSeen(n: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(n))
  } catch {
    /* noop */
  }
}

const canNotify = () => typeof window !== 'undefined' && 'Notification' in window

/** 상단 종: 알림함 + PC 알림 + 알람 시각 확인 */
export function NotificationBell() {
  const { api, me, version, bump } = useApp()
  const { navigate } = useRouter()
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const [perm] = useState<NotificationPermission | 'unsupported'>(canNotify() ? Notification.permission : 'unsupported')
  const box = useRef<HTMLDivElement>(null)
  const { data: list } = useAsync<AppNotification[]>(() => api.listNotifications(40), [version, tick, me.id], [])
  const unread = list.filter(n => !n.read_at)

  // 1분마다 알림함 새로 고침 (알람 확인은 App 에서 한 번만 돌림)
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // 새 알림 → PC 알림 (처음 열 때는 기준점만 저장)
  useEffect(() => {
    if (!list.length) return
    const max = Math.max(...list.map(n => n.id))
    const seen = readSeen()
    // 새 알림 · 알람 → 크게 울림
    if (seen && list.some(x => x.id > seen && !x.read_at)) playAlert('notify')
    // PC 푸시가 켜져 있으면 서비스 워커가 띄우므로 여기서는 생략 (중복 방지)
    if (seen && perm === 'granted' && !pushOn()) {
      for (const n of list.filter(x => x.id > seen && !x.read_at).slice(0, 3)) {
        try {
          const pc = new Notification(`[${n.kind}] ${n.title}`, { body: n.body ?? undefined, tag: `wkly-${n.id}`, icon: '/icon-192.png' })
          pc.onclick = () => {
            window.focus()
            if (n.link) navigate(normalizePath(n.link))
            pc.close()
          }
        } catch {
          /* 일부 브라우저는 서비스 워커 알림만 허용 */
        }
      }
    }
    if (max > seen) writeSeen(max)
  }, [list, perm, navigate])

  // 바깥을 누르면 닫기
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = async (n: AppNotification) => {
    setOpen(false)
    if (!n.read_at) {
      await api.markNotificationsRead([n.id]).catch(() => undefined)
      bump()
    }
    if (n.link) navigate(normalizePath(n.link))
  }
  const readAll = async () => {
    await api.markNotificationsRead('all').catch(() => undefined)
    bump()
  }

  return (
    <div className={`bell${unread.length ? ' has-unread' : ''}`} ref={box}>
      <button type="button" className="quick-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`알림 ${unread.length}개`} title="알림">
        <Bell size={14} />
        {unread.length > 0 && <span className="count">{unread.length > 99 ? '99+' : unread.length}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="알림">
          <div className="head" style={{ background: 'var(--yellow)' }}>
            <span className="t-bodyb">알림</span>
            {unread.length > 0 && <Badge tone="red">{unread.length}</Badge>}
            <span className="grow" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={readAll} disabled={!unread.length}>
              모두 읽음
            </button>
          </div>
          {list.length === 0 && <div className="empty">알림이 없습니다.</div>}
          {list.map(n => (
            <button key={n.id} type="button" className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => go(n)}>
              <span className="t-meta nowrap notif-kind">{n.kind}</span>
              <span className="col gap-2 grow">
                <span className="t-smallb" style={{ whiteSpace: 'normal' }}>
                  {n.title}
                </span>
                {n.body && <span className="t-cap">{n.body}</span>}
              </span>
              <span className="t-meta" style={{ whiteSpace: 'nowrap' }}>
                {relativeLabel(n.created_at)}
              </span>
              <span className={`dot ${n.read_at ? 'read' : ''}`} aria-hidden="true" />
            </button>
          ))}
          <div className="head" style={{ position: 'sticky', bottom: 0, borderTop: '1px solid var(--line)', borderBottom: 0 }}>
            <span className="t-cap">PC 알림 (창을 닫아도)</span>
            <PushToggle />
            <span className="grow" />
            <span className="t-cap">매일 09:00 오늘 할 일 요약</span>
          </div>
          <SoundSetting />
        </div>
      )}
    </div>
  )
}

/** 알림음 크기: 크게 · 보통 · 끔 (+ 들어보기) */
function SoundSetting() {
  const [level, setLevel] = useState<SoundLevel>(soundLevel)
  const choose = (v: SoundLevel) => {
    setSoundLevel(v)
    setLevel(v)
    if (v !== 'off') playAlert('notify', true)
  }
  return (
    <div className="head" style={{ position: 'sticky', bottom: 0, borderBottom: 0, gap: 4 }}>
      <span className="t-cap">알림음</span>
      {(
        [
          ['loud', '크게'],
          ['normal', '보통'],
          ['off', '끔'],
        ] as const
      ).map(([v, label]) => (
        <button key={v} type="button" className={`btn btn-sm ${level === v ? 'btn-blue' : 'btn-ghost'}`} onClick={() => choose(v)} aria-pressed={level === v}>
          {label}
        </button>
      ))}
      <span className="grow" />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => playAlert('notify', true)}>
        🔊 들어보기
      </button>
    </div>
  )
}
