// 제안 보드 (2026-11-17 대표 지시 '제안서는 피그마와 같은 환경에 houzz의 스팩 기능을 합쳐')
// 피그마식: 넓은 판 위의 16:9 페이지 · 레이어 · 속성 · 댓글 핀 · 같이 보기 · 자동 저장 · 되돌리기.
// Houzz Pro 식: 스펙북의 항목을 카드로 놓고(살아 있는 연결) 그 자리에서 검토 → 선정 → 확정, 일람표 · 마감 견본 · 스펙 페이지 자동 만들기.
// 이 파일은 자료와 상태(불러오기 · 저장 · 같이 보기 · 되돌리기)와 옆 칸을 맡고, 판은 DesignBoardCanvas, 요소 그리기는 DesignBoardEl 이 맡는다.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, BringToFront, Copy, ExternalLink, Image as ImageIcon, LayoutGrid, Lock, Maximize2, MessageCircle, Minimize2, Minus, MousePointer2, Palette, Play, Plus, Printer, Redo2, SendToBack, Square, StickyNote, Table2, Trash2, Type, Undo2, Unlock, Users, Wand2 } from 'lucide-react'
import { Button } from './ui'
import { useApp, useAsync } from '../lib/app'
import { useRouter } from '../lib/router'
import { SPEC_BOOKS, SPEC_STATUS, type DesignProject, type DesignRender, type ProposalSection, type ProposalTemplateSection, type SpecBook, type SpecItem } from '../lib/design'
import { BUILTIN_LIBRARY, finishText, type LibraryFinish } from '../lib/designLibrary'
import { cardGrid, chunk, cloneEls, emptyBoard, freeSpot, mergeBoardComments, newPage, readBoard, restack, topZ, uid, type BoardComment, type BoardEl, type BoardElType, type BoardPage, type BoardStyle, type ProposalBoard } from '../lib/designBoard'
import { DesignBoardCanvas, type BoardCanvasHandle, type BoardTool, type Pin } from './DesignBoardCanvas'
import { BoardDataContext, BoardPageView, STATUS_KEYS, SpecThumb, elLabel, scheduleRows, type BoardData } from './DesignBoardEl'
import './DesignBoard.css'

type Peer = { id: string; name: string }
type Watch = (key: string, who: Peer, on: { peers(list: Peer[]): void; saved(by: Peer & { at: number }): void }) => { saved(): void; close(): void }
type Tab = 'props' | 'spec' | 'notes'
const FILLS = ['#ffffff', '#f6f4ef', '#eef3ee', '#e8f3ec', '#e8eef8', '#fff3bf', '#fde8ec', '#efe6d2', '#d9d9d9']
const INKS = ['#151d18', '#535c56', '#1f6b4a', '#2456ab', '#c0392b', '#94704c', '#ffffff']
const SIZE: Record<BoardElType, [number, number]> = { text: [560, 80], rect: [360, 240], note: [280, 220], spec: [330, 400], swatch: [240, 290], table: [1100, 420], image: [640, 360] }
const TOOLS: { key: BoardTool; label: string; hint: string; icon: ReactNode }[] = [
  { key: 'select', label: '선택', hint: 'V', icon: <MousePointer2 size={14} /> }, { key: 'text', label: '글', hint: 'T', icon: <Type size={14} /> },
  { key: 'rect', label: '사각형', hint: 'R', icon: <Square size={14} /> }, { key: 'note', label: '메모', hint: 'N', icon: <StickyNote size={14} /> },
  { key: 'comment', label: '댓글', hint: 'C', icon: <MessageCircle size={14} /> },
]
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}` }
const bookName = (b: string) => (SPEC_BOOKS[b as SpecBook] ?? b).split(' (')[0]

/** 숫자 칸: 다 적고 나서(Enter · 다른 곳 누르기) 반영한다 */
function Num({ label, value, onCommit, min = -9999 }: { label: string; value: number; onCommit(n: number): void; min?: number }) {
  const [t, setT] = useState(String(Math.round(value)))
  useEffect(() => setT(String(Math.round(value))), [value])
  const commit = () => { const n = Number(t); if (Number.isFinite(n) && Math.round(n) !== Math.round(value)) onCommit(Math.max(min, Math.round(n))); else setT(String(Math.round(value))) }
  return <label className="dbd-num"><span>{label}</span><input className="input xs" inputMode="numeric" value={t} onChange={e => setT(e.target.value.replace(/[^\d-]/g, ''))} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} /></label>
}
function Swatches({ label, colors, value, onPick, none }: { label: string; colors: string[]; value?: string; onPick(c: string | undefined): void; none?: string }) {
  return <div className="dbd-field"><span className="dbd-label">{label}</span><div className="dbd-colors">
    {none && <button type="button" className={`dbd-color none${!value ? ' on' : ''}`} title={none} aria-label={none} onClick={() => onPick(undefined)} />}
    {colors.map(c => <button type="button" key={c} className={`dbd-color${value?.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={`${label} ${c}`} onClick={() => onPick(c)} />)}
  </div></div>
}

function Present({ pages, start, onClose }: { pages: BoardPage[]; start: number; onClose(): void }) {
  const [i, setI] = useState(clamp(start, 0, pages.length - 1))
  const [size, setSize] = useState([window.innerWidth, window.innerHeight])
  const box = useRef<HTMLDivElement>(null)
  const native = useRef(false)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); setI(n => Math.min(pages.length - 1, n + 1)) }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); setI(n => Math.max(0, n - 1)) }
      else if (e.key === 'Home') setI(0)
      else if (e.key === 'End') setI(pages.length - 1)
    }
    const resize = () => setSize([window.innerWidth, window.innerHeight])
    const fs = () => { if (document.fullscreenElement) native.current = true; else if (native.current) onClose() }
    window.addEventListener('keydown', key, true); window.addEventListener('resize', resize); document.addEventListener('fullscreenchange', fs)
    try { void box.current?.requestFullscreen?.().catch(() => undefined) } catch { /* 전체 화면을 못 써도 창 안에서 보여 준다 */ }
    return () => {
      window.removeEventListener('keydown', key, true); window.removeEventListener('resize', resize); document.removeEventListener('fullscreenchange', fs)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const pg = pages[i], k = Math.min(size[0] / pg.w, (size[1] - 48) / pg.h)
  return createPortal(
    <div className="dbd-present" ref={box} role="dialog" aria-label="발표 보기">
      <div className="dbd-present-stage" style={{ width: pg.w * k, height: pg.h * k }} onClick={() => setI(n => Math.min(pages.length - 1, n + 1))}>
        <div style={{ transform: `scale(${k})`, transformOrigin: '0 0', width: pg.w, height: pg.h }}><BoardPageView page={pg} /></div>
      </div>
      <div className="dbd-present-bar">
        <button type="button" className="dbd-tb" disabled={i === 0} onClick={() => setI(i - 1)}>이전</button>
        <b>{i + 1} / {pages.length}</b><span>{pg.name}</span>
        <button type="button" className="dbd-tb" disabled={i === pages.length - 1} onClick={() => setI(i + 1)}>다음</button>
        <button type="button" className="dbd-tb" onClick={onClose}>닫기 (Esc)</button>
      </div>
    </div>, document.body)
}

