// 협업 화이트보드 화면 (로드맵 3단계 · 2026-11-20 · /board?id=<보드 id>)
//  - Excalidraw(MIT · 무료)를 인트라넷 안에서. 그리면 2초 뒤 자동 저장 · 사진은 비공개 보관함에 올리고 경로만 저장
//  - 같은 보드를 다른 사람이 저장하면 알림을 받아 요소별로 합침(내가 고치던 것은 그대로) · 지금 보는 사람 표시
//  - 저장이 어긋나면(다른 사람이 먼저 저장) 서버 그림과 합쳐 다시 저장 — 지워지는 것 없음
//  - PNG 내려받기. 이 화면을 열면 채팅 칸 · 오른쪽 일정 칸을 숨겨 넓게 씀
import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { ArrowLeft, Download, Users } from 'lucide-react'
import { useApp } from '../lib/app'
import { Link, useRouter } from '../lib/router'
import { boardFilePath, boardTitle, mergeElements, sceneForSave, sceneSignature, type BoardElement, type BoardFileRef, type BoardScene } from '../lib/board'
import type { BoardLive, BoardPeer, ProjectBoard } from '../lib/boardApi'
import './Board.css'

type ExApi = Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0]
type BinaryFile = { id: string; mimeType: string; dataURL: string; created: number }
type SaveState = '불러오는 중' | '저장됨' | '고치는 중' | '저장 중' | '저장 실패' | '읽기 전용'

const SAVE_DELAY = 2000
const blobToDataURL = (b: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(b) })

