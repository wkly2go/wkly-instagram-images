// 외부 협업방 — 팀원 화면 (프로젝트 화면 › 외부 협업방 · 로드맵 2단계 · 2026-11-17 · docs/EXTERNAL_COLLAB.md)
//  - 방 만들기(발주처방 · 협력사방 따로) · 초대(링크는 한 번만 보임 · 팀원이 카톡 · 메일로 직접 보냄) · 새 링크 · 기기 끊기 · 해제
//  - 대화 · 자료(드라이브 01.협의자료/03.외부공유/<방>) · 공유 일정(미팅 · 마일스톤)
//  - 외부인이 쓴 글은 담당 · 참여 팀원에게 알림 (서버 함수가 보냄)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, CalendarDays, Download, ExternalLink, Eye, Folder, Link2, Lock, MessageSquare, MonitorSmartphone, Paperclip, PenLine, Pencil, Plus, Settings2, Trash2, UserPlus, X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { useRouter } from '../lib/router'
import { collabInviteUrl } from '../lib/collabApi'
import { putResumable } from '../lib/collabGuest'
import { relativeLabel } from '../lib/date'
import { COLLAB_EVENT_KINDS, COLLAB_ROLES, projectBrand, type CollabDriveFile, type CollabEvent, type CollabEventKind, type CollabFileRef, type CollabGuest, type CollabLink, type CollabMessage, type CollabRole, type CollabRoom, type Project } from '../lib/types'
import { ask } from './Ask'
import { Button, Field, Modal, SectionHead } from './ui'
import './CollabSection.css'

