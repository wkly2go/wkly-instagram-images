// 외부 협업방 — 외부인 화면 /c/<초대 링크> (로드맵 2단계 · 2026-11-17 · docs/EXTERNAL_COLLAB.md)
//  - 로그인 없음 · 인트라넷 메뉴 · 다른 화면 없음 · 휴대폰 우선 · 밝은 화면
//  - [대화 | 자료 | 일정] · 새 글은 화면을 보고 있는 동안 8초마다 확인 (화면을 내리면 멈춤)
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp, CalendarDays, Download, Eye, File as FileIcon, FileImage, FileSpreadsheet, FileText, Folder, Lock, MessageSquare, Paperclip, RefreshCw, X } from 'lucide-react'
import { forgetKey, GuestError, guestApi, INVITE_RE, inviteKnown, keysPersist, loadKeys, openInvite, rememberTitle, staffSignedIn, type GuestFile, type GuestKey, type GuestMe, type GuestPeople, type GuestRoomInfo } from '../lib/collabGuest'
import type { CollabEvent, CollabFileRef, CollabMessage } from '../lib/types'
import './GuestRoom.css'

const POLL = 8_000
const FULL_EVERY = 60_000
const LOST = ['bad', 'revoked', 'expired', 'closed']

// ── 표시 도우미 ─────────────────────────────────────────────────────────
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString()
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const dayLabel = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`
}
const shortDay = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  return { md: `${d.getUTCMonth() + 1}.${String(d.getUTCDate()).padStart(2, '0')}`, wd: WEEK[d.getUTCDay()] }
}
const dotDate = (ymd: string | null) => (ymd ? ymd.replace(/-/g, '.') : '')
const todayKst = () => kst(new Date().toISOString()).slice(0, 10)
const sizeLabel = (n: number | null) => (n == null ? '' : n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${Math.round(n / 1024)}KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)}MB`)
const canView = (mime: string | null) => !!mime && (mime.startsWith('image/') || mime === 'application/pdf' || mime === 'application/vnd.google-apps.document' || mime === 'application/vnd.google-apps.presentation')
const iconOf = (mime: string | null) => (mime?.startsWith('image/') ? FileImage : /sheet|excel|csv/.test(mime ?? '') ? FileSpreadsheet : /pdf|document|word|text|presentation/.test(mime ?? '') ? FileText : FileIcon)
const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g
function Linked({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  )
}

