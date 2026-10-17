import { useEffect, useRef, useState } from 'react'
import { Pin, Search, Trash2, X } from 'lucide-react'
import { useApp, useAsync } from '../lib/app'
import { friendlyError } from '../lib/api'
import { relativeLabel } from '../lib/date'
import type { Note } from '../lib/types'
import { Button, Empty } from './ui'

/** 메모 한 장: 고치면 잠시 뒤 자동 저장 */
function NoteCard({ note, onChanged }: { note: Note; onChanged: () => void }) {
  const { api, toast } = useApp()
  const [text, setText] = useState(note.content)
  const [saving, setSaving] = useState(false)
  const timer = useRef<number>()
  const save = async (patch: { content?: string; pinned?: boolean }) => {
    setSaving(true)
    try {
      await api.saveNote({ id: note.id, content: patch.content ?? text, pinned: patch.pinned })
      onChanged()
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <div className={`memo ${note.pinned ? 'pinned' : ''}`}>
      <textarea
        className="memo-text"
        value={text}
        rows={Math.min(12, Math.max(2, text.split('\n').length))}
        onChange={e => {
          const v = e.target.value
          setText(v)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => save({ content: v }), 800)
        }}
        onBlur={() => {
          window.clearTimeout(timer.current)
          if (text !== note.content) save({ content: text })
        }}
        aria-label="메모 내용"
      />
      <div className="row memo-foot">
        <span className="t-meta grow">{saving ? '저장 중…' : relativeLabel(note.updated_at)}</span>
        <button type="button" className={`icon-btn sm ${note.pinned ? 'on' : ''}`} onClick={() => save({ pinned: !note.pinned })} title={note.pinned ? '고정 해제' : '맨 위에 고정'} aria-label="고정">
          <Pin size={13} />
        </button>
        <button
          type="button"
          className="icon-btn sm del"
          title="삭제"
          aria-label="메모 삭제"
          onClick={async () => {
            if (!window.confirm('이 메모를 삭제할까요?')) return
            try {
              await api.deleteNote(note.id)
              onChanged()
            } catch (e) {
              toast(friendlyError(e))
            }
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

/** 개인 메모장: 업무 일지 · 업무 보고에 들어가지 않고 나만 봄 */
export function MemoPad({ onClose }: { onClose: () => void }) {
  const { api, version, toast } = useApp()
  const { data: notes, reload } = useAsync(() => api.listNotes(), [version], [] as Note[])
  useEffect(() => api.subscribeChanges(['notes'], reload), [api, reload])
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const add = async () => {
    const v = draft.trim()
    if (!v) return
    try {
      await api.saveNote({ content: v })
      setDraft('')
      reload()
    } catch (e) {
      toast(friendlyError(e))
    }
  }
  const shown = q.trim() ? notes.filter(n => n.content.toLowerCase().includes(q.trim().toLowerCase())) : notes
  return (
    <aside className="memo-pad" aria-label="메모장">
      <div className="row">
        <span className="t-bodyb grow">📝 메모장</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="메모장 닫기">
          <X size={16} />
        </button>
      </div>
      <span className="t-cap row" style={{ gap: 4 }}>
        나만 보는 메모 · 업무 일지와 업무 보고에 들어가지 않습니다
      </span>
      <div className="col gap-6">
        <textarea
          className="textarea"
          rows={3}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add()
          }}
          placeholder="새 메모 (Ctrl+Enter 저장)"
          aria-label="새 메모"
        />
        <Button size="sm" onClick={add} disabled={!draft.trim()}>
          메모 추가
        </Button>
      </div>
      {notes.length > 3 && (
        <label className="pick-input">
          <Search size={13} aria-hidden="true" />
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="메모 검색" aria-label="메모 검색" />
        </label>
      )}
      <div className="memo-list">
        {shown.length === 0 && <Empty>{q ? '찾는 메모가 없습니다.' : '아직 메모가 없습니다.'}</Empty>}
        {shown.map(n => (
          <NoteCard key={n.id} note={n} onChanged={reload} />
        ))}
      </div>
    </aside>
  )
}