const COMPANY = { AR: '아트리어디자인스튜디오', TW: '더위클리컴퍼니', RS: '더위클리컴퍼니' } as const
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString()
const sizeLabel = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`)
const dot = (ymd: string | null) => (ymd ? ymd.replace(/-/g, '.') : '')
const todayKst = () => kst(new Date().toISOString()).slice(0, 10)
const guestState = (g: CollabGuest) =>
  g.revoked_at ? { label: '해제됨', tone: 'off' } : Date.parse(g.expires_at) < Date.now() ? { label: '기간 끝', tone: 'off' } : g.last_seen_at ? { label: `접속 ${relativeLabel(g.last_seen_at)}`, tone: 'on' } : { label: '아직 안 들어옴', tone: 'wait' }
async function copy(text: string, toast: (m: string) => void, ok: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(ok)
  } catch {
    toast('자동 복사가 막혀 있습니다. 글자를 길게 눌러 직접 복사해 주세요.')
  }
}

export function CollabSection({ project }: { project: Project }) {
  const { api, version } = useApp()
  const { query } = useRouter()
  const focus = query.get('collab')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const { data } = useAsync(() => api.listCollab(project.id), [project.id, tick, version], { rooms: [] as CollabRoom[], guests: [] as CollabGuest[], events: [] as CollabEvent[] })
  const [picked, setPicked] = useState<string | null>(focus)
  const [creating, setCreating] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const rooms = useMemo(() => [...data.rooms].sort((a, b) => Number(!!a.closed_at) - Number(!!b.closed_at)), [data.rooms])
  const room = rooms.find(r => r.id === picked) ?? rooms[0] ?? null
  useEffect(() => {
    if (focus) setPicked(focus)
  }, [focus])
  useEffect(() => {
    if (focus && room?.id === focus) box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus, room?.id])
  const live = data.guests.filter(g => !g.revoked_at && Date.parse(g.expires_at) > Date.now())

  return (
    <div className="cl" ref={box} id="collab">
      <SectionHead
        title="외부 협업방"
        count={live.length ? `${live.length}명` : undefined}
        right={
          <span className="row gap-6">
            <span className="t-cap hide-phone">거래처 · 협력사가 로그인 없이 링크로 이 방 하나만 봅니다</span>
            <Button kind="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus size={13} /> 방
            </Button>
          </span>
        }
      />
      {!rooms.length ? (
        <div className="cl-empty">
          <Lock size={16} />
          <div>
            <b>발주처 · 협력사와 함께 쓰는 방</b>
            <p>대화 · 자료(드라이브 01.협의자료/03.외부공유) · 공유 일정을 이 프로젝트 안에서 나눕니다. 초대받은 사람은 그 방 하나만 볼 수 있고, 링크는 처음 연 기기에서만 열립니다.</p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            방 만들기
          </Button>
        </div>
      ) : (
        <>
          {rooms.length > 1 && (
            <div className="cl-rooms" role="tablist" aria-label="협업방">
              {rooms.map(r => (
                <button key={r.id} type="button" role="tab" aria-selected={r.id === room?.id} className={`cl-room-tab${r.id === room?.id ? ' on' : ''}${r.closed_at ? ' closed' : ''}`} onClick={() => setPicked(r.id)}>
                  {r.title}
                  {r.closed_at && <span> · 닫힘</span>}
                </button>
              ))}
            </div>
          )}
          {room && <RoomPanel key={room.id} room={room} project={project} guests={data.guests.filter(g => g.room_id === room.id)} events={data.events.filter(e => e.room_id === room.id)} onChange={reload} />}
        </>
      )}
      {creating && (
        <CreateRoom
          project={project}
          first={!rooms.length}
          onClose={() => setCreating(false)}
          onDone={id => {
            setCreating(false)
            setPicked(id)
            reload()
          }}
        />
      )}
    </div>
  )
}

function CreateRoom({ project, first, onClose, onDone }: { project: Project; first: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const { api, toast } = useApp()
  const [title, setTitle] = useState(first ? `${project.name} 협업방` : '')
  const [intro, setIntro] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!title.trim()) return toast('방 이름을 적어 주세요.')
    setBusy(true)
    try {
      const r = await api.createCollabRoom(project.id, title.trim(), intro.trim() || undefined)
      if (r.folder_error) toast(`방을 만들었습니다. 드라이브 폴더는 만들지 못했습니다: ${r.folder_error}`)
      else toast(r.room.drive_folder_id ? '방을 만들었습니다. 드라이브 01.협의자료/03.외부공유 에 방 폴더를 만들었습니다.' : '방을 만들었습니다. (프로젝트 드라이브 폴더가 없어 자료 공유는 꺼져 있습니다)')
      onDone(r.room.id)
    } catch (e) {
      toast(e instanceof Error ? e.message : '방을 만들지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="외부 협업방 만들기"
      onClose={onClose}
      actions={
        <>
          <Button kind="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? '만드는 중…' : '만들기'}
          </Button>
        </>
      }
    >
      <p className="t-small cl-note">한 방 = 같은 내용을 봐도 되는 사람들. 발주처와 협력사는 방을 나눠 주세요 (단가 · 공정 이야기가 서로 보이지 않게).</p>
      <Field label="방 이름 (외부인에게 보임)">
        <input className="input" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder="예: 로제코커피 발주처방 / 시공 협력사방" autoFocus />
      </Field>
      <Field label="첫 화면 안내 (선택 · 외부인에게 보임)">
        <textarea className="textarea" rows={3} maxLength={1000} value={intro} onChange={e => setIntro(e.target.value)} placeholder="예: 공사 기간 중 문의 · 자료는 이 방에 남겨 주세요. 담당: 박서연 (평일 9–18시)" />
      </Field>
    </Modal>
  )
}

type Tab = 'chat' | 'files' | 'events' | 'boards'
function RoomPanel({ room, project, guests, events, onChange }: { room: CollabRoom; project: Project; guests: CollabGuest[]; events: CollabEvent[]; onChange: () => void }) {
  const { api, toast } = useApp()
  const [tab, setTab] = useState<Tab>('chat')
  const [inviting, setInviting] = useState(false)
  const [link, setLink] = useState<{ guest: CollabGuest; token: string } | null>(null)
  const [editing, setEditing] = useState<CollabGuest | null>(null)
  const [devices, setDevices] = useState<CollabGuest | null>(null)
  const [settings, setSettings] = useState(false)
  const shown = guests.filter(g => !g.revoked_at).concat(guests.filter(g => g.revoked_at))
  const upcoming = events.filter(e => (e.end_day ?? e.day) >= todayKst()).length
  const relink = async (g: CollabGuest) => {
    try {
      const token = await api.relinkCollabGuest(g.id)
      setLink({ guest: g, token })
    } catch (e) {
      toast(e instanceof Error ? e.message : '링크를 만들지 못했습니다.')
    }
  }
  return (
    <div className={`cl-panel${room.closed_at ? ' closed' : ''}`}>
      <div className="cl-head">
        <div className="cl-head-main">
          <b className="cl-title">{room.title}</b>
          <span className="t-cap">
            {room.closed_at ? '닫힘 — 외부인 접속 막힘' : '열림'}
            {room.drive_folder_id ? (
              <>
                {' · '}
                <a href={`https://drive.google.com/drive/folders/${room.drive_folder_id}`} target="_blank" rel="noopener noreferrer">
                  드라이브 방 폴더 <ExternalLink size={11} />
                </a>
              </>
            ) : (
              ' · 자료 공유 꺼짐(드라이브 폴더 없음)'
            )}
          </span>
        </div>
        {!room.closed_at && (
          <Button size="sm" onClick={() => setInviting(true)}>
            <UserPlus size={13} /> 초대
          </Button>
        )}
        <Button kind="outline" size="sm" onClick={() => setSettings(true)} aria-label="방 설정">
          <Settings2 size={13} />
        </Button>
      </div>
      <div className="cl-guests">
        {!shown.length && <span className="t-cap">아직 초대한 사람이 없습니다. [초대]로 링크를 만들어 카카오톡 · 메일로 보내 주세요.</span>}
        {shown.map(g => {
          const st = guestState(g)
          return (
            <div key={g.id} className={`cl-guest ${st.tone}`}>
              <span className="cl-guest-name">
                <b>{g.name}</b>
                {g.org && <span>{g.org}</span>}
                <span className="cl-role">{g.role}</span>
              </span>
              <span className={`cl-state ${st.tone}`}>{st.label}</span>
              {!g.revoked_at && (
                <button type="button" className="cl-mini" onClick={() => void relink(g)} title="새 초대 링크 (다른 기기 · 링크를 잃어버렸을 때)">
                  <Link2 size={12} /> 새 링크
                </button>
              )}
              <button type="button" className="cl-mini" onClick={() => setDevices(g)} title="들어온 기기 · 끊기">
                <MonitorSmartphone size={12} /> 기기
              </button>
              <button type="button" className="cl-mini" onClick={() => setEditing(g)} title="이름 · 기간 · 올리기 허용 · 해제">
                <Pencil size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <nav className="cl-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
          <MessageSquare size={14} /> 대화
        </button>
        <button type="button" role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
          <Folder size={14} /> 자료
        </button>
        <button type="button" role="tab" aria-selected={tab === 'events'} className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>
          <CalendarDays size={14} /> 공유 일정{upcoming ? <span className="cl-n">{upcoming}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'boards'} className={tab === 'boards' ? 'on' : ''} onClick={() => setTab('boards')}>
          <PenLine size={14} /> 화이트보드
        </button>
      </nav>
      {tab === 'chat' && <StaffChat room={room} guests={guests} />}
      {tab === 'files' && <StaffFiles room={room} guests={guests} onFolder={onChange} />}
      {tab === 'events' && <StaffEvents room={room} events={events} onChange={onChange} />}
      {tab === 'boards' && <StaffBoards room={room} project={project} />}
      {inviting && (
        <InviteModal
          room={room}
          onClose={() => setInviting(false)}
          onDone={r => {
            setInviting(false)
            setLink(r)
            onChange()
          }}
        />
      )}
      {link && <LinkModal project={project} room={room} guest={link.guest} token={link.token} onClose={() => setLink(null)} />}
      {editing && <GuestModal guest={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); onChange() }} />}
      {devices && <DevicesModal room={room} guest={devices} onClose={() => setDevices(null)} />}
      {settings && <RoomSettings room={room} onClose={() => setSettings(false)} onDone={() => { setSettings(false); onChange() }} />}
    </div>
  )
}