export default function DesignBoard({ project }: { project: DesignProject }) {
  const { api, me, toast, version, bump } = useApp()
  const { navigate } = useRouter()
  const { data: specs } = useAsync(() => api.listSpecItems(project.id).then(l => l.map(s => ({ ...s }))), [project.id, version], [] as SpecItem[])
  const { data: images } = useAsync(() => api.listSpecImages(project.id), [project.id, version], {} as Record<string, string>)
  const { data: renders } = useAsync(() => api.listRenders(project.id), [project.id, version], [] as DesignRender[])
  const data = useMemo<BoardData>(() => ({ specs, images, renders }), [specs, images, renders])

  // ── 보드 자료 · 되돌리기 ─────────────────────────────────
  const [board, setBoardState] = useState<ProposalBoard>(() => emptyBoard())
  const boardRef = useRef(board)
  const hist = useRef({ past: [] as BoardPage[][], future: [] as BoardPage[][], tag: '', at: 0 })
  const [, setHistTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadTick, setLoadTick] = useState(0)
  const ready = useRef(false)
  const epoch = useRef(0)
  const [dirty, setDirtyState] = useState(false)
  const dirtyRef = useRef(false)
  const rev = useRef(0)
  const [revTick, setRevTick] = useState(0)
  const [nudge, setNudge] = useState(0)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const inflight = useRef<Promise<boolean> | null>(null)
  const lastOwnSave = useRef(0)
  const dragging = useRef(false)
  const dragBase = useRef<BoardPage[] | null>(null)
  // 댓글은 되돌리기와 따로 간다: 내가 쓰거나 고친 것 · 지운 것만 기억해 두었다가 저장할 때 서버의 최신 댓글과 합친다
  const cTouched = useRef(new Map<string, number>())
  const cRemoved = useRef(new Map<string, number>())

  const [cur, setCurState] = useState('')
  const curRef = useRef('')
  const setCur = (id: string) => { curRef.current = id; setCurState(id) }
  const [sel, setSel] = useState<string[]>([])
  const [tool, setTool] = useState<BoardTool>('select')
  const [editing, setEditing] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('spec')
  const [zoom, setZoom] = useState(0.4)
  const [full, setFull] = useState(false)
  const [cols, setCols] = useState<'slim' | 'mid' | 'wide'>('wide')
  const [peers, setPeers] = useState<Peer[]>([])
  const [remote, setRemote] = useState<{ name: string } | null>(null)
  const [present, setPresent] = useState<number | null>(null)
  const [printing, setPrinting] = useState(false)
  const [q, setQ] = useState('')
  const [bookF, setBookF] = useState<string>('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [pinSel, setPinSel] = useState<string | null>(null)
  const [draftPin, setDraftPin] = useState<{ page: string; x: number; y: number } | null>(null)
  const [draftText, setDraftText] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const bodyEl = useRef<HTMLDivElement>(null)
  const [bodyH, setBodyH] = useState<number | null>(null)
  const canvas = useRef<BoardCanvasHandle>(null)
  const clip = useRef<{ els: BoardEl[]; page: string; n: number }>({ els: [], page: '', n: 0 })
  const watch = useRef<{ saved(): void; close(): void } | null>(null)

  const put = (next: ProposalBoard) => { boardRef.current = next; setBoardState(next) }
  const touch = () => { rev.current += 1; dirtyRef.current = true; setDirtyState(true); setRevTick(rev.current) }
  /** 한 번의 고침 = 되돌리기 한 단계. tag 가 같은 고침이 잇따르면(글자 입력 · 방향키) 한 단계로 묶는다 */
  const change = (fn: (pages: BoardPage[]) => BoardPage[], tag = '') => {
    if (!ready.current) return
    const now = boardRef.current, pages = fn(now.pages)
    if (pages === now.pages) return
    const h = hist.current, t = Date.now()
    if (!(tag && tag === h.tag && t - h.at < 1500)) { h.past.push(now.pages); if (h.past.length > 100) h.past.shift() }
    h.future = []; h.tag = tag; h.at = t
    put({ ...now, pages }); touch(); setHistTick(n => n + 1)
  }
  const step = (dir: 'undo' | 'redo') => {
    const h = hist.current, from = dir === 'undo' ? h.past : h.future, to = dir === 'undo' ? h.future : h.past
    const pages = from.pop()
    if (!pages) return
    to.push(boardRef.current.pages); h.tag = ''
    put({ ...boardRef.current, pages }); touch(); setHistTick(n => n + 1); setEditing(null)
    if (!pages.some(p => p.id === curRef.current)) setCur(pages[0].id)
    setSel(s => s.filter(id => pages.some(p => p.els.some(e => e.id === id))))
  }
  const adopt = (b: ProposalBoard) => {
    hist.current = { past: [], future: [], tag: '', at: 0 }
    put(b); setHistTick(n => n + 1); setEditing(null)
    if (!b.pages.some(p => p.id === curRef.current)) setCur(b.pages[0].id)
    setSel(s => s.filter(id => b.pages.some(p => p.els.some(e => e.id === id))))
  }

  // ── 불러오기 ─────────────────────────────────────────────
  useEffect(() => {
    const ep = ++epoch.current
    ready.current = false
    setLoading(true); setLoadFailed(false); setRemote(null)
    cTouched.current.clear(); cRemoved.current.clear()
    dirtyRef.current = false; setDirtyState(false); setSavedAt(null); setSaveState('idle')
    api.getProposalBoard(project.id).then(row => {
      if (ep !== epoch.current) return
      const b = (row && readBoard(row.board)) || emptyBoard()
      curRef.current = ''
      adopt(b); setSel([])
      if (row?.updated_at) { const d = new Date(row.updated_at); if (!Number.isNaN(d.getTime())) setSavedAt(d) }
      ready.current = true; setLoading(false)
      window.requestAnimationFrame(() => canvas.current?.fit(b.pages[0].id))
    }).catch(() => { if (ep === epoch.current) { setLoading(false); setLoadFailed(true) } })
  }, [api, project.id, loadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 저장 (자동 저장 · 지금 저장) ─────────────────────────
  /** 저장할 내용: 내 페이지 + 서버의 최신 댓글에 내 댓글을 합친 것 (다른 사람의 댓글을 잃지 않게) */
  const persist = async (pid: string, mine: ProposalBoard): Promise<ProposalBoard> => {
    const row = await api.getProposalBoard(pid)
    const latest = row ? readBoard(row.board) : null
    const comments = mergeBoardComments(mine.comments.filter(c => cTouched.current.has(c.id)), latest?.comments ?? [], cRemoved.current.keys())
    const out: ProposalBoard = { v: 1, pages: mine.pages, comments }
    await api.saveProposalBoard(pid, out)
    return out
  }
  const save = (): Promise<boolean> => {
    const pid = project.id, ep = epoch.current
    const job = (async () => {
      if (inflight.current) await inflight.current.catch(() => false)
      if (!ready.current || ep !== epoch.current) return false
      setSaveState('saving')
      const startRev = rev.current
      let ok = false
      try {
        const out = await persist(pid, boardRef.current)
        if (ep !== epoch.current) return true
        for (const [id, r] of cTouched.current) if (r <= startRev) cTouched.current.delete(id)
        for (const [id, r] of cRemoved.current) if (r <= startRev) cRemoved.current.delete(id)
        // 저장하는 사이에 들어온 다른 사람의 댓글을 화면에도 반영한다
        const now = boardRef.current
        const comments = mergeBoardComments(now.comments.filter(c => cTouched.current.has(c.id)), out.comments, cRemoved.current.keys())
        if (JSON.stringify(comments) !== JSON.stringify(now.comments)) put({ ...now, comments })
        if (rev.current === startRev) { dirtyRef.current = false; setDirtyState(false) }
        lastOwnSave.current = Date.now()
        setSavedAt(new Date()); setSaveState('idle')
        try { watch.current?.saved() } catch { /* 알림을 못 보내도 저장은 된 것 */ }
        ok = true
      } catch { if (ep === epoch.current) setSaveState('error') }
      if (ep === epoch.current && (!ok || rev.current !== startRev)) setNudge(n => n + 1)
      return ok
    })()
    inflight.current = job
    void job.finally(() => { if (inflight.current === job) inflight.current = null })
    return job
  }
  const saveRef = useRef(save)
  saveRef.current = save
  // 마지막으로 고친 뒤 2초가 지나면 저장한다. 끄는 중 · 글을 적는 중에는 미루고, 다른 사람이 고쳤다는 알림이 떠 있으면 고를 때까지 기다린다
  useEffect(() => {
    if (!dirty || loading || remote) return
    let t = window.setTimeout(function tick() {
      if (dragging.current) { t = window.setTimeout(tick, 400); return }
      void saveRef.current()
    }, saveState === 'error' ? 15000 : 2000)
    return () => window.clearTimeout(t)
  }, [dirty, revTick, nudge, loading, remote, saveState])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  // 다른 단계로 넘어갈 때 저장하지 않은 것이 있으면 마저 저장한다
  useEffect(() => {
    const pid = project.id
    return () => { if (dirtyRef.current && ready.current) void persist(pid, boardRef.current).catch(() => undefined) }
  }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 같이 보기: 지금 보는 사람 · 다른 사람이 저장하면 알림 ──
  const reload = async (force: boolean, by = '') => {
    const ep = epoch.current
    try {
      const row = await api.getProposalBoard(project.id)
      if (ep !== epoch.current) return
      // 불러오는 사이에 내가 고쳤으면 덮어쓰지 않고 알림으로 바꾼다
      if (!force && (dirtyRef.current || dragging.current)) { setRemote({ name: by || '다른 사람' }); return }
      const latest = (row && readBoard(row.board)) || emptyBoard()
      const comments = mergeBoardComments(boardRef.current.comments.filter(c => cTouched.current.has(c.id)), latest.comments, cRemoved.current.keys())
      adopt({ v: 1, pages: latest.pages, comments })
      const mine = cTouched.current.size > 0 || cRemoved.current.size > 0
      dirtyRef.current = mine; setDirtyState(mine)
      if (mine) setNudge(n => n + 1)
      setRemote(null)
    } catch { toast('보드를 다시 불러오지 못했습니다') }
  }
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    let handle: { saved(): void; close(): void } | null = null
    setPeers([])
    try {
      const fn = (api as unknown as { watchDesignPlan?: Watch }).watchDesignPlan
      if (typeof fn === 'function') handle = fn.call(api, `${project.id}:board`, { id: me.id, name: me.name }, {
        peers: list => setPeers((list ?? []).filter(p => p && p.id !== me.id)),
        saved: by => {
          if (by?.id === me.id && Date.now() - lastOwnSave.current < 4000) return
          if (!dirtyRef.current && !dragging.current && !inflight.current) void reloadRef.current(false, by?.name)
          else setRemote({ name: by?.name || '다른 사람' })
        },
      })
    } catch { handle = null }
    watch.current = handle
    return () => { watch.current = null; try { handle?.close() } catch { /* 이미 닫힘 */ } }
  }, [api, project.id, me.id, me.name])

  // ── 작업 공간 폭 ─────────────────────────────────────────
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setCols(el.clientWidth >= 1040 ? 'wide' : el.clientWidth < 760 ? 'slim' : 'mid'))
    ro.observe(el)
    return () => ro.disconnect()
  }, [full])
  // 판의 높이: 창 아래 끝까지 (위쪽 줄 수가 화면마다 달라 직접 잰다). 좁은 화면 · 넓게 보기에서는 CSS 가 정한다
  useEffect(() => {
    const measure = () => {
      const el = bodyEl.current
      if (!el) return
      let top = el.getBoundingClientRect().top
      for (let p = el.parentElement; p; p = p.parentElement) top += p.scrollTop
      setBodyH(Math.max(460, Math.round(window.innerHeight - top - 14)))
    }
    measure()
    const t = window.setTimeout(measure, 350)
    window.addEventListener('resize', measure)
    return () => { window.clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [cols, full, remote, loading])
  useEffect(() => {
    if (!full) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement) && present === null) setFull(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [full, present])

  // ── 지금 페이지 · 고른 것 ────────────────────────────────
  const pages = board.pages
  const page = pages.find(p => p.id === cur) ?? pages[0]
  const selEls = page.els.filter(e => sel.includes(e.id))
  const one = selEls.length === 1 ? selEls[0] : null
  const locked = !ready.current || loading || loadFailed
  const pins: Pin[] = useMemo(() => [...board.comments].sort((a, b) => a.at.localeCompare(b.at)).map((c, i) => ({ ...c, no: i + 1 })).filter(c => pages.some(p => p.id === c.page)), [board.comments, pages])
  const open = pins.filter(c => !c.done).length

  const patch = (ids: string[], fn: (e: BoardEl) => BoardEl, tag = '') => change(ps => ps.map(p => (p.id !== page.id ? p : { ...p, els: p.els.map(e => (ids.includes(e.id) ? fn(e) : e)) })), tag)
  const patchStyle = (s: Partial<BoardStyle>, tag = '') => patch(sel, e => ({ ...e, style: { ...e.style, ...s } }), tag)
  const addEls = (pageId: string, els: BoardEl[]) => {
    if (!els.length) return
    change(ps => ps.map(p => (p.id !== pageId ? p : { ...p, els: [...p.els, ...els] })))
    if (pageId !== curRef.current) setCur(pageId)
    setSel(els.map(e => e.id)); setTab(t => (t === 'notes' ? 'props' : t))
  }
  /** 새 요소: 정한 자리(왼쪽 위)에 놓되 페이지 밖으로 나가지 않게 */
  const make = (type: BoardElType, pageId: string, x: number, y: number, more: Partial<BoardEl> = {}): BoardEl => {
    const pg = boardRef.current.pages.find(p => p.id === pageId) ?? page
    const w = more.w ?? SIZE[type][0], h = more.h ?? SIZE[type][1]
    return { id: uid(), type, z: topZ(pg.els), ...more, x: Math.round(clamp(x, 0, Math.max(0, pg.w - w))), y: Math.round(clamp(y, 0, Math.max(0, pg.h - h))), w, h }
  }
  /** 옆 칸에서 넣을 때의 빈 자리: 같은 종류가 이미 있으면 그 옆으로, 아니면 겹치지 않는 첫 자리 */
  const spot = (type: BoardElType, w = SIZE[type][0], h = SIZE[type][1]) => freeSpot(page.els, w, h, page, [...page.els].filter(e => e.type === type).sort((a, b) => a.z - b.z).pop())
  const create = (t: 'text' | 'rect' | 'note', pageId: string, x: number, y: number) => {
    const el = make(t, pageId, x, y, t === 'text' ? { text: '' } : t === 'note' ? { text: '' } : {})
    addEls(pageId, [el]); setTool('select'); setTab('props')
    if (t !== 'rect') setEditing(el.id)
  }
  const addSpec = (id: string, at?: { page: string; x: number; y: number }) => {
    const s = at ? { x: at.x - SIZE.spec[0] / 2, y: at.y - SIZE.spec[1] / 2 } : spot('spec')
    addEls(at?.page ?? page.id, [make('spec', at?.page ?? page.id, s.x, s.y, { spec_id: id })])
  }
  const finishOptions = useMemo(() => {
    const mine = specs.filter(s => s.book === 'materials' && s.status !== 'dropped').map(s => [s.code, s.name, s.spec].filter(Boolean).join(' '))
    return { mine, lib: BUILTIN_LIBRARY.filter(e => e.kind === 'finish').map(e => finishText(e.data as LibraryFinish)) }
  }, [specs])
  const addSwatch = () => {
    // 아직 견본으로 놓지 않은 마감부터 차례로
    const used = new Set(page.els.filter(e => e.type === 'swatch').map(e => e.finish)), all = [...finishOptions.mine, ...finishOptions.lib]
    const s = spot('swatch'); addEls(page.id, [make('swatch', page.id, s.x, s.y, { finish: all.find(f => !used.has(f)) ?? all[0] ?? '' })])
  }
  const addTable = () => { const h = clamp(64 + 46 + (scheduleRows(specs, bookF || undefined).length || 2) * 44 + 12, 200, 700), s = spot('table', SIZE.table[0], h); addEls(page.id, [make('table', page.id, s.x, s.y, { book: bookF || undefined, h })]) }
  const addImage = (src: string) => { const s = spot('image'); addEls(page.id, [make('image', page.id, s.x, s.y, { src })]) }
  const removeSel = () => { const ids = selEls.filter(e => !e.locked).map(e => e.id); if (!ids.length) return; change(ps => ps.map(p => (p.id !== page.id ? p : { ...p, els: p.els.filter(e => !ids.includes(e.id)) }))); setSel(s => s.filter(id => !ids.includes(id))); setEditing(null) }
  const duplicate = () => { if (selEls.length) addEls(page.id, cloneEls(selEls, page.els)) }
  const copy = () => { if (selEls.length) clip.current = { els: selEls.map(e => ({ ...e })), page: page.id, n: 0 } }
  const paste = () => { const c = clip.current; if (!c.els.length) return; const same = c.page === page.id; if (same) c.n += 1; addEls(page.id, cloneEls(c.els, page.els, same ? 24 * c.n : 0)) }
  const setText = (id: string, text: string) => {
    const el = page.els.find(e => e.id === id) ?? pages.flatMap(p => p.els).find(e => e.id === id)
    if (!el) return
    if (el.type === 'text' && !text.trim()) { change(ps => ps.map(p => (p.els.some(e => e.id === id) ? { ...p, els: p.els.filter(e => e.id !== id) } : p))); setSel(s => s.filter(x => x !== id)); return }
    if ((el.text ?? '') === text) return
    // 글 상자는 줄 수에 맞게 높이를 늘린다 (줄어들지는 않는다)
    const lines = text.split('\n').length, px = { title: 64 * 1.18, sub: 36 * 1.3, body: 24 * 1.5 }[el.style?.size ?? 'body']
    change(ps => ps.map(p => (p.els.some(e => e.id === id) ? { ...p, els: p.els.map(e => (e.id === id ? { ...e, text, h: e.type === 'text' ? Math.max(e.h, Math.ceil(lines * px + 16)) : e.h } : e)) } : p)))
  }

  // ── 페이지 ───────────────────────────────────────────────
  const go = (id: string) => { setCur(id); setSel([]); setEditing(null); window.requestAnimationFrame(() => canvas.current?.fit(id)) }
  const addPage = () => { const p = newPage(`페이지 ${pages.length + 1}`); change(ps => [...ps, p]); go(p.id) }
  const dupPage = (id: string) => {
    const src = pages.find(p => p.id === id)
    if (!src) return
    const p: BoardPage = { ...src, id: uid(), name: `${src.name} 사본`, els: src.els.map(e => ({ ...e, id: uid(), style: e.style ? { ...e.style } : undefined })) }
    change(ps => { const i = ps.findIndex(x => x.id === id); return [...ps.slice(0, i + 1), p, ...ps.slice(i + 1)] }); go(p.id)
  }
  const delPage = (id: string) => {
    const src = pages.find(p => p.id === id)
    if (!src || !window.confirm(`'${src.name || '이름 없는 페이지'}' 페이지를 지울까요?${src.els.length ? ` 안에 놓은 ${src.els.length}개도 함께 지워집니다.` : ''} (되돌리기로 다시 살릴 수 있습니다)`)) return
    const i = pages.findIndex(p => p.id === id), rest = pages.filter(p => p.id !== id), next = rest.length ? rest : [newPage('표지')]
    change(() => next); go(next[Math.min(i, next.length - 1)].id)
  }
  const movePage = (id: string, d: -1 | 1) => change(ps => { const i = ps.findIndex(p => p.id === id), j = i + d; if (i < 0 || j < 0 || j >= ps.length) return ps; const out = [...ps]; [out[i], out[j]] = [out[j], out[i]]; return out })
  const renamePage = (id: string, name: string) => change(ps => ps.map(p => (p.id === id && p.name !== name ? { ...p, name } : p)), `name:${id}`)

  // ── 자동으로 만들기 ──────────────────────────────────────
  const fromOutline = async () => {
    setBusy(true)
    try {
      const [tpl, secs] = await Promise.all([api.getProposalTemplate(project.space_type), api.listProposalSections(project.id)]) as [ProposalTemplateSection[], ProposalSection[]]
      const use = tpl.filter(t => secs.find(s => s.section_key === t.key)?.status !== 'blank')
      if (!use.length) { toast('구성안 틀이 아직 없습니다. 구성안 (글)에서 먼저 확인해 주세요'); return }
      const made = use.map((t, i) => {
        const sec = secs.find(s => s.section_key === t.key), body = (sec?.body ?? '').trim(), figs = (sec?.figures ?? []).filter(f => f.value || f.label).slice(0, 6)
        const p = newPage(t.title)
        let z = 0
        const el = (type: BoardElType, x: number, y: number, w: number, h: number, more: Partial<BoardEl>): BoardEl => ({ id: uid(), type, x, y, w, h, z: z++, ...more })
        p.els.push(el('text', 80, 64, 1000, 40, { text: `${String(i + 1).padStart(2, '0')} · ${project.name}`, style: { size: 'body', color: '#1f6b4a', bold: true } }))
        p.els.push(el('text', 80, 116, 1440, 84, { text: t.title, style: { size: 'title', bold: true } }))
        p.els.push(el('rect', 80, 214, 96, 6, { style: { fill: '#1f6b4a' } }))
        p.els.push(el('text', 80, 252, figs.length ? 800 : 1440, 560, { text: body || '구성안 (글)에 이 항목의 내용을 적은 뒤 다시 만들면 여기에 들어옵니다.', style: { size: 'body', color: body ? '#151d18' : '#535c56' } }))
        figs.forEach((f, n) => {
          const x = 940 + (n % 2) * 300, y = 252 + Math.floor(n / 2) * 190
          p.els.push(el('rect', x, y, 280, 170, { style: { fill: '#eef3ee' } }))
          p.els.push(el('text', x + 20, y + 18, 240, 56, { text: `${f.value}${f.unit ?? ''}`, style: { size: 'sub', bold: true, color: '#1f6b4a' } }))
          p.els.push(el('text', x + 20, y + 84, 240, 76, { text: [f.label, f.source ? `출처: ${f.source}` : '출처 없음 — 확인 필요'].filter(Boolean).join('\n'), style: { size: 'body', color: f.source ? '#535c56' : '#c0392b' } }))
        })
        return p
      })
      change(ps => [...ps, ...made]); go(made[0].id)
      toast(`구성안에서 ${made.length}장을 만들었습니다. 한 번의 되돌리기로 모두 취소됩니다`)
    } catch { toast('구성안을 불러오지 못했습니다') } finally { setBusy(false) }
  }
  const specPages = () => {
    const made: BoardPage[] = []
    for (const b of Object.keys(SPEC_BOOKS)) {
      const rows = scheduleRows(specs, b)
      chunk(rows, 8).forEach((part, n, all) => {
        const p = newPage(`${bookName(b)} 스펙${all.length > 1 ? ` ${n + 1}` : ''}`)
        p.els.push({ id: uid(), type: 'text', x: 80, y: 64, w: 1100, h: 84, z: 0, text: bookName(b), style: { size: 'title', bold: true } })
        p.els.push({ id: uid(), type: 'text', x: 80, y: 150, w: 1100, h: 40, z: 1, text: `${project.name} · 선정 · 확정 ${rows.length}개`, style: { size: 'body', color: '#535c56' } })
        cardGrid(part.length, { x: 80, y: 214, w: 1440, h: 626 }).forEach((box, k) => p.els.push({ id: uid(), type: 'spec', ...box, z: k + 2, spec_id: part[k].id }))
        made.push(p)
      })
    }
    if (!made.length) { toast('선정 · 확정한 스펙이 없습니다. 스펙 탭에서 상태를 먼저 정해 주세요'); return }
    change(ps => [...ps, ...made]); go(made[0].id)
    toast(`스펙 페이지 ${made.length}장을 만들었습니다`)
  }

  // ── 스펙 상태 (Houzz 식 선정 흐름) ───────────────────────
  const setStatus = async (item: SpecItem, status: SpecItem['status']) => {
    if (item.status === status) return
    setBusy(true)
    try { await api.updateSpecItem(item.id, { status }); bump(); toast(`${item.code ?? item.name} — ${SPEC_STATUS[status]}(으)로 바꿨습니다`) }
    catch { toast('상태를 바꾸지 못했습니다') } finally { setBusy(false) }
  }

  // ── 댓글 ─────────────────────────────────────────────────
  const editComments = (fn: (list: BoardComment[]) => BoardComment[], touched?: string, removed?: string) => {
    if (!ready.current) return
    const now = boardRef.current
    put({ ...now, comments: fn(now.comments) }); touch()
    if (touched) cTouched.current.set(touched, rev.current)
    if (removed) { cRemoved.current.set(removed, rev.current); cTouched.current.delete(removed) }
  }
  const postDraft = () => {
    const text = draftText.trim()
    if (!draftPin || !text) return
    const c: BoardComment = { id: uid(), page: draftPin.page, x: Math.round(draftPin.x), y: Math.round(draftPin.y), text, by: me.name, at: new Date().toISOString() }
    editComments(l => [...l, c], c.id); setDraftPin(null); setDraftText(''); setPinSel(c.id); setTool('select')
  }
  const pickPin = (id: string) => { const c = pins.find(x => x.id === id); if (!c) return; setPinSel(id); setTab('notes'); setReply(''); if (c.page !== curRef.current) { setCur(c.page); setSel([]) } }

  // ── 단축키 (글을 적는 칸에 있을 때는 건드리지 않는다) ─────
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (present !== null || locked) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const a = document.activeElement
      if (a && a !== document.body && !root.current?.contains(a)) return
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
      if (mod && !e.altKey && k === 'z') { e.preventDefault(); step(e.shiftKey ? 'redo' : 'undo'); return }
      if (mod && !e.altKey && k === 'y') { e.preventDefault(); step('redo'); return }
      if (mod && k === 'd') { e.preventDefault(); duplicate(); return }
      if (mod && k === 'c') { if (selEls.length) { e.preventDefault(); copy() } return }
      if (mod && k === 'v') { if (clip.current.els.length) { e.preventDefault(); paste() } return }
      if (mod && k === 'a') { e.preventDefault(); setSel(page.els.map(x => x.id)); return }
      if (mod || e.altKey) return
      if (k === 'delete' || k === 'backspace') { if (selEls.length) { e.preventDefault(); removeSel() } return }
      if (k === 'escape') { setSel([]); setTool('select'); setDraftPin(null); setEditing(null); return }
      if (k === 'enter' && one && !one.locked && (one.type === 'text' || one.type === 'note' || one.type === 'rect')) { e.preventDefault(); setEditing(one.id); return }
      if (k.startsWith('arrow')) {
        const ids = selEls.filter(x => !x.locked).map(x => x.id)
        if (!ids.length) return
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0
        patch(ids, x => ({ ...x, x: x.x + dx, y: x.y + dy }), 'nudge'); return
      }
      const hit = TOOLS.find(x => x.hint.toLowerCase() === k)
      if (hit) { setTool(hit.key); if (hit.key !== 'comment') setDraftPin(null) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // ── 인쇄 · PDF: 페이지마다 가로 16:9 한 장 ───────────────
  useEffect(() => {
    if (!printing) return
    const style = document.createElement('style')
    style.textContent = '@page { size: 338.67mm 190.5mm; margin: 0 }'
    document.head.appendChild(style); document.body.classList.add('dbd-printing')
    const done = () => { document.body.classList.remove('dbd-printing'); style.remove(); window.removeEventListener('afterprint', done); setPrinting(false) }
    window.addEventListener('afterprint', done)
    const t = window.setTimeout(() => window.print(), 120)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); document.body.classList.remove('dbd-printing'); style.remove() }
  }, [printing])

  const status = loading ? '불러오는 중…' : loadFailed ? '보드를 불러오지 못했습니다' : saveState === 'saving' ? '저장 중…' : saveState === 'error' ? '저장하지 못했습니다' : dirty ? (remote ? '저장을 잠시 멈췄습니다' : '고친 내용을 곧 저장합니다') : savedAt ? `저장됨 ${hhmm(savedAt)}` : '고치면 자동으로 저장됩니다'
  const specOf = one?.type === 'spec' ? specs.find(s => s.id === one.spec_id) ?? null : null
  const books = [...new Set(specs.map(s => s.book))]
  const shown = specs.filter(s => (!bookF || s.book === bookF) && (!q.trim() || [s.code, s.name, s.spec, s.maker, s.location].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase())))
  const textual = !!one && (one.type === 'text' || one.type === 'note' || one.type === 'rect')
  const st = one?.style ?? {}

  const propsTab = (
    <div className="dbd-pane">
      {!selEls.length && <>
        <b className="dbd-h">페이지</b>
        <label className="dbd-field"><span className="dbd-label">이름</span><input className="input" value={page.name} disabled={locked} onChange={e => renamePage(page.id, e.target.value)} aria-label="페이지 이름" /></label>
        <Swatches label="바탕색" colors={FILLS} value={page.bg ?? '#ffffff'} onPick={c => change(ps => ps.map(p => (p.id === page.id ? { ...p, bg: c } : p)))} />
        <p className="dbd-hint">요소를 누르면 여기서 글 · 색 · 크기를 고칩니다. 빈 곳을 끌면 여러 개를 한꺼번에 고르고, Shift 를 누른 채 누르면 더하거나 뺍니다.</p>
        <p className="dbd-hint">단축키: 글 T · 사각형 R · 메모 N · 댓글 C · 복제 Ctrl+D · 복사 · 붙이기 Ctrl+C · V · 되돌리기 Ctrl+Z · 방향키로 1(Shift 10)씩 옮기기 · 스페이스를 누른 채 끌면 판이 움직입니다.</p>
      </>}
      {selEls.length > 1 && <b className="dbd-h">{selEls.length}개를 골랐습니다</b>}
      {one && <b className="dbd-h">{elLabel(one, specs, renders)}</b>}
      {specOf && <div className="dbd-spec-detail">
        <div className="dbd-spec-head"><SpecThumb item={specOf} className="lg" /><div><b>{[specOf.code, specOf.name].filter(Boolean).join(' ')}</b><span>{bookName(specOf.book)}</span></div></div>
        <dl>
          {([['규격', specOf.spec], ['마감 · 색', specOf.finish], ['크기', specOf.size], ['제조사', specOf.maker], ['위치', specOf.location], ['수량', specOf.qty != null ? `${specOf.qty}${specOf.unit ?? ''}` : null], ['납기', specOf.delivery], ['비고', specOf.note]] as [string, string | null | undefined][]).filter(r => r[1]).map(r => <div key={r[0]}><dt>{r[0]}</dt><dd>{r[1]}</dd></div>)}
        </dl>
        <span className="dbd-label">상태 (스펙북에 바로 반영됩니다)</span>
        <div className="dbd-seg" role="group" aria-label="스펙 상태">{STATUS_KEYS.map(k => <button type="button" key={k} disabled={busy} className={specOf.status === k ? `on st-${k}` : ''} aria-pressed={specOf.status === k} onClick={() => void setStatus(specOf, k)}>{SPEC_STATUS[k]}</button>)}</div>
        <button type="button" className="dbd-link" onClick={() => navigate(`/design?id=${project.id}&view=spec`)}><ExternalLink size={13} />스펙북에서 열기</button>
      </div>}
      {one?.type === 'spec' && !specOf && <p className="dbd-hint">스펙북에서 지워진 항목입니다. 이 카드는 지워도 됩니다.</p>}
      {one?.type === 'swatch' && <label className="dbd-field"><span className="dbd-label">마감</span>
        <select className="select" value={one.finish ?? ''} onChange={e => patch([one.id], x => ({ ...x, finish: e.target.value }))} aria-label="마감 고르기">
          {!!one.finish && ![...finishOptions.mine, ...finishOptions.lib].includes(one.finish) && <option value={one.finish}>{one.finish}</option>}
          {finishOptions.mine.length > 0 && <optgroup label="이 프로젝트 스펙북">{finishOptions.mine.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>}
          <optgroup label="기본 마감 라이브러리">{finishOptions.lib.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
        </select></label>}
      {one?.type === 'table' && <label className="dbd-field"><span className="dbd-label">넣을 종류</span>
        <select className="select" value={one.book ?? ''} onChange={e => patch([one.id], x => ({ ...x, book: e.target.value || undefined }))} aria-label="일람표 종류">
          <option value="">전체 (선정 · 확정)</option>{Object.keys(SPEC_BOOKS).map(b => <option key={b} value={b}>{bookName(b)}</option>)}
        </select></label>}
      {one?.type === 'image' && <label className="dbd-field"><span className="dbd-label">그림</span>
        <select className="select" value={one.src ?? ''} onChange={e => patch([one.id], x => ({ ...x, src: e.target.value }))} aria-label="그림 고르기">
          <optgroup label="투시도">{renders.map(r => <option key={r.id} value={`render:${r.id}`}>{r.no} {r.title}</option>)}</optgroup>
          <optgroup label="스펙북 사진">{specs.filter(s => images[s.id]).map(s => <option key={s.id} value={`spec:${s.id}`}>{[s.code, s.name].filter(Boolean).join(' ')}</option>)}</optgroup>
        </select></label>}
      {textual && one && <>
        <label className="dbd-field"><span className="dbd-label">글</span><textarea className="textarea" rows={one.type === 'rect' ? 2 : 4} value={one.text ?? ''} onChange={e => patch([one.id], x => ({ ...x, text: e.target.value }), `text:${one.id}`)} aria-label="글 내용" /></label>
        <div className="dbd-field"><span className="dbd-label">글자</span><div className="dbd-row">
          <div className="dbd-seg">{([['title', '제목'], ['sub', '소제목'], ['body', '본문']] as const).map(([k, l]) => <button type="button" key={k} className={(st.size ?? 'body') === k ? 'on' : ''} aria-pressed={(st.size ?? 'body') === k} onClick={() => patchStyle({ size: k })}>{l}</button>)}</div>
          <button type="button" className={`dbd-ib${st.bold ? ' on' : ''}`} aria-pressed={!!st.bold} title="굵게" aria-label="굵게" onClick={() => patchStyle({ bold: !st.bold })}><Bold size={13} /></button>
        </div></div>
        <div className="dbd-field"><span className="dbd-label">정렬</span><div className="dbd-seg icons">{([['left', '왼쪽', <AlignLeft size={13} key="l" />], ['center', '가운데', <AlignCenter size={13} key="c" />], ['right', '오른쪽', <AlignRight size={13} key="r" />]] as const).map(([k, l, ic]) => <button type="button" key={k} className={(st.align ?? (one.type === 'rect' ? 'center' : 'left')) === k ? 'on' : ''} title={`${l} 정렬`} aria-label={`${l} 정렬`} onClick={() => patchStyle({ align: k })}>{ic}</button>)}</div></div>
        <Swatches label="글자색" colors={INKS} value={st.color ?? '#151d18'} onPick={c => patchStyle({ color: c })} />
        <Swatches label="바탕색" colors={FILLS} value={st.fill ?? (one.type === 'note' ? '#fff3bf' : one.type === 'rect' ? '#eef3ee' : undefined)} onPick={c => patchStyle({ fill: c })} none={one.type === 'text' ? '바탕 없음' : undefined} />
        {one.type === 'rect' && <Swatches label="테두리" colors={INKS.slice(0, 6)} value={st.stroke} onPick={c => patchStyle({ stroke: c })} none="테두리 없음" />}
      </>}
      {one && <div className="dbd-field"><span className="dbd-label">자리 · 크기</span><div className="dbd-nums">
        <Num label="X" value={one.x} onCommit={n => patch([one.id], x => ({ ...x, x: n }))} /><Num label="Y" value={one.y} onCommit={n => patch([one.id], x => ({ ...x, y: n }))} />
        <Num label="가로" value={one.w} min={16} onCommit={n => patch([one.id], x => ({ ...x, w: n }))} /><Num label="세로" value={one.h} min={16} onCommit={n => patch([one.id], x => ({ ...x, h: n }))} />
      </div></div>}
      {selEls.length > 0 && <div className="dbd-acts">
        <button type="button" className="dbd-tb" onClick={() => change(ps => ps.map(p => (p.id === page.id ? { ...p, els: restack(p.els, sel, 'front') } : p)))}><BringToFront size={13} />앞으로</button>
        <button type="button" className="dbd-tb" onClick={() => change(ps => ps.map(p => (p.id === page.id ? { ...p, els: restack(p.els, sel, 'back') } : p)))}><SendToBack size={13} />뒤로</button>
        <button type="button" className="dbd-tb" onClick={() => { const all = selEls.every(e => e.locked); patch(sel, e => ({ ...e, locked: all ? undefined : true })) }}>{selEls.every(e => e.locked) ? <><Unlock size={13} />잠금 풀기</> : <><Lock size={13} />잠금</>}</button>
        <button type="button" className="dbd-tb" onClick={duplicate}><Copy size={13} />복제</button>
        <button type="button" className="dbd-tb danger" disabled={selEls.every(e => e.locked)} onClick={removeSel}><Trash2 size={13} />지우기</button>
      </div>}
    </div>
  )
  const specTab = (
    <div className="dbd-pane">
      <div className="dbd-acts">
        <button type="button" className="dbd-tb" disabled={locked} onClick={addSwatch}><Palette size={13} />마감 견본</button>
        <button type="button" className="dbd-tb" disabled={locked} onClick={addTable}><Table2 size={13} />스펙 일람표 넣기</button>
        <button type="button" className="dbd-tb" disabled={locked} onClick={specPages}><LayoutGrid size={13} />스펙 페이지 자동 만들기</button>
      </div>
      <input className="input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="스펙북에서 찾기 (번호 · 이름 · 규격)" aria-label="스펙 찾기" />
      <div className="dbd-chips"><button type="button" className={`chip${!bookF ? ' active' : ''}`} onClick={() => setBookF('')}>전체 {specs.length}</button>{books.map(b => <button type="button" key={b} className={`chip${bookF === b ? ' active' : ''}`} onClick={() => setBookF(b)}>{bookName(b)} {specs.filter(s => s.book === b).length}</button>)}</div>
      <ul className="dbd-spec-list" aria-label="스펙북 항목">
        {shown.map(s => <li key={s.id}><button type="button" draggable disabled={locked} onDragStart={e => { e.dataTransfer.setData('text/plain', `dbd-spec:${s.id}`); e.dataTransfer.effectAllowed = 'copy' }} onClick={() => addSpec(s.id)} title="누르면 지금 페이지에 카드로 놓습니다. 끌어서 원하는 자리에 놓아도 됩니다.">
          <SpecThumb item={s} /><span className="dbd-spec-txt"><b>{[s.code, s.name].filter(Boolean).join(' ')}</b><small>{[s.spec, s.maker].filter(Boolean).join(' · ') || bookName(s.book)}</small></span><span className={`dbd-st dbd-st-${s.status}`}>{SPEC_STATUS[s.status] ?? s.status}</span>
        </button></li>)}
      </ul>
      {!specs.length && <p className="dbd-hint">스펙북이 비어 있습니다. '도면 · 스펙북' 단계에서 항목을 넣으면 여기에 나타납니다. <button type="button" className="dbd-link inline" onClick={() => navigate(`/design?id=${project.id}&view=spec`)}>스펙북 열기</button></p>}
      {specs.length > 0 && !shown.length && <p className="dbd-hint">찾는 항목이 없습니다.</p>}
      <b className="dbd-h">투시도 넣기</b>
      <div className="dbd-acts">{renders.map(r => <button type="button" key={r.id} className="dbd-tb" disabled={locked} onClick={() => addImage(`render:${r.id}`)}><ImageIcon size={13} />{r.no} {r.title}</button>)}{!renders.length && <span className="dbd-hint">평면 · 3D 에서 투시도 장면을 만들면 여기에 나타납니다.</span>}</div>
      {specs.some(s => images[s.id]) && <><b className="dbd-h">스펙북 사진 넣기</b><div className="dbd-acts">{specs.filter(s => images[s.id]).map(s => <button type="button" key={s.id} className="dbd-tb" disabled={locked} onClick={() => addImage(`spec:${s.id}`)}><ImageIcon size={13} />{[s.code, s.name].filter(Boolean).join(' ')}</button>)}</div></>}
      <p className="dbd-hint">카드 · 일람표 · 사진은 스펙북과 투시도를 그대로 비춥니다. 스펙북을 고치면 보드도 함께 바뀝니다. 이 판에서는 파일을 따로 올리지 않습니다 — 사진은 스펙북 · 투시도에 올려 주세요.</p>
    </div>
  )
  const notesTab = (
    <div className="dbd-pane">
      {draftPin && <div className="dbd-note-form">
        <b className="dbd-h">새 댓글</b>
        <textarea className="textarea" rows={3} autoFocus value={draftText} onChange={e => setDraftText(e.target.value)} placeholder="이 자리에 남길 말을 적어 주세요" aria-label="새 댓글" onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postDraft() } }} />
        <div className="dbd-row"><Button size="sm" disabled={!draftText.trim()} onClick={postDraft}>남기기</Button><Button size="sm" kind="ghost" onClick={() => { setDraftPin(null); setDraftText('') }}>취소</Button></div>
      </div>}
      {!draftPin && <button type="button" className={`dbd-tb${tool === 'comment' ? ' on' : ''}`} disabled={locked} onClick={() => setTool('comment')}><MessageCircle size={13} />{tool === 'comment' ? '댓글을 남길 자리를 페이지에서 눌러 주세요' : '댓글 남기기'}</button>}
      <ul className="dbd-notes" aria-label="댓글 목록">
        {pins.map(c => <li key={c.id} className={`${c.done ? 'done' : ''}${pinSel === c.id ? ' on' : ''}`}>
          <button type="button" className="dbd-note-head" onClick={() => { pickPin(c.id); window.requestAnimationFrame(() => canvas.current?.centerOn(c.page, c.x, c.y)) }}>
            <i className="dbd-note-no">{c.no}</i><span><b>{c.by}</b> · {when(c.at)} · {pages.findIndex(p => p.id === c.page) + 1}쪽{c.done ? ' · 해결됨' : ''}</span>
          </button>
          <p>{c.text}</p>
          {(c.replies ?? []).map((r, i) => <p key={i} className="dbd-reply"><b>{r.by}</b> · {when(r.at)}<br />{r.text}</p>)}
          {pinSel === c.id && <>
            <div className="dbd-row"><input className="input" value={reply} onChange={e => setReply(e.target.value)} placeholder="답글" aria-label="답글" onKeyDown={e => { if (e.key === 'Enter' && reply.trim()) { e.preventDefault(); editComments(l => l.map(x => (x.id === c.id ? { ...x, replies: [...(x.replies ?? []), { by: me.name, at: new Date().toISOString(), text: reply.trim() }] } : x)), c.id); setReply('') } }} />
              <Button size="sm" kind="outline" disabled={!reply.trim()} onClick={() => { editComments(l => l.map(x => (x.id === c.id ? { ...x, replies: [...(x.replies ?? []), { by: me.name, at: new Date().toISOString(), text: reply.trim() }] } : x)), c.id); setReply('') }}>답글</Button></div>
            <div className="dbd-row">
              <button type="button" className="dbd-tb" onClick={() => editComments(l => l.map(x => (x.id === c.id ? { ...x, done: !c.done || undefined } : x)), c.id)}>{c.done ? '다시 열기' : '해결'}</button>
              <button type="button" className="dbd-tb danger" onClick={() => { if (window.confirm('이 댓글을 지울까요? 답글도 함께 지워집니다.')) { editComments(l => l.filter(x => x.id !== c.id), undefined, c.id); setPinSel(null) } }}>지우기</button>
            </div>
          </>}
        </li>)}
      </ul>
      {!pins.length && !draftPin && <p className="dbd-hint">아직 댓글이 없습니다. 위의 '댓글 남기기'를 누르고 페이지의 원하는 자리를 누르면 번호가 붙은 핀이 생깁니다. 같이 보는 사람의 댓글은 저장할 때 합쳐집니다.</p>}
    </div>
  )

  // '넓게 보기'는 창 전체를 덮어야 해서 body 에 바로 붙인다 (메뉴 칸의 틀 안에서는 창 전체로 못 나간다)
  const ui = (
      <div ref={root} className={`dbd dbd-${cols}${full ? ' dbd-full' : ''}`}>
        <div className="dbd-bar" role="toolbar" aria-label="제안 보드 도구">
          <div className="dbd-tools">
            {TOOLS.map(t => <button type="button" key={t.key} className={`dbd-tb${tool === t.key ? ' on' : ''}`} aria-pressed={tool === t.key} disabled={locked} title={`${t.label} (${t.hint})`} onClick={() => { setTool(t.key); if (t.key !== 'comment') setDraftPin(null); else setTab('notes') }}>{t.icon}<span>{t.label}</span>{t.key === 'comment' && open > 0 && <i className="dbd-count" title={`해결 안 된 댓글 ${open}개`}>{open}</i>}</button>)}
          </div>
          <div className="dbd-tools">
            <button type="button" className="dbd-ib" title="되돌리기 (Ctrl+Z)" aria-label="되돌리기" disabled={!hist.current.past.length} onClick={() => step('undo')}><Undo2 size={14} /></button>
            <button type="button" className="dbd-ib" title="다시 하기 (Ctrl+Shift+Z)" aria-label="다시 하기" disabled={!hist.current.future.length} onClick={() => step('redo')}><Redo2 size={14} /></button>
          </div>
          <div className="dbd-tools">
            <button type="button" className="dbd-ib" title="작게" aria-label="작게" onClick={() => canvas.current?.zoomBy(1 / 1.25)}><Minus size={14} /></button>
            <span className="dbd-zoom" aria-label="배율">{Math.round(zoom * 100)}%</span>
            <button type="button" className="dbd-ib" title="크게" aria-label="크게" onClick={() => canvas.current?.zoomBy(1.25)}><Plus size={14} /></button>
            <button type="button" className="dbd-tb" title="지금 페이지를 화면에 맞춥니다" onClick={() => canvas.current?.fit()}>맞춤</button>
            <button type="button" className="dbd-tb" title="실제 크기" onClick={() => canvas.current?.zoomTo(1)}>100%</button>
          </div>
          <span className="dbd-gap" />
          {peers.length > 0 && <span className="dbd-peers" title={peers.map(p => p.name).join(', ')}><Users size={13} />지금 보는 사람{peers.slice(0, 3).map(p => <i key={p.id}>{p.name}</i>)}{peers.length > 3 && <i>+{peers.length - 3}</i>}</span>}
          <span className={`dbd-status${saveState === 'error' || loadFailed ? ' err' : ''}`} role="status">{status}{saveState === 'error' && <> — <button type="button" className="dbd-link inline" onClick={() => void save()}>다시 시도</button></>}{loadFailed && <> — <button type="button" className="dbd-link inline" onClick={() => setLoadTick(n => n + 1)}>다시 불러오기</button></>}</span>
          <div className="dbd-tools">
            <button type="button" className="dbd-tb" disabled={locked} onClick={() => { setEditing(null); setPresent(Math.max(0, pages.findIndex(p => p.id === page.id))) }}><Play size={13} /><span>발표 보기</span></button>
            <button type="button" className="dbd-tb" disabled={locked} onClick={() => setPrinting(true)}><Printer size={13} /><span>인쇄 · PDF</span></button>
            <button type="button" className="dbd-ib" title={full ? '원래 크기로 (Esc)' : '넓게 보기'} aria-label={full ? '원래 크기로' : '넓게 보기'} onClick={() => { setFull(f => !f); window.setTimeout(() => canvas.current?.fit(), 60) }}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          </div>
        </div>
        {remote && <div className="dbd-remote" role="alert">
          <span><b>{remote.name}님이 방금 고쳤습니다.</b> 내가 고친 내용은 아직 저장하지 않았습니다. 불러오면 내가 방금 고친 것은 사라집니다.</span>
          <Button size="sm" onClick={() => void reload(true)}>불러오기</Button>
          <Button size="sm" kind="outline" title="알림을 닫고 내가 고친 보드를 저장합니다" onClick={() => setRemote(null)}>내 작업 유지</Button>
        </div>}
        <div className="dbd-body" ref={bodyEl} style={bodyH && cols !== 'slim' && !full ? { height: bodyH } : undefined}>
          <aside className="dbd-left" aria-label="페이지와 레이어">
            <div className="dbd-sec">
              <div className="dbd-sec-h"><b>페이지 {pages.length}</b><button type="button" className="dbd-ib" title="페이지 더하기" aria-label="페이지 더하기" disabled={locked} onClick={addPage}><Plus size={14} /></button></div>
              <ol className="dbd-pages">
                {pages.map((p, i) => <li key={p.id} className={p.id === page.id ? 'on' : ''}>
                  {renaming === p.id
                    ? <input className="input xs" autoFocus defaultValue={p.name} aria-label="페이지 이름" onBlur={e => { renamePage(p.id, e.target.value.trim() || p.name); setRenaming(null) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} />
                    : <button type="button" className="dbd-page-name" aria-current={p.id === page.id ? 'true' : undefined} onClick={() => go(p.id)} onDoubleClick={() => setRenaming(p.id)} title="누르면 이 페이지로 갑니다. 두 번 누르면 이름을 고칩니다."><i>{i + 1}</i><span>{p.name || '이름 없는 페이지'}</span></button>}
                  {p.id === page.id && renaming !== p.id && <span className="dbd-page-acts">
                    <button type="button" className="dbd-ib sm" title="위로" aria-label="위로" disabled={i === 0} onClick={() => movePage(p.id, -1)}><ArrowUp size={12} /></button>
                    <button type="button" className="dbd-ib sm" title="아래로" aria-label="아래로" disabled={i === pages.length - 1} onClick={() => movePage(p.id, 1)}><ArrowDown size={12} /></button>
                    <button type="button" className="dbd-ib sm" title="이름 고치기" aria-label="이름 고치기" onClick={() => setRenaming(p.id)}><Type size={12} /></button>
                    <button type="button" className="dbd-ib sm" title="복제" aria-label="페이지 복제" onClick={() => dupPage(p.id)}><Copy size={12} /></button>
                    <button type="button" className="dbd-ib sm" title="지우기" aria-label="페이지 지우기" onClick={() => delPage(p.id)}><Trash2 size={12} /></button>
                  </span>}
                </li>)}
              </ol>
              <div className="dbd-auto">
                <button type="button" className="dbd-tb" disabled={locked || busy} onClick={() => void fromOutline()} title="구성안 (글)의 항목마다 제목 · 본문 · 수치가 든 페이지를 한 장씩 만듭니다"><Wand2 size={13} />구성안에서 페이지 만들기</button>
                <button type="button" className="dbd-tb" disabled={locked} onClick={specPages} title="스펙북 종류마다 선정 · 확정한 항목을 카드로 늘어놓은 페이지를 만듭니다"><LayoutGrid size={13} />스펙 페이지 자동 만들기</button>
              </div>
            </div>
            <div className="dbd-sec grow">
              <div className="dbd-sec-h"><b>레이어 {page.els.length}</b></div>
              <ul className="dbd-layers">
                {[...page.els].sort((a, b) => b.z - a.z).map(e => <li key={e.id} className={sel.includes(e.id) ? 'on' : ''}>
                  <button type="button" onClick={ev => setSel(ev.shiftKey ? (sel.includes(e.id) ? sel.filter(x => x !== e.id) : [...sel, e.id]) : [e.id])}>{elLabel(e, specs, renders)}</button>
                  {e.locked && <Lock size={12} aria-label="잠김" />}
                </li>)}
                {!page.els.length && <li className="none">아직 놓은 것이 없습니다. 위의 도구나 오른쪽 스펙 탭에서 넣어 보세요.</li>}
              </ul>
            </div>
          </aside>
          <div className="dbd-stage">
            <DesignBoardCanvas ref={canvas} pages={pages} pins={pins} cur={page.id} sel={sel} tool={tool} editing={editing} pinSel={pinSel} draftPin={draftPin} readOnly={locked}
              onCur={id => { setCur(id); setSel([]) }} onSel={ids => { setSel(ids); if (ids.length) setTab(t => (t === 'notes' ? 'props' : t)) }} onEditing={setEditing} onCreate={create}
              onPin={(pg, x, y) => { setDraftPin({ page: pg, x, y }); setDraftText(''); setTab('notes'); if (pg !== curRef.current) setCur(pg) }} onPickPin={pickPin}
              onDropSpec={(id, pg, x, y) => addSpec(id, { page: pg, x, y })}
              onBegin={() => { dragging.current = true; dragBase.current = boardRef.current.pages }}
              onLive={ps => put({ ...boardRef.current, pages: ps })}
              onEnd={() => { dragging.current = false; const base = dragBase.current; dragBase.current = null; if (base && base !== boardRef.current.pages) { const h = hist.current; h.past.push(base); if (h.past.length > 100) h.past.shift(); h.future = []; h.tag = ''; touch(); setHistTick(n => n + 1) } }}
              onText={setText} onZoom={setZoom} />
            {(loading || loadFailed) && <div className="dbd-veil" role="status">{loading ? '보드를 불러오는 중…' : <>보드를 불러오지 못했습니다. 저장된 보드를 덮어쓰지 않도록 고치기를 막아 두었습니다. <button type="button" className="dbd-link inline" onClick={() => setLoadTick(n => n + 1)}>다시 불러오기</button></>}</div>}
            {tool !== 'select' && !locked && <div className="dbd-tip">{tool === 'comment' ? '댓글을 남길 자리를 페이지에서 눌러 주세요' : `${TOOLS.find(t => t.key === tool)?.label}을(를) 놓을 자리를 페이지에서 눌러 주세요`} · Esc 로 취소</div>}
          </div>
          <aside className="dbd-right" aria-label="속성 · 스펙 · 댓글">
            <div className="dbd-tabs" role="tablist">
              {([['props', '속성'], ['spec', '스펙'], ['notes', `댓글${open ? ` ${open}` : ''}`]] as [Tab, string][]).map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            {tab === 'props' ? propsTab : tab === 'spec' ? specTab : notesTab}
          </aside>
        </div>
        {present !== null && <Present pages={pages} start={present} onClose={() => setPresent(null)} />}
        {printing && createPortal(<div className="dbd-print" aria-hidden="true">{pages.map(p => <div className="dbd-print-sheet" key={p.id}><BoardPageView page={p} /></div>)}</div>, document.body)}
      </div>
  )
  return <BoardDataContext.Provider value={data}>{full ? createPortal(ui, document.body) : ui}</BoardDataContext.Provider>
}

