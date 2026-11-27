// 외부 협업방 › 화이트보드 (외부인 화면 · 2026-11-27 대표 지시 '외부 협업가능하게 만들어')
// 담당자가 이 방에 공유한 보드만 보임. 누르면 화면 가득 편집기(팀원과 같은 편집기 · 보기만으로 공유한 보드는 고칠 수 없음).
// 편집기(Excalidraw)는 보드를 열 때만 불러옴.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Eye, PenLine, RefreshCw } from 'lucide-react'
import { guestApi, type GuestBoard, type GuestError, type GuestKey, type GuestMe } from '../lib/collabGuest'
import { guestBoardSource } from '../lib/collabGuestBoard'

const BoardEditorCore = lazy(() => import('./BoardEditorCore'))

const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function GuestBoards({ k, me, onLost }: { k: GuestKey; me: GuestMe; onLost: (e: GuestError) => void }) {
  const [list, setList] = useState<GuestBoard[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<GuestBoard | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const source = useMemo(() => guestBoardSource(k.key, onLost), [k.key, onLost])
  const load = () => {
    setErr(null)
    guestApi.boards(k.key).then(setList).catch(e => setErr(e instanceof Error ? e.message : '보드를 불러오지 못했습니다.'))
  }
  useEffect(load, [k.key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!note) return
    const t = window.setTimeout(() => setNote(null), 4200)
    return () => window.clearTimeout(t)
  }, [note])
  return (
    <div className="gr-boards">
      {err && <p className="gr-banner warn" role="alert">{err} <button type="button" className="gr-link" onClick={load}>다시 시도</button></p>}
      {!list && !err && <p className="gr-empty">보드를 불러오는 중입니다.</p>}
      {list && !list.length && <p className="gr-empty">아직 공유된 화이트보드가 없습니다. 담당자가 보드를 공유하면 여기에 보입니다.</p>}
      {list && list.length > 0 && (
        <>
          <p className="gr-boards-hint">담당자와 같은 보드를 함께 봅니다. 고친 내용은 자동으로 저장되고, 상대가 고친 것은 몇 초 뒤 합쳐집니다. <button type="button" className="gr-link" onClick={load}><RefreshCw size={12} /> 새로 고침</button></p>
          <ul className="gr-board-list">
            {list.map(b => (
              <li key={b.id}>
                <button type="button" className="gr-board" onClick={() => setOpen(b)}>
                  <span className="gr-board-icon" aria-hidden>{b.can_edit ? <PenLine size={16} /> : <Eye size={16} />}</span>
                  <span className="gr-board-main">
                    <b>{b.title}</b>
                    <span>{b.can_edit ? '함께 고칠 수 있음' : '보기만'} · {when(b.updated_at)} 고침</span>
                  </span>
                  <span className="gr-board-go">열기</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {open && (
        <div className="gr-board-full" role="dialog" aria-label={`화이트보드 ${open.title}`}>
          <Suspense fallback={<p className="gr-empty">편집기를 불러오는 중입니다.</p>}>
            <BoardEditorCore id={open.id} embedded guest readOnly={!open.can_edit} api={source} me={{ id: `guest:${me.id}`, name: me.name }} toast={setNote} onClose={() => { setOpen(null); load() }} />
          </Suspense>
          {note && <div className="gr-board-toast" role="status">{note}</div>}
        </div>
      )}
    </div>
  )
}