// ── 화이트보드 공유 (2026-11-27 대표 지시 '외부 협업가능하게 만들어') ─────────
// 이 프로젝트의 화이트보드 가운데 이 방 외부인에게 보일 것을 고름. 고칠 수 있음 / 보기만. 공유를 끄면 외부인 화면에서 바로 사라짐.
function StaffBoards({ room, project }: { room: CollabRoom; project: Project }) {
  const { api, toast } = useApp()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const data = useAsync(async () => {
    const [boards, shares] = await Promise.all([api.listBoards(project.id), api.listCollabBoards(room.id)])
    return { boards, shares }
  }, [api, project.id, room.id, tick], { boards: [], shares: [] })
  const set = async (boardId: string, share: boolean, canEdit: boolean) => {
    setBusy(boardId)
    try {
      await api.setCollabBoard(room.id, boardId, share, canEdit)
      setTick(t => t + 1)
      toast(share ? (canEdit ? '외부인이 이 보드를 함께 고칠 수 있습니다.' : '외부인이 이 보드를 볼 수 있습니다 (보기만).') : '이 보드 공유를 껐습니다.')
    } catch (e) {
      toast(e instanceof Error ? e.message : '바꾸지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }
  const { boards, shares } = data.data
  return (
    <div className="cl-boards">
      <p className="t-cap">이 방 외부인에게 보일 화이트보드를 고릅니다. 공유한 보드만 외부인 화면 ‘화이트보드’ 탭에 보이고, 고친 내용은 서로 자동으로 합쳐집니다.</p>
      {data.loading && !boards.length ? (
        <p className="t-cap">불러오는 중입니다.</p>
      ) : !boards.length ? (
        <p className="t-cap">이 프로젝트에 화이트보드가 없습니다. 아래 ‘화이트보드’ 칸에서 보드를 먼저 만들어 주세요.</p>
      ) : (
        <ul className="cl-board-list">
          {boards.map(b => {
            const sh = shares.find(x => x.board_id === b.id)
            return (
              <li key={b.id} className={sh ? 'on' : ''}>
                <label className="cl-board-pick">
                  <input type="checkbox" checked={!!sh} disabled={busy === b.id || !!room.closed_at} onChange={e => void set(b.id, e.target.checked, sh?.can_edit ?? true)} />
                  <b>{b.title}</b>
                  <span className="t-cap">요소 {b.count ?? 0}개</span>
                </label>
                {sh && (
                  <select className="input cl-board-mode" value={sh.can_edit ? 'edit' : 'view'} disabled={busy === b.id} onChange={e => void set(b.id, true, e.target.value === 'edit')} aria-label={`${b.title} 외부인 권한`}>
                    <option value="edit">함께 고칠 수 있음</option>
                    <option value="view">보기만</option>
                  </select>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── 대화 ──────────────────────────────────────────────────────────────────
function StaffChat({ room, guests }: { room: CollabRoom; guests: CollabGuest[] }) {
  const { api, me, profileName, toast } = useApp()
  const [msgs, setMsgs] = useState<CollabMessage[]>([])
  const [text, setText] = useState('')
  const [files, setFiles] = useState<{ file: File; ratio: number; ref?: CollabFileRef; error?: string }[]>([])
  const [sending, setSending] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const byGuest = useMemo(() => new Map(guests.map(g => [g.id, g])), [guests])
  const load = useCallback(async () => {
    try {
      setMsgs(await api.listCollabMessages(room.id))
    } catch {
      /* 다음 변경 때 다시 */
    }
  }, [api, room.id])
  useEffect(() => {
    void load()
    return api.subscribeChanges(['collab_messages'], () => void load(), `room_id=eq.${room.id}`)
  }, [api, load, room.id])
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length])

  const upload = async (picked: File[]) => {
    const base = files.length
    setFiles(f => [...f, ...picked.map(file => ({ file, ratio: 0 }))])
    for (const [i, file] of picked.entries()) {
      const at = (patch: Partial<{ ratio: number; ref: CollabFileRef; error: string }>) => setFiles(f => f.map((x, j) => (j === base + i ? { ...x, ...patch } : x)))
      try {
        const url = await api.collabUploadStart(room.id, { name: file.name, mime: file.type || 'application/octet-stream', size: file.size })
        const id = await putResumable(url, file, ratio => at({ ratio }))
        at({ ratio: 1, ref: await api.collabUploaded(room.id, id) })
      } catch (e) {
        at({ error: e instanceof Error ? e.message : '올리지 못했습니다.' })
      }
    }
  }
  const ready = files.filter(f => f.ref).map(f => f.ref!)
  const uploading = files.some(f => !f.ref && !f.error)
  const send = async () => {
    if ((!text.trim() && !ready.length) || sending || uploading) return
    setSending(true)
    try {
      const m = await api.postCollabMessage(room.id, text, ready)
      setMsgs(x => (x.some(y => y.id === m.id) ? x : [...x, m]))
      setText('')
      setFiles([])
    } catch (e) {
      toast(e instanceof Error ? e.message : '보내지 못했습니다.')
    } finally {
      setSending(false)
    }
  }
  const hide = async (m: CollabMessage) => {
    if (!(await ask('이 메시지를 지울까요? 외부인 화면에서도 "삭제된 메시지"로 바뀝니다.'))) return
    try {
      await api.hideCollabMessage(m.id)
      void load()
    } catch (e) {
      toast(e instanceof Error ? e.message : '지우지 못했습니다.')
    }
  }
  const open = async (f: CollabFileRef, inline: boolean) => {
    const w = inline ? window.open('', '_blank') : null
    if (w) w.opener = null
    try {
      const url = await api.collabFileUrl(room.id, f.id, inline)
      if (w) w.location.href = url
      else window.location.href = url
    } catch (e) {
      w?.close()
      toast(e instanceof Error ? e.message : '파일을 열지 못했습니다.')
    }
  }
  let lastDay = ''
  return (
    <div className="cl-chat">
      <div className="cl-msgs" ref={list}>
        {!msgs.length && <div className="cl-quiet">아직 대화가 없습니다. 여기 쓴 글은 초대받은 외부인에게 보입니다 — 내부 이야기 · 금액은 적지 마세요.</div>}
        {msgs.map(m => {
          const day = kst(m.created_at).slice(0, 10)
          const sep = day !== lastDay
          lastDay = day
          const g = m.guest_id ? byGuest.get(m.guest_id) : null
          const mine = m.user_id === me.id
          return (
            <div key={m.id}>
              {sep && <div className="cl-day">{dot(day)}</div>}
              <div className={`cl-msg${m.guest_id ? ' guest' : ''}${mine ? ' mine' : ''}`}>
                <div className="cl-who">
                  <b>{g ? g.name : profileName(m.user_id)}</b>
                  {g ? <span className="cl-ext">외부 · {g.org ?? g.role}</span> : null}
                  <time>{kst(m.created_at).slice(11, 16)}</time>
                  {mine && !m.deleted_at && (
                    <button type="button" className="cl-x" aria-label="지우기" onClick={() => void hide(m)}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className={`cl-body${m.deleted_at ? ' gone' : ''}`}>{m.deleted_at ? '삭제된 메시지' : m.body}</div>
                {!m.deleted_at && m.files.length > 0 && (
                  <div className="cl-files">
                    {m.files.map(f => (
                      <span key={f.id} className="cl-file">
                        <Paperclip size={12} />
                        <span className="cl-ell">{f.name}</span>
                        <span className="t-cap">{sizeLabel(f.size)}</span>
                        <button type="button" onClick={() => void open(f, true)} aria-label="보기">
                          <Eye size={12} />
                        </button>
                        <button type="button" onClick={() => void open(f, false)} aria-label="받기">
                          <Download size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {room.closed_at ? (
        <div className="cl-quiet">닫힌 방입니다. 방 설정에서 다시 열 수 있습니다.</div>
      ) : (
        <div className="cl-compose">
          {files.length > 0 && (
            <div className="cl-pending">
              {files.map((f, i) => (
                <span key={i} className={`cl-pend${f.error ? ' bad' : ''}`} title={f.error ?? ''}>
                  {f.file.name}
                  {f.error ? ' · 실패' : f.ref ? '' : ` · ${Math.round(f.ratio * 100)}%`}
                  <button type="button" aria-label="빼기" onClick={() => setFiles(x => x.filter((_, j) => j !== i))}>
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="cl-compose-row">
            {room.drive_folder_id && (
              <>
                <button type="button" className="cl-icon" aria-label="파일 붙이기" onClick={() => pick.current?.click()}>
                  <Paperclip size={14} />
                </button>
                <input
                  ref={pick}
                  type="file"
                  multiple
                  hidden
                  onChange={e => {
                    const picked = [...(e.target.files ?? [])]
                    e.target.value = ''
                    if (picked.length) void upload(picked.slice(0, 10))
                  }}
                />
              </>
            )}
            <textarea
              className="textarea"
              rows={1}
              value={text}
              maxLength={4000}
              placeholder="외부인에게 보이는 메시지 (Enter 보내기 · Shift+Enter 줄바꿈)"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <button type="button" className="cl-send" aria-label="보내기" disabled={sending || uploading || (!text.trim() && !ready.length)} onClick={() => void send()}>
              <ArrowUp size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 자료 ──────────────────────────────────────────────────────────────────
function StaffFiles({ room, guests, onFolder }: { room: CollabRoom; guests: CollabGuest[]; onFolder: () => void }) {
  const { api, profileName, toast } = useApp()
  const [list, setList] = useState<CollabDriveFile[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => {
    if (!room.drive_folder_id) return setList([])
    try {
      setList((await api.listCollabFiles(room.id)).files)
    } catch (e) {
      toast(e instanceof Error ? e.message : '자료를 불러오지 못했습니다.')
      setList([])
    }
  }, [api, room.id, room.drive_folder_id, toast])
  useEffect(() => {
    void load()
  }, [load])
  const byGuest = new Map(guests.map(g => [g.id, g]))
  const upload = async (picked: File[]) => {
    const refs: CollabFileRef[] = []
    try {
      for (const [i, f] of picked.entries()) {
        setBusy(`${i + 1}/${picked.length} ${f.name}`)
        const url = await api.collabUploadStart(room.id, { name: f.name, mime: f.type || 'application/octet-stream', size: f.size })
        const id = await putResumable(url, f, r => setBusy(`${i + 1}/${picked.length} ${f.name} · ${Math.round(r * 100)}%`))
        refs.push(await api.collabUploaded(room.id, id))
      }
      if (refs.length && (await ask(`대화에도 "파일 ${refs.length}개 올림"으로 알릴까요? (외부인 화면 대화에 보임)`))) await api.postCollabMessage(room.id, '', refs)
    } catch (e) {
      toast(e instanceof Error ? e.message : '올리지 못했습니다.')
    } finally {
      setBusy(null)
      void load()
    }
  }
  const open = async (f: CollabDriveFile, inline: boolean) => {
    const w = inline ? window.open('', '_blank') : null
    if (w) w.opener = null
    try {
      const url = await api.collabFileUrl(room.id, f.id, inline)
      if (w) w.location.href = url
      else window.location.href = url
    } catch (e) {
      w?.close()
      toast(e instanceof Error ? e.message : '파일을 열지 못했습니다.')
    }
  }
  const makeFolder = async () => {
    try {
      const id = await api.ensureCollabFolder(room.id)
      toast(id ? '드라이브 방 폴더를 만들었습니다.' : '프로젝트에 드라이브 폴더가 연결돼 있지 않습니다. 프로젝트 정보에서 드라이브 주소를 먼저 넣어 주세요.')
      onFolder()
    } catch (e) {
      toast(e instanceof Error ? e.message : '폴더를 만들지 못했습니다.')
    }
  }
  if (!room.drive_folder_id)
    return (
      <div className="cl-quiet">
        자료 공유를 쓰려면 방 폴더가 필요합니다 (프로젝트 드라이브 › 01.협의자료 › 03.외부공유 › {room.title}).{' '}
        <Button kind="outline" size="sm" onClick={() => void makeFolder()}>
          폴더 만들기
        </Button>
      </div>
    )
  return (
    <div className="cl-filebox">
      <div className="row gap-6 cl-file-tools">
        <span className="t-cap grow">{list ? `${list.length}개 · 드라이브 방 폴더에 직접 넣은 파일도 외부인에게 보입니다` : '불러오는 중…'}</span>
        <Button kind="outline" size="sm" onClick={() => void load()}>
          새로고침
        </Button>
        {!room.closed_at && (
          <>
            <Button size="sm" disabled={!!busy} onClick={() => pick.current?.click()}>
              <Paperclip size={13} /> 올리기
            </Button>
            <input
              ref={pick}
              type="file"
              multiple
              hidden
              onChange={e => {
                const picked = [...(e.target.files ?? [])]
                e.target.value = ''
                if (picked.length) void upload(picked.slice(0, 10))
              }}
            />
          </>
        )}
      </div>
      {busy && <div className="t-cap cl-busy">올리는 중 {busy}</div>}
      {list?.length === 0 && <div className="cl-quiet">아직 자료가 없습니다.</div>}
      {list?.map(f => (
        <div key={f.id} className="cl-file-row">
          <Folder size={14} className="cl-file-ico" />
          <div className="grow cl-min">
            <div className="cl-ell t-smallb">{f.name}</div>
            <div className="t-cap">
              {[f.folder ? `${f.folder} 폴더` : '', sizeLabel(f.size), f.modified ? dot(kst(f.modified).slice(0, 10)) : '', f.guest_id ? `외부 · ${byGuest.get(f.guest_id)?.name ?? '외부인'}` : f.user_id ? profileName(f.user_id) : '드라이브'].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button type="button" className="cl-mini" onClick={() => void open(f, true)}>
            <Eye size={12} /> 보기
          </button>
          <button type="button" className="cl-mini" onClick={() => void open(f, false)}>
            <Download size={12} /> 받기
          </button>
        </div>
      ))}
    </div>
  )
}

// ── 공유 일정 ─────────────────────────────────────────────────────────────
function StaffEvents({ room, events, onChange }: { room: CollabRoom; events: CollabEvent[]; onChange: () => void }) {
  const { api, toast } = useApp()
  const [edit, setEdit] = useState<Partial<CollabEvent> | null>(null)
  const today = todayKst()
  const del = async (e: CollabEvent) => {
    if (!(await ask(`'${e.title}' 일정을 지울까요? 외부인 화면에서도 사라집니다.`))) return
    try {
      await api.deleteCollabEvent(e.id)
      onChange()
    } catch (err) {
      toast(err instanceof Error ? err.message : '지우지 못했습니다.')
    }
  }
  return (
    <div className="cl-events">
      <div className="row gap-6">
        <span className="t-cap grow">외부인에게 보이는 일정만 따로 적습니다 (내부 할 일 · 담당자는 보이지 않음)</span>
        <Button size="sm" onClick={() => setEdit({ kind: '미팅', day: today })}>
          <Plus size={13} /> 일정
        </Button>
      </div>
      {!events.length && <div className="cl-quiet">공유 일정이 없습니다. 착공 · 미팅 · 준공 같은 마일스톤을 넣어 두면 외부인 화면 '일정'에 보입니다.</div>}
      {events.map(e => (
        <div key={e.id} className={`cl-event${(e.end_day ?? e.day) < today ? ' past' : ''}`}>
          <span className="cl-event-day">{dot(e.day).slice(5)}</span>
          <span className={`cl-kind k-${e.kind}`}>{e.kind}</span>
          <span className="grow cl-min">
            <b>{e.title}</b>
            <span className="t-cap"> {[e.end_day && e.end_day !== e.day ? `~ ${dot(e.end_day).slice(5)}` : '', e.start_time ?? '', e.place ?? ''].filter(Boolean).join(' · ')}</span>
            {e.note && <div className="t-cap">{e.note}</div>}
          </span>
          <button type="button" className="cl-mini" onClick={() => setEdit(e)} aria-label="고치기">
            <Pencil size={12} />
          </button>
          <button type="button" className="cl-mini" onClick={() => void del(e)} aria-label="지우기">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {edit && <EventModal room={room} value={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onChange() }} />}
    </div>
  )
}

function EventModal({ room, value, onClose, onDone }: { room: CollabRoom; value: Partial<CollabEvent>; onClose: () => void; onDone: () => void }) {
  const { api, toast } = useApp()
  const [v, setV] = useState({ kind: (value.kind ?? '미팅') as CollabEventKind, title: value.title ?? '', day: value.day ?? todayKst(), end_day: value.end_day ?? '', start_time: value.start_time ?? '', place: value.place ?? '', note: value.note ?? '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!v.title.trim() || !v.day) return toast('제목과 날짜를 적어 주세요.')
    if (v.end_day && v.end_day < v.day) return toast('끝 날짜가 시작 날짜보다 앞입니다.')
    setBusy(true)
    try {
      await api.saveCollabEvent({ ...(value.id ? { id: value.id } : {}), room_id: room.id, kind: v.kind, title: v.title, day: v.day, end_day: v.end_day || null, start_time: v.start_time || null, place: v.place || null, note: v.note || null })
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={value.id ? '공유 일정 고치기' : '공유 일정 넣기'}
      onClose={onClose}
      actions={
        <>
          <Button kind="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            저장
          </Button>
        </>
      }
    >
      <div className="row gap-6 wrap">
        {COLLAB_EVENT_KINDS.map(k => (
          <button key={k} type="button" className={`chip ${v.kind === k ? 'active' : ''}`} onClick={() => setV({ ...v, kind: k })}>
            {k}
          </button>
        ))}
      </div>
      <Field label="제목 (외부인에게 보임)">
        <input className="input" value={v.title} maxLength={80} onChange={e => setV({ ...v, title: e.target.value })} placeholder="예: 현장 실측 · 디자인 1차 보고 · 착공 · 준공" autoFocus />
      </Field>
      <div className="row gap-8 wrap">
        <Field label="날짜">
          <input className="input" type="date" value={v.day} onChange={e => setV({ ...v, day: e.target.value })} />
        </Field>
        <Field label="끝 날짜 (기간이면)">
          <input className="input" type="date" value={v.end_day} min={v.day} onChange={e => setV({ ...v, end_day: e.target.value })} />
        </Field>
        <Field label="시각">
          <input className="input" type="time" value={v.start_time} onChange={e => setV({ ...v, start_time: e.target.value })} />
        </Field>
      </div>
      <Field label="장소">
        <input className="input" value={v.place} maxLength={120} onChange={e => setV({ ...v, place: e.target.value })} placeholder="예: 현장 · 사무실 · 화상" />
      </Field>
      <Field label="메모 (외부인에게 보임)">
        <textarea className="textarea" rows={2} maxLength={1000} value={v.note} onChange={e => setV({ ...v, note: e.target.value })} />
      </Field>
    </Modal>
  )
}

// ── 초대 · 링크 · 외부인 · 기기 · 방 설정 ────────────────────────────────
function InviteModal({ room, onClose, onDone }: { room: CollabRoom; onClose: () => void; onDone: (r: { guest: CollabGuest; token: string }) => void }) {
  const { api, toast } = useApp()
  const [v, setV] = useState({ name: '', org: '', role: '발주처' as CollabRole, days: 60, can_upload: true })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!v.name.trim()) return toast('이름을 적어 주세요.')
    setBusy(true)
    try {
      onDone(await api.inviteCollabGuest(room.id, { ...v, name: v.name.trim(), org: v.org.trim() || undefined }))
    } catch (e) {
      toast(e instanceof Error ? e.message : '초대하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`초대 — ${room.title}`}
      onClose={onClose}
      actions={
        <>
          <Button kind="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? '만드는 중…' : '초대 링크 만들기'}
          </Button>
        </>
      }
    >
      <div className="row gap-8 wrap">
        <Field label="이름 (방에 보이는 이름)">
          <input className="input" value={v.name} maxLength={40} onChange={e => setV({ ...v, name: e.target.value })} placeholder="예: 김민지 과장" autoFocus />
        </Field>
        <Field label="회사 (선택)">
          <input className="input" value={v.org} maxLength={60} onChange={e => setV({ ...v, org: e.target.value })} placeholder="예: 로제코커피" />
        </Field>
      </div>
      <div className="row gap-6 wrap cl-pick">
        <span className="t-cap">역할</span>
        {COLLAB_ROLES.map(r => (
          <button key={r} type="button" className={`chip ${v.role === r ? 'active' : ''}`} onClick={() => setV({ ...v, role: r })}>
            {r}
          </button>
        ))}
      </div>
      <div className="row gap-6 wrap cl-pick">
        <span className="t-cap">접속 기간</span>
        {[30, 60, 90, 180].map(d => (
          <button key={d} type="button" className={`chip ${v.days === d ? 'active' : ''}`} onClick={() => setV({ ...v, days: d })}>
            {d}일
          </button>
        ))}
      </div>
      <label className="row gap-6 cl-pick">
        <input type="checkbox" checked={v.can_upload} onChange={e => setV({ ...v, can_upload: e.target.checked })} />
        <span className="t-small">파일 올리기 허용 (드라이브 방 폴더로 들어감)</span>
      </label>
      <p className="t-cap cl-note">링크는 다음 화면에서 한 번만 보입니다. 14일 안에 처음 연 기기 한 대에서만 열리니, 팀원이 직접 눌러 확인하지 마세요.</p>
    </Modal>
  )
}

function LinkModal({ project, room, guest, token, onClose }: { project: Project; room: CollabRoom; guest: CollabGuest; token: string; onClose: () => void }) {
  const { me, toast } = useApp()
  const url = collabInviteUrl(token)
  const company = room.company?.trim() || COMPANY[projectBrand(project)]
  const message = `안녕하세요, ${company} ${me.name}입니다.\n${room.title} 초대 링크를 보내 드립니다. 아래 링크를 열고 '협업방 들어가기'를 누르시면 로그인 없이 대화 · 자료 · 일정을 함께 보실 수 있습니다.\n(이 링크는 처음 여신 기기에서만 열립니다. 같은 기기에서는 다음에도 이 링크로 들어오시면 되고, 다른 기기에서 보시려면 말씀해 주세요.)\n\n${url}`
  return (
    <Modal
      title={`${guest.name}님 초대 링크`}
      onClose={onClose}
      actions={
        <Button kind="outline" onClick={onClose}>
          닫기
        </Button>
      }
    >
      <p className="t-small">카카오톡 · 메일로 직접 보내 주세요 (인트라넷이 대신 보내지 않습니다). 이 창을 닫으면 링크를 다시 볼 수 없습니다 — 잃어버리면 [새 링크].</p>
      <div className="row gap-6 cl-linkbox">
        <input className="input grow" readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="초대 링크" />
        <Button size="sm" onClick={() => void copy(url, toast, '링크를 복사했습니다.')}>
          링크 복사
        </Button>
      </div>
      <Field label="보낼 안내 문구">
        <textarea className="textarea" rows={6} readOnly value={message} onFocus={e => e.currentTarget.select()} />
      </Field>
      <div className="row gap-6">
        <Button kind="outline" size="sm" onClick={() => void copy(message, toast, '안내 문구를 복사했습니다.')}>
          안내 문구 복사
        </Button>
        <span className="t-cap">⚠ 직접 눌러 보면 그 기기에 묶여 상대가 열 수 없습니다.</span>
      </div>
    </Modal>
  )
}

function GuestModal({ guest, onClose, onDone }: { guest: CollabGuest; onClose: () => void; onDone: () => void }) {
  const { api, toast } = useApp()
  const [v, setV] = useState({ name: guest.name, org: guest.org ?? '', role: guest.role, can_upload: guest.can_upload, expires: kst(guest.expires_at).slice(0, 10) })
  const [busy, setBusy] = useState(false)
  const save = async (patch?: { revoked_at: string | null }) => {
    if (!v.name.trim()) return toast('이름을 적어 주세요.')
    setBusy(true)
    try {
      await api.updateCollabGuest(guest.id, { name: v.name.trim(), org: v.org.trim() || null, role: v.role, can_upload: v.can_upload, expires_at: new Date(`${v.expires}T23:59:59+09:00`).toISOString(), ...(patch ?? {}) })
      toast(patch ? (patch.revoked_at ? '접속을 해제했습니다. 모든 기기가 바로 막힙니다.' : '해제를 풀었습니다. [새 링크]로 다시 초대해 주세요.') : '저장했습니다.')
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`외부인 — ${guest.name}`}
      onClose={onClose}
      actions={
        <>
          {guest.revoked_at ? (
            <Button kind="outline" onClick={() => void save({ revoked_at: null })} disabled={busy}>
              해제 풀기
            </Button>
          ) : (
            <Button kind="outline" onClick={async () => (await ask(`${guest.name}님의 접속을 해제할까요? 들어와 있는 모든 기기가 바로 막힙니다.`)) && void save({ revoked_at: new Date().toISOString() })} disabled={busy}>
              접속 해제
            </Button>
          )}
          <Button onClick={() => void save()} disabled={busy}>
            저장
          </Button>
        </>
      }
    >
      <div className="row gap-8 wrap">
        <Field label="이름">
          <input className="input" value={v.name} maxLength={40} onChange={e => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="회사">
          <input className="input" value={v.org} maxLength={60} onChange={e => setV({ ...v, org: e.target.value })} />
        </Field>
      </div>
      <div className="row gap-6 wrap cl-pick">
        <span className="t-cap">역할</span>
        {COLLAB_ROLES.map(r => (
          <button key={r} type="button" className={`chip ${v.role === r ? 'active' : ''}`} onClick={() => setV({ ...v, role: r })}>
            {r}
          </button>
        ))}
      </div>
      <div className="row gap-8 wrap">
        <Field label="접속 기간 (이 날까지)">
          <input className="input" type="date" value={v.expires} onChange={e => setV({ ...v, expires: e.target.value })} />
        </Field>
        <label className="row gap-6 cl-pick">
          <input type="checkbox" checked={v.can_upload} onChange={e => setV({ ...v, can_upload: e.target.checked })} />
          <span className="t-small">파일 올리기 허용</span>
        </label>
      </div>
      {guest.revoked_at && <p className="t-cap">해제됨 {dot(kst(guest.revoked_at).slice(0, 10))}</p>}
    </Modal>
  )
}

function DevicesModal({ room, guest, onClose }: { room: CollabRoom; guest: CollabGuest; onClose: () => void }) {
  const { api, toast } = useApp()
  const [tick, setTick] = useState(0)
  const { data, loading } = useAsync(() => api.listCollabLinks(room.id), [room.id, tick], [] as CollabLink[])
  const mine = data.filter(l => l.guest_id === guest.id)
  const cut = async (l: CollabLink) => {
    if (!(await ask(l.pending ? '아직 열지 않은 초대 링크를 취소할까요?' : '이 기기의 접속을 끊을까요?'))) return
    try {
      await api.revokeCollabLink(room.id, l.id)
      setTick(t => t + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : '끊지 못했습니다.')
    }
  }
  return (
    <Modal
      title={`${guest.name}님 기기 · 초대 링크`}
      onClose={onClose}
      actions={
        <Button kind="outline" onClick={onClose}>
          닫기
        </Button>
      }
    >
      {loading && <p className="t-cap">불러오는 중…</p>}
      {!loading && !mine.length && <p className="t-cap">기록이 없습니다.</p>}
      {mine.map(l => {
        const state = l.revoked_at ? '끊김' : l.pending ? (Date.parse(l.invite_expires_at) < Date.now() ? '링크 기간 지남' : '링크 아직 안 엶') : '사용 중'
        return (
          <div key={l.id} className="cl-device">
            <MonitorSmartphone size={14} />
            <span className="grow">
              <b className="t-smallb">{l.device || (l.pending ? '초대 링크' : '기기')}</b>
              <span className="t-cap">
                {' '}
                · {state} · 만듦 {relativeLabel(l.created_at)}
                {l.redeemed_at ? ` · 처음 엶 ${relativeLabel(l.redeemed_at)}` : ''}
                {l.last_seen_at ? ` · 최근 ${relativeLabel(l.last_seen_at)}` : ''}
              </span>
            </span>
            {!l.revoked_at && (
              <button type="button" className="cl-mini" onClick={() => void cut(l)}>
                {l.pending ? '취소' : '끊기'}
              </button>
            )}
          </div>
        )
      })}
    </Modal>
  )
}

function RoomSettings({ room, onClose, onDone }: { room: CollabRoom; onClose: () => void; onDone: () => void }) {
  const { api, toast } = useApp()
  const [title, setTitle] = useState(room.title)
  const [intro, setIntro] = useState(room.intro ?? '')
  const [company, setCompany] = useState(room.company ?? '')
  const [busy, setBusy] = useState(false)
  const save = async (closed?: string | null) => {
    if (!title.trim()) return toast('방 이름을 적어 주세요.')
    setBusy(true)
    try {
      await api.updateCollabRoom(room.id, { title: title.trim(), intro: intro.trim() || null, company: company.trim() || null, ...(closed !== undefined ? { closed_at: closed } : {}) })
      toast(closed === undefined ? '저장했습니다.' : closed ? '방을 닫았습니다. 외부인이 더는 들어올 수 없습니다.' : '방을 다시 열었습니다.')
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="방 설정"
      onClose={onClose}
      actions={
        <>
          {room.closed_at ? (
            <Button kind="outline" onClick={() => void save(null)} disabled={busy}>
              다시 열기
            </Button>
          ) : (
            <Button kind="outline" onClick={async () => (await ask('방을 닫을까요? 외부인은 더 들어올 수 없고, 대화 · 자료는 그대로 남습니다.')) && void save(new Date().toISOString())} disabled={busy}>
              방 닫기
            </Button>
          )}
          <Button onClick={() => void save()} disabled={busy}>
            저장
          </Button>
        </>
      }
    >
      <Field label="방 이름 (외부인에게 보임)">
        <input className="input" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} />
      </Field>
      <Field label="첫 화면 안내 (외부인에게 보임)">
        <textarea className="textarea" rows={3} maxLength={1000} value={intro} onChange={e => setIntro(e.target.value)} />
      </Field>
      <Field label="외부인에게 보이는 회사 이름 (비우면 프로젝트 구분: 아트리어디자인스튜디오 · 더위클리컴퍼니)">
        <input className="input" value={company} maxLength={40} onChange={e => setCompany(e.target.value)} placeholder="예: 더위클리 (아트리어 일을 더위클리로 소개한 거래처)" />
      </Field>
    </Modal>
  )
}