export default function BoardPage() {
  const { api, me, toast } = useApp()
  const { query } = useRouter()
  const id = query.get('id') ?? ''
  const [board, setBoard] = useState<ProjectBoard | null>(null)
  const [initial, setInitial] = useState<{ elements: BoardElement[]; files: BinaryFile[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<SaveState>('불러오는 중')
  const [peers, setPeers] = useState<BoardPeer[]>([])
  const [title, setTitle] = useState('')
  const ex = useRef<ExApi | null>(null)
  const version = useRef(1)
  const savedSig = useRef('')
  const fileRefs = useRef<Record<string, BoardFileRef>>({})
  const timer = useRef<number | null>(null)
  const saving = useRef(false)
  const live = useRef<BoardLive | null>(null)

  // 넓게 보기
  useEffect(() => {
    document.documentElement.setAttribute('data-board-wide', '1')
    return () => document.documentElement.removeAttribute('data-board-wide')
  }, [])

  /** 보관함 사진 → Excalidraw 파일 (이미 화면에 있는 것은 건너뜀) */
  const loadFiles = useCallback(async (refs: Record<string, BoardFileRef>, have: Set<string>) => {
    const out: BinaryFile[] = []
    for (const f of Object.values(refs)) {
      if (have.has(f.id)) continue
      try { out.push({ id: f.id, mimeType: f.mimeType, created: f.created, dataURL: await blobToDataURL(await api.downloadBoardFile(f.path)) }) } catch { /* 못 받은 사진은 빈 칸으로 */ }
    }
    return out
  }, [api])

  // 처음 불러오기
  useEffect(() => {
    let alive = true
    setError(null); setState('불러오는 중'); setInitial(null)
    if (!id) { setError('보드 주소가 올바르지 않습니다.'); return }
    void (async () => {
      try {
        const got = await api.getBoard(id)
        if (!alive) return
        if (!got) { setError('보드를 찾을 수 없습니다. 지워졌거나 권한이 없습니다.'); return }
        const files = await loadFiles(got.scene.files, new Set())
        if (!alive) return
        version.current = got.board.version
        fileRefs.current = { ...got.scene.files }
        savedSig.current = sceneSignature(got.scene.elements)
        setBoard(got.board); setTitle(got.board.title)
        setInitial({ elements: got.scene.elements, files })
        setState('저장됨')
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : '보드를 불러오지 못했습니다.') }
    })()
    return () => { alive = false }
  }, [api, id, loadFiles])

  /** 서버 그림을 지금 화면과 합침 */
  const mergeRemote = useCallback(async (remote: BoardScene, remoteVersion: number) => {
    const x = ex.current
    if (!x) return
    const local = x.getSceneElementsIncludingDeleted() as unknown as BoardElement[]
    const merged = mergeElements(local, remote.elements)
    const newFiles = await loadFiles(remote.files, new Set(Object.keys(x.getFiles())))
    if (newFiles.length) x.addFiles(newFiles as never)
    fileRefs.current = { ...remote.files, ...fileRefs.current }
    x.updateScene({ elements: merged as never })
    version.current = remoteVersion
    // 합친 결과가 서버와 같으면 저장할 것 없음
    if (sceneSignature(merged) === sceneSignature(remote.elements)) savedSig.current = sceneSignature(merged)
  }, [loadFiles])

  /** 저장: 새 사진 먼저 올리고 · 버전이 맞으면 저장 · 어긋나면 합쳐서 다시 (3번까지) */
  const save = useCallback(async () => {
    const x = ex.current
    if (!x || !board || saving.current) return
    saving.current = true
    setState('저장 중')
    try {
      for (let tryNo = 0; tryNo < 3; tryNo++) {
        const elements = x.getSceneElementsIncludingDeleted() as unknown as BoardElement[]
        const sig = sceneSignature(elements)
        if (sig === savedSig.current) { setState('저장됨'); return }
        // 새로 붙인 사진 올리기
        const files = x.getFiles() as unknown as Record<string, BinaryFile>
        for (const e of elements) {
          const fid = e.fileId as string | undefined
          if (!fid || e.isDeleted || fileRefs.current[fid] || !files[fid]) continue
          const f = files[fid]
          const path = boardFilePath(board.id, fid, f.mimeType)
          await api.uploadBoardFile(path, await (await fetch(f.dataURL)).blob())
          fileRefs.current[fid] = { id: fid, mimeType: f.mimeType, path, created: f.created }
        }
        const r = await api.saveBoard(board.id, sceneForSave(elements, fileRefs.current), version.current)
        if (r.ok) {
          version.current = r.version
          savedSig.current = sig
          live.current?.saved(r.version)
          const now = sceneSignature(x.getSceneElementsIncludingDeleted() as unknown as BoardElement[])
          setState(now === sig ? '저장됨' : '고치는 중')
          return
        }
        toast(`${r.updated_by_name}님이 먼저 저장해 두 사람의 그림을 합쳤습니다.`)
        await mergeRemote(r.scene, r.version)
      }
      setState('저장 실패')
    } catch (e) {
      setState('저장 실패')
      toast(e instanceof Error ? e.message : '저장하지 못했습니다.')
    } finally {
      saving.current = false
    }
  }, [api, board, mergeRemote, toast])

  const schedule = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { timer.current = null; void save() }, SAVE_DELAY)
  }, [save])

  // 같은 보드를 연 사람 · 다른 사람이 저장하면 합침
  useEffect(() => {
    if (!board) return
    const l = api.watchBoard(board.id, { id: me.id, name: me.name }, {
      peers: setPeers,
      saved: p => {
        if (p.id === me.id || p.version <= version.current) return
        void (async () => {
          const got = await api.getBoard(board.id).catch(() => null)
          if (got && got.board.version > version.current) await mergeRemote(got.scene, got.board.version)
        })()
      },
    })
    live.current = l
    return () => { l.close(); live.current = null }
  }, [api, board, me.id, me.name, mergeRemote])

  // 닫기 전 저장 안 한 것 경고 · 화면을 떠날 때 마지막 저장
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (timer.current || saving.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null; void save() }
    }
  }, [save])

  const onChange = useCallback((elements: readonly unknown[]) => {
    if (state === '불러오는 중') return
    if (sceneSignature(elements as BoardElement[]) === savedSig.current) return
    setState(s => (s === '저장 중' ? s : '고치는 중'))
    schedule()
  }, [schedule, state])

  const rename = async () => {
    const t = boardTitle(title)
    if (!board || t === board.title) { setTitle(board?.title ?? t); return }
    try { await api.renameBoard(board.id, t); setBoard({ ...board, title: t }); setTitle(t) } catch (e) { toast(e instanceof Error ? e.message : '이름을 바꾸지 못했습니다.'); setTitle(board.title) }
  }

  const downloadPng = async () => {
    const x = ex.current
    if (!x) return
    const els = x.getSceneElements()
    if (!els.length) { toast('보드가 비어 있습니다.'); return }
    const blob = await exportToBlob({ elements: els, appState: { ...x.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff' }, files: x.getFiles(), mimeType: 'image/png', exportPadding: 24 })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${boardTitle(title)}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  if (error) return (
    <div className="board-page board-msg">
      <p role="alert">{error}</p>
      <Link to="/projects">프로젝트로 돌아가기</Link>
    </div>
  )
  const others = peers.filter(p => p.id !== me.id)
  return (
    <div className="board-page">
      <div className="board-bar">
        <Link to={board ? `/projects?id=${board.project_id}` : '/projects'} className="board-back" title="프로젝트로"><ArrowLeft size={14} /> 프로젝트</Link>
        <input className="board-title" value={title} maxLength={60} aria-label="보드 이름" onChange={e => setTitle(e.target.value)} onBlur={() => void rename()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} disabled={!board} />
        <span className={`board-state s-${state.replace(/\s/g, '')}`} role="status">{state}</span>
        <span className="board-peers" title={peers.map(p => p.name).join(', ')}><Users size={13} /> {others.length ? `${others.map(p => p.name).join(' · ')} 함께 보는 중` : '혼자 보는 중'}</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void downloadPng()} disabled={!board}><Download size={13} /> PNG</button>
      </div>
      <div className="board-canvas">
        {initial ? (
          <Excalidraw
            excalidrawAPI={a => { ex.current = a }}
            initialData={{ elements: initial.elements as never, files: Object.fromEntries(initial.files.map(f => [f.id, f])) as never, appState: { viewBackgroundColor: '#ffffff' }, scrollToContent: true }}
            onChange={els => onChange(els)}
            langCode="ko-KR"
            theme="light"
            isCollaborating={others.length > 0}
            UIOptions={{ canvasActions: { saveToActiveFile: false, toggleTheme: false } }}
          />
        ) : <p className="board-msg" role="status">보드를 불러오는 중입니다.</p>}
      </div>
    </div>
  )
}