// ── 시작: 주소의 초대 링크는 읽자마자 지움 ───────────────────────────────
export function mountGuestRoom(el: HTMLElement) {
  const m = window.location.pathname.match(/^\/c\/([^/?#]+)\/?$/)
  const raw = m?.[1] ?? null
  const invite = raw && INVITE_RE.test(raw) ? raw : null
  const roomParam = new URLSearchParams(window.location.search).get('r')
  if (raw) window.history.replaceState(null, '', roomParam ? `/c?r=${encodeURIComponent(roomParam)}` : '/c')
  const meta = (name: string, content: string) => {
    const tag = document.createElement('meta')
    tag.name = name
    tag.content = content
    document.head.appendChild(tag)
  }
  meta('robots', 'noindex, nofollow')
  meta('referrer', 'no-referrer')
  document.querySelector('link[rel="manifest"]')?.remove()
  document.title = '협업방'
  document.documentElement.dataset.theme = 'light'
  createRoot(el).render(<GuestApp invite={invite} badLink={!!raw && !invite} roomParam={roomParam} />)
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'confirm'; invite: string }
  | { kind: 'error'; message: string; code: string }
  | { kind: 'pick'; keys: GuestKey[] }
  | { kind: 'room'; key: GuestKey }

function GuestApp({ invite, badLink, roomParam }: { invite: string | null; badLink: boolean; roomParam: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const enter = useCallback(async (inv: string) => {
    setPhase({ kind: 'loading' })
    try {
      const k = await openInvite(inv)
      window.history.replaceState(null, '', `/c?r=${k.room_id}`)
      setPhase({ kind: 'room', key: k })
    } catch (e) {
      const g = e instanceof GuestError ? e : new GuestError('잠시 뒤에 다시 시도해 주세요.', 'error', 0)
      setPhase({ kind: 'error', message: g.message, code: g.code })
    }
  }, [])
  useEffect(() => {
    void (async () => {
      if (badLink) return setPhase({ kind: 'error', code: 'bad', message: '초대 링크가 올바르지 않습니다. 받은 링크 전체를 눌러 열어 주세요.' })
      if (invite) {
        if (staffSignedIn() && !(await inviteKnown(invite))) return setPhase({ kind: 'confirm', invite })
        return enter(invite)
      }
      const keys = loadKeys()
      const hit = roomParam ? keys.find(k => k.room_id === roomParam) : null
      if (hit) return setPhase({ kind: 'room', key: hit })
      if (keys.length === 1) return setPhase({ kind: 'room', key: keys[0] })
      if (keys.length > 1) return setPhase({ kind: 'pick', keys })
      setPhase({ kind: 'error', code: 'nokey', message: '받은 초대 링크를 눌러 들어와 주세요. 이 기기에는 아직 들어온 협업방이 없습니다.' })
    })()
  }, [invite, badLink, roomParam, enter])

  if (phase.kind === 'room')
    return (
      <Room
        key={phase.key.room_id}
        k={phase.key}
        others={loadKeys().length > 1}
        onLost={e => {
          forgetKey(phase.key.room_id)
          setPhase({ kind: 'error', message: e.message, code: e.code })
        }}
        onSwitch={() => setPhase({ kind: 'pick', keys: loadKeys() })}
      />
    )
  return (
    <div className="gr gr-center">
      <div className="gr-card gr-gate">
        <div className="gr-gate-icon">
          <Lock size={20} />
        </div>
        {phase.kind === 'loading' && <p className="gr-muted">협업방을 여는 중…</p>}
        {phase.kind === 'confirm' && (
          <>
            <h1>팀원 계정으로 로그인된 기기입니다</h1>
            <p>이 초대 링크는 처음 연 기기에서만 열립니다. 여기서 열면 초대받은 분은 이 링크로 들어올 수 없게 됩니다.</p>
            <p className="gr-muted">링크를 확인만 하려면 닫고, 초대받은 분께 그대로 보내 주세요.</p>
            <div className="gr-row">
              <button type="button" className="gr-btn" onClick={() => setPhase({ kind: 'error', code: 'cancel', message: '열지 않았습니다. 링크는 그대로 쓸 수 있습니다.' })}>
                닫기
              </button>
              <button type="button" className="gr-btn gr-primary" onClick={() => void enter(phase.invite)}>
                이 기기에서 열기
              </button>
            </div>
          </>
        )}
        {phase.kind === 'error' && (
          <>
            <h1>{phase.code === 'cancel' ? '열지 않았습니다' : '협업방을 열 수 없습니다'}</h1>
            <p>{phase.message}</p>
            {phase.code === 'used' && <p className="gr-muted">초대 링크는 한 기기에서만 열립니다. 다른 휴대폰 · PC 에서 보시려면 담당자에게 새 링크를 요청해 주세요.</p>}
            {phase.code === 'network' && (
              <button type="button" className="gr-btn gr-primary" onClick={() => window.location.reload()}>
                <RefreshCw size={14} /> 다시 시도
              </button>
            )}
          </>
        )}
        {phase.kind === 'pick' && (
          <>
            <h1>협업방 고르기</h1>
            <div className="gr-pick">
              {phase.keys.map(k => (
                <button key={k.room_id} type="button" className="gr-pick-row" onClick={() => setPhase({ kind: 'room', key: k })}>
                  <MessageSquare size={16} />
                  <span>{k.title ?? '협업방'}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 방 ────────────────────────────────────────────────────────────────────
type Tab = 'chat' | 'files' | 'events'
interface State {
  me: GuestMe
  room: GuestRoomInfo
  people: GuestPeople
  events: CollabEvent[]
  messages: CollabMessage[]
}

function Room({ k, others, onLost, onSwitch }: { k: GuestKey; others: boolean; onLost: (e: GuestError) => void; onSwitch: () => void }) {
  const [s, setS] = useState<State | null>(null)
  const [tab, setTab] = useState<Tab>('chat')
  const [offline, setOffline] = useState(false)
  const last = useRef(0)
  const lastFull = useRef(0)
  const busy = useRef(false)
  const lostRef = useRef(onLost)
  lostRef.current = onLost

  const pull = useCallback(
    async (forceFull = false) => {
      if (busy.current) return
      busy.current = true
      try {
        const full = forceFull || !last.current || Date.now() - lastFull.current > FULL_EVERY
        const r = await guestApi.sync(k.key, last.current, full)
        if (full) lastFull.current = Date.now()
        setOffline(false)
        setS(prev => {
          const known = new Set(prev?.messages.map(m => m.id))
          const add = r.messages.filter(m => !known.has(m.id))
          const messages = prev ? [...prev.messages, ...add] : r.messages
          const top = messages.length ? messages[messages.length - 1].id : 0
          if (top > last.current) last.current = top
          const room = r.room ?? prev?.room
          if (!room) return prev
          return {
            me: { ...r.me, read_upto: Math.max(r.me.read_upto, prev?.me.read_upto ?? 0) },
            room,
            events: r.events ?? prev?.events ?? [],
            people: { u: { ...prev?.people.u, ...r.people.u }, g: { ...prev?.people.g, ...r.people.g } },
            messages,
          }
        })
        if (r.room) {
          rememberTitle(k.room_id, r.room.title)
          document.title = `${r.room.title} · 협업방`
        }
      } catch (e) {
        if (e instanceof GuestError && LOST.includes(e.code)) lostRef.current(e)
        else setOffline(true)
      } finally {
        busy.current = false
      }
    },
    [k],
  )

  useEffect(() => {
    void pull(true)
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pull()
    }, POLL)
    const vis = () => document.visibilityState === 'visible' && void pull()
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('online', vis)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('online', vis)
    }
  }, [pull])

  // 읽음 표시 (대화 칸을 보고 있을 때)
  const topId = s?.messages.length ? s.messages[s.messages.length - 1].id : 0
  useEffect(() => {
    if (!s || tab !== 'chat' || topId <= s.me.read_upto) return
    const t = window.setTimeout(() => {
      void guestApi.read(k.key, topId).catch(() => undefined)
      setS(p => (p ? { ...p, me: { ...p.me, read_upto: topId } } : p))
    }, 1200)
    return () => window.clearTimeout(t)
  }, [s, tab, topId, k.key])

  const addMine = (m: CollabMessage) =>
    setS(p => {
      if (!p || p.messages.some(x => x.id === m.id)) return p
      if (m.id > last.current) last.current = m.id
      return { ...p, me: { ...p.me, read_upto: Math.max(p.me.read_upto, m.id) }, messages: [...p.messages, m] }
    })

  if (!s)
    return (
      <div className="gr gr-center">
        <p className="gr-muted">{offline ? '인터넷 연결을 확인하고 있습니다…' : '협업방을 여는 중…'}</p>
      </div>
    )
  const unread = s.messages.filter(m => m.id > s.me.read_upto && m.guest_id !== s.me.id && !m.deleted_at).length
  const upcoming = s.events.filter(e => (e.end_day ?? e.day) >= todayKst()).length
  const period = s.room.project.start_date || s.room.project.end_date ? `${dotDate(s.room.project.start_date)} – ${dotDate(s.room.project.end_date)}` : ''
  return (
    <div className="gr gr-app">
      <header className="gr-head">
        <div className="gr-head-top">
          <span className="gr-brand">{s.room.company}</span>
          <span className="gr-private">
            <Lock size={11} /> 초대받은 분만 보는 방
          </span>
          {others && (
            <button type="button" className="gr-link" onClick={onSwitch}>
              다른 방
            </button>
          )}
        </div>
        <h1 className="gr-title">{s.room.title}</h1>
        <div className="gr-sub">
          {s.room.project.name}
          {period && <span> · {period}</span>}
        </div>
        <nav className="gr-tabs" role="tablist">
          <TabBtn on={tab === 'chat'} onClick={() => setTab('chat')} icon={<MessageSquare size={15} />} label="대화" badge={tab !== 'chat' && unread ? unread : 0} />
          <TabBtn on={tab === 'files'} onClick={() => setTab('files')} icon={<Folder size={15} />} label="자료" />
          <TabBtn on={tab === 'events'} onClick={() => setTab('events')} icon={<CalendarDays size={15} />} label="일정" count={upcoming} />
        </nav>
      </header>
      {offline && <div className="gr-banner">연결이 끊겼습니다 · 다시 연결하는 중…</div>}
      {!keysPersist && <div className="gr-banner warn">이 브라우저는 접속 정보를 저장하지 못합니다. 새로고침하면 다시 들어올 수 없으니 크롬 · 사파리에서 열어 주세요.</div>}
      {tab === 'chat' && <Chat k={k} s={s} onSent={addMine} />}
      {tab === 'files' && <Files k={k} s={s} onPosted={addMine} />}
      {tab === 'events' && <Events events={s.events} />}
    </div>
  )
}

function TabBtn({ on, onClick, icon, label, badge, count }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number; count?: number }) {
  return (
    <button type="button" role="tab" aria-selected={on} className={`gr-tab${on ? ' on' : ''}`} onClick={onClick}>
      {icon}
      {label}
      {!!badge && <span className="gr-badge">{badge > 99 ? '99+' : badge}</span>}
      {!badge && !!count && <span className="gr-count">{count}</span>}
    </button>
  )
}

// ── 대화 ──────────────────────────────────────────────────────────────────
function authorOf(m: CollabMessage, s: State): { name: string; org: string; mine: boolean } {
  if (m.guest_id) {
    const g = s.people.g[m.guest_id]
    return { name: g?.name ?? '외부인', org: g?.org ?? g?.role ?? '', mine: m.guest_id === s.me.id }
  }
  const u = m.user_id ? s.people.u[m.user_id] : null
  return { name: u ? `${u.name}${u.title ? ` ${u.title}` : ''}` : '담당자', org: u?.org ?? s.room.company, mine: false }
}

function Chat({ k, s, onSent }: { k: GuestKey; s: State; onSent: (m: CollabMessage) => void }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [pending, setPending] = useState<{ file: File; ratio: number; ref?: CollabFileRef; error?: string }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const stick = useRef(true)
  const count = s.messages.length

  useEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [count])

  const groups = useMemo(() => {
    const out: { day: string; items: CollabMessage[] }[] = []
    for (const m of s.messages) {
      const day = kst(m.created_at).slice(0, 10)
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] })
      out[out.length - 1].items.push(m)
    }
    return out
  }, [s.messages])

  const uploadAll = async (files: File[]) => {
    setErr(null)
    const start = pending.length
    setPending(p => [...p, ...files.map(file => ({ file, ratio: 0 }))])
    for (const [i, file] of files.entries()) {
      try {
        const ref = await guestApi.upload(k.key, file, ratio => setPending(p => p.map((x, j) => (j === start + i ? { ...x, ratio } : x))))
        setPending(p => p.map((x, j) => (j === start + i ? { ...x, ratio: 1, ref } : x)))
      } catch (e) {
        setPending(p => p.map((x, j) => (j === start + i ? { ...x, error: e instanceof Error ? e.message : '올리지 못했습니다.' } : x)))
      }
    }
  }
  const ready = pending.filter(p => p.ref)
  const uploading = pending.some(p => !p.ref && !p.error)
  const send = async () => {
    const body = text.trim()
    if ((!body && !ready.length) || sending || uploading) return
    setSending(true)
    setErr(null)
    try {
      const r = await guestApi.post(k.key, body, ready.map(p => p.ref!.id))
      stick.current = true
      onSent(r.message)
      setText('')
      setPending([])
    } catch (e) {
      setErr(e instanceof Error ? e.message : '보내지 못했습니다.')
    } finally {
      setSending(false)
    }
  }
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  return (
    <>
      <div
        className="gr-scroll gr-chat"
        ref={list}
        onScroll={e => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {s.room.intro && <div className="gr-intro">{s.room.intro}</div>}
        {!s.messages.length && (
          <div className="gr-empty">
            <MessageSquare size={22} />
            <p>
              {s.me.name}님, 반갑습니다.
              <br />
              {s.room.company} 담당자와 이야기 나누는 방입니다. 첫 메시지를 남겨 주세요.
            </p>
          </div>
        )}
        {groups.map(g => (
          <section key={g.day}>
            <div className="gr-day">{dayLabel(g.day)}</div>
            {g.items.map((m, i) => {
              const a = authorOf(m, s)
              const prev = g.items[i - 1]
              const same = prev && (prev.guest_id ?? prev.user_id) === (m.guest_id ?? m.user_id) && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60e3
              return (
                <div key={m.id} className={`gr-msg${a.mine ? ' mine' : ''}${same ? ' same' : ''}`}>
                  {!a.mine && !same && (
                    <div className="gr-who">
                      <b>{a.name}</b>
                      {a.org && <span>{a.org}</span>}
                    </div>
                  )}
                  <div className="gr-bubble-row">
                    <div className={`gr-bubble${m.deleted_at ? ' gone' : ''}`}>
                      {m.deleted_at ? '삭제된 메시지입니다.' : <Linked text={m.body} />}
                      {!m.deleted_at && m.files.length > 0 && (
                        <div className="gr-files">
                          {m.files.map(f => (
                            <FileChip key={f.id} k={k} f={f} />
                          ))}
                        </div>
                      )}
                    </div>
                    <time>{kst(m.created_at).slice(11, 16)}</time>
                  </div>
                </div>
              )
            })}
          </section>
        ))}
      </div>
      <div className="gr-compose">
        {err && <div className="gr-err">{err}</div>}
        {pending.length > 0 && (
          <div className="gr-pending">
            {pending.map((p, i) => (
              <span key={i} className={`gr-pend${p.error ? ' bad' : ''}`} title={p.error ?? ''}>
                <Paperclip size={12} />
                <span className="gr-ell">{p.file.name}</span>
                {p.error ? ' · 실패' : p.ref ? '' : ` · ${Math.round(p.ratio * 100)}%`}
                <button type="button" aria-label="빼기" onClick={() => setPending(x => x.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="gr-compose-row">
          {s.me.can_upload && s.room.files && (
            <>
              <button type="button" className="gr-icon" aria-label="파일 붙이기" onClick={() => pick.current?.click()}>
                <Paperclip size={18} />
              </button>
              <input
                ref={pick}
                type="file"
                multiple
                hidden
                onChange={e => {
                  const files = [...(e.target.files ?? [])]
                  e.target.value = ''
                  if (files.length) void uploadAll(files.slice(0, 10))
                }}
              />
            </>
          )}
          <textarea
            value={text}
            rows={1}
            maxLength={4000}
            placeholder="메시지를 입력하세요"
            onChange={e => {
              setText(e.target.value)
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = `${Math.min(t.scrollHeight, 132)}px`
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button type="button" className="gr-send" aria-label="보내기" disabled={sending || uploading || (!text.trim() && !ready.length)} onClick={() => void send()}>
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </>
  )
}

/** 파일 보기(새 창) · 받기 — 누를 때마다 5분짜리 받기 주소를 받아 엶 */
function useOpener(k: GuestKey, fileId: string) {
  const [busy, setBusy] = useState(false)
  const open = async (inline: boolean) => {
    if (busy) return
    setBusy(true)
    // 휴대폰 브라우저가 팝업을 막지 않게, 누른 순간 창을 먼저 연다
    const w = inline ? window.open('', '_blank') : null
    if (w) w.opener = null
    try {
      const url = await guestApi.ticket(k.key, fileId, inline)
      if (w) w.location.href = url
      else window.location.href = url
    } catch (e) {
      w?.close()
      window.alert(e instanceof Error ? e.message : '파일을 열지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, open }
}

function FileChip({ k, f }: { k: GuestKey; f: CollabFileRef }) {
  const Icon = iconOf(f.mime)
  const { open } = useOpener(k, f.id)
  return (
    <div className="gr-chip">
      <Icon size={16} />
      <span className="gr-ell">{f.name}</span>
      <span className="gr-chip-size">{sizeLabel(f.size)}</span>
      {canView(f.mime) && (
        <button type="button" aria-label="보기" onClick={() => void open(true)}>
          <Eye size={14} />
        </button>
      )}
      <button type="button" aria-label="받기" onClick={() => void open(false)}>
        <Download size={14} />
      </button>
    </div>
  )
}

// ── 자료 ──────────────────────────────────────────────────────────────────
function Files({ k, s, onPosted }: { k: GuestKey; s: State; onPosted: (m: CollabMessage) => void }) {
  const [list, setList] = useState<GuestFile[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [up, setUp] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => {
    setErr(null)
    try {
      setList((await guestApi.files(k.key)).files)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '자료를 불러오지 못했습니다.')
      setList([])
    }
  }, [k.key])
  useEffect(() => {
    if (s.room.files) void load()
    else setList([])
  }, [load, s.room.files])
  const upload = async (files: File[]) => {
    const refs: CollabFileRef[] = []
    try {
      for (const [i, f] of files.entries()) {
        setUp(`${i + 1}/${files.length} ${f.name}`)
        refs.push(await guestApi.upload(k.key, f, r => setUp(`${i + 1}/${files.length} ${f.name} · ${Math.round(r * 100)}%`)))
      }
      if (refs.length) onPosted((await guestApi.post(k.key, '', refs.map(r => r.id))).message)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '올리지 못했습니다.')
    } finally {
      setUp(null)
      void load()
    }
  }
  const who = (f: GuestFile) => (f.guest_id ? (s.people.g[f.guest_id]?.name ?? '외부인') : f.user_id ? (s.people.u[f.user_id]?.name ?? s.room.company) : s.room.company)
  const groups = useMemo(() => {
    const m = new Map<string, GuestFile[]>()
    for (const f of list ?? []) m.set(f.folder, [...(m.get(f.folder) ?? []), f])
    return [...m.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0], 'ko')))
  }, [list])
  return (
    <div className="gr-scroll gr-pad">
      <div className="gr-files-head">
        <span className="gr-muted">{list ? `자료 ${list.length}개` : '불러오는 중…'}</span>
        <button type="button" className="gr-btn" onClick={() => void load()} disabled={!s.room.files}>
          <RefreshCw size={13} /> 새로고침
        </button>
        {s.me.can_upload && s.room.files && (
          <>
            <button type="button" className="gr-btn gr-primary" disabled={!!up} onClick={() => pick.current?.click()}>
              <Paperclip size={13} /> 올리기
            </button>
            <input
              ref={pick}
              type="file"
              multiple
              hidden
              onChange={e => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                if (files.length) void upload(files.slice(0, 10))
              }}
            />
          </>
        )}
      </div>
      {up && <div className="gr-banner">올리는 중 {up}</div>}
      {err && <div className="gr-err">{err}</div>}
      {!s.room.files && <div className="gr-empty">이 방은 자료 공유를 쓰지 않습니다.</div>}
      {s.room.files && list && !list.length && !err && (
        <div className="gr-empty">
          <Folder size={22} />
          <p>아직 공유된 자료가 없습니다.</p>
        </div>
      )}
      {groups.map(([folder, files]) => (
        <section key={folder} className="gr-card gr-file-group">
          {folder && (
            <div className="gr-folder">
              <Folder size={14} /> {folder}
            </div>
          )}
          {files.map(f => {
            const Icon = iconOf(f.mime)
            return (
              <div key={f.id} className="gr-file">
                <Icon size={18} className="gr-file-icon" />
                <div className="gr-file-main">
                  <div className="gr-ell gr-file-name">{f.name}</div>
                  <div className="gr-muted gr-file-meta">
                    {[sizeLabel(f.size), f.modified ? dotDate(kst(f.modified).slice(0, 10)) : '', who(f)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <FileActions k={k} f={f} />
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
function FileActions({ k, f }: { k: GuestKey; f: GuestFile }) {
  const { busy, open } = useOpener(k, f.id)
  return (
    <div className="gr-file-actions">
      {canView(f.mime) && (
        <button type="button" className="gr-btn" onClick={() => void open(true)} disabled={busy} aria-label="보기">
          <Eye size={14} /> <span className="gr-btn-label">보기</span>
        </button>
      )}
      <button type="button" className="gr-btn" onClick={() => void open(false)} disabled={busy} aria-label="받기">
        <Download size={14} /> <span className="gr-btn-label">받기</span>
      </button>
    </div>
  )
}

// ── 일정 ──────────────────────────────────────────────────────────────────
function Events({ events }: { events: CollabEvent[] }) {
  const [past, setPast] = useState(false)
  const today = todayKst()
  const next = events.filter(e => (e.end_day ?? e.day) >= today)
  const done = events.filter(e => (e.end_day ?? e.day) < today).reverse()
  const row = (e: CollabEvent) => {
    const d = shortDay(e.day)
    return (
      <div key={e.id} className={`gr-event k-${e.kind}`}>
        <div className="gr-event-date">
          <b>{d.md}</b>
          <span>{d.wd}</span>
        </div>
        <div className="gr-event-main">
          <div className="gr-event-title">
            <span className="gr-kind">{e.kind}</span>
            {e.title}
          </div>
          <div className="gr-muted">
            {[e.end_day && e.end_day !== e.day ? `~ ${dotDate(e.end_day)}` : '', e.start_time ?? '', e.place ?? ''].filter(Boolean).join(' · ')}
          </div>
          {e.note && <div className="gr-event-note">{e.note}</div>}
        </div>
      </div>
    )
  }
  return (
    <div className="gr-scroll gr-pad">
      {!events.length && (
        <div className="gr-empty">
          <CalendarDays size={22} />
          <p>공유된 일정이 없습니다.</p>
        </div>
      )}
      {next.length > 0 && <section className="gr-card">{next.map(row)}</section>}
      {done.length > 0 && (
        <>
          <button type="button" className="gr-link gr-past" onClick={() => setPast(v => !v)}>
            지난 일정 {done.length}개 {past ? '접기 ▲' : '보기 ▼'}
          </button>
          {past && <section className="gr-card gr-past-list">{done.map(row)}</section>}
        </>
      )}
    </div>
  )
}
