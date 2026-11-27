// 협업 화이트보드 편집기 (로드맵 3단계 · 2026-11-20) — /board 화면과 프로젝트 화면(바로 아래 열기 · 2026-11-27)이 함께 씀
//  - Excalidraw(MIT · 무료)를 인트라넷 안에서. 그리면 2초 뒤 자동 저장 · 사진은 비공개 보관함에 올리고 경로만 저장
//  - 같은 보드를 다른 사람이 저장하면 알림을 받아 요소별로 합침(내가 고치던 것은 그대로) · 지금 보는 사람 표시
//  - 저장이 어긋나면(다른 사람이 먼저 저장) 서버 그림과 합쳐 다시 저장 — 지워지는 것 없음
//  - PNG 내려받기. 이 화면을 열면 채팅 칸 · 오른쪽 일정 칸을 숨겨 넓게 씀
import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw, exportToBlob, exportToSvg } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import { ArrowLeft, Copy, Download, FileDown, Figma, Maximize2, Minimize2, Upload, Users, X } from 'lucide-react'
import { useApp } from '../lib/app'
import { Link } from '../lib/router'
import { boardFilePath, boardTitle, mergeElements, sceneForSave, sceneSignature, type BoardElement, type BoardFileRef, type BoardScene } from '../lib/board'
import type { BoardLive, BoardPeer, ProjectBoard } from '../lib/boardApi'
import { imagesToPdf } from '../lib/imagePdf'
import { BoardFigmaImport, type FigmaPicked } from './BoardFigmaImport'
import { figmaToSkeleton, placeTexts, type FigmaContent } from '../lib/figmaToBoard'
import '../pages/Board.css'

type ExApi = Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0]
type BinaryFile = { id: string; mimeType: string; dataURL: string; created: number }
type SaveState = '불러오는 중' | '저장됨' | '고치는 중' | '저장 중' | '저장 실패' | '읽기 전용'

const SAVE_DELAY = 2000
const blobToDataURL = (b: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(b) })

export default function BoardEditor({ id, embedded = false, onClose }: { id: string; embedded?: boolean; onClose?: () => void }) {
  const { api, me, toast } = useApp()
  const wrap = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [figmaOpen, setFigmaOpen] = useState(false)
  const [toFigma, setToFigma] = useState(false)
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

  // 전체 화면 (브라우저 전체 화면 · Esc 로 나옴)
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrap.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await wrap.current?.requestFullscreen()
    } catch { toast('이 브라우저에서는 전체 화면을 쓸 수 없습니다.') }
  }

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

  /** 피그마로 내보내기 (2026-11-27 대표 '우리 화이트보드 컨텐츠를 피그마로 전부 내보내기'):
   *  피그마 공개 API 는 파일에 쓰기를 열어 두지 않아, 보드를 SVG 로 만들어 줌 — 복사해 피그마에 붙여 넣으면 글 · 도형 · 선이 고칠 수 있는 층으로 들어감.
   *  고른 요소가 있으면 그것만, 없으면 보드 전체 */
  const boardSvg = async () => {
    const x = ex.current
    if (!x) return null
    const all = x.getSceneElements()
    const picked = x.getAppState().selectedElementIds ?? {}
    const sel = all.filter(e => picked[e.id])
    const els = sel.length ? sel : all
    if (!els.length) { toast('보드가 비어 있습니다.'); return null }
    const svg = await exportToSvg({ elements: els, appState: { ...x.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff', exportEmbedScene: false }, files: x.getFiles(), exportPadding: 24, skipInliningFonts: true } as never)
    return { text: new XMLSerializer().serializeToString(svg), count: els.length, part: sel.length > 0 }
  }
  const copyForFigma = async () => {
    try {
      const r = await boardSvg()
      if (!r) return
      await navigator.clipboard.writeText(r.text)
      toast(`${r.part ? '고른 ' : ''}요소 ${r.count}개를 복사했습니다. 피그마 파일을 열고 붙여 넣기(⌘V · Ctrl+V) 하면 고칠 수 있는 층으로 들어갑니다.`)
      setToFigma(false)
    } catch (e) { toast(e instanceof Error ? `복사하지 못했습니다: ${e.message}` : '복사하지 못했습니다. ‘SVG 파일로 받기’를 써 주세요.') }
  }
  const downloadSvg = async () => {
    const r = await boardSvg()
    if (!r) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([r.text], { type: 'image/svg+xml' }))
    a.download = `${boardTitle(title)}.svg`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    toast('SVG 파일을 받았습니다. 피그마 캔버스에 끌어다 놓으면 고칠 수 있는 층으로 들어갑니다.')
    setToFigma(false)
  }

  /** PDF: 프레임(Excalidraw 프레임 도구)이 있으면 프레임마다 한 쪽, 없으면 보드 전체 한 쪽 */
  const downloadPdf = async () => {
    const x = ex.current
    if (!x) return
    const els = x.getSceneElements()
    if (!els.length) { toast('보드가 비어 있습니다.'); return }
    const frames = els.filter(e => e.type === 'frame' || e.type === 'magicframe').sort((a, b) => a.y - b.y || a.x - b.x)
    const pages: { jpeg: Uint8Array; width: number; height: number }[] = []
    const one = async (frame?: (typeof els)[number]) => {
      const blob = await exportToBlob({ elements: els, appState: { ...x.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff', exportScale: 2 }, files: x.getFiles(), mimeType: 'image/jpeg', quality: 0.92, exportPadding: frame ? 0 : 24, ...(frame ? { exportingFrame: frame } : {}) } as never)
      const bmp = await createImageBitmap(blob)
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: bmp.width, height: bmp.height })
      bmp.close()
    }
    try {
      if (frames.length) for (const f of frames) await one(f)
      else await one()
      const pdf = imagesToPdf(pages, boardTitle(title))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }))
      a.download = `${boardTitle(title)}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      toast(frames.length ? `프레임 ${frames.length}개를 ${frames.length}쪽 PDF 로 내려받았습니다.` : 'PDF 로 내려받았습니다. 프레임을 그리면 프레임마다 한 쪽이 됩니다.')
    } catch (e) { toast(e instanceof Error ? e.message : 'PDF 를 만들지 못했습니다.') }
  }

  /** 피그마 프레임 그림을 보드 오른쪽 빈 곳에 나란히 붙임 */
  const addFigma = (picked: FigmaPicked[]) => {
    const x = ex.current
    if (!x || !picked.length) return
    const els = x.getSceneElements()
    const right = els.length ? Math.max(...els.map(e => e.x + e.width)) + 80 : 0
    const top = els.length ? Math.min(...els.map(e => e.y)) : 0
    const now = Date.now()
    x.addFiles(picked.map((p, i) => ({ id: p.fileId, mimeType: p.mime, dataURL: p.dataURL, created: now + i })) as never)
    let cx = right
    const skeleton = picked.map(p => {
      const w = Math.min(1200, p.w || 800), h = Math.round((p.h || 600) * (w / (p.w || 800)))
      const el = { type: 'image' as const, fileId: p.fileId, x: cx, y: top, width: w, height: h }
      cx += w + 60
      return el
    })
    const added = convertToExcalidrawElements(skeleton as never)
    x.updateScene({ elements: [...x.getSceneElementsIncludingDeleted(), ...added] as never })
    x.scrollToContent(added as never, { fitToContent: true })
    toast(`피그마 프레임 ${picked.length}개를 붙였습니다.`)
  }

  /** 피그마 프레임 안 요소를 수정 가능한 보드 요소로 붙임 (피그마 배치 그대로 · 보드 오른쪽 빈 곳) */
  const addFigmaContent = (c: FigmaContent) => {
    const x = ex.current
    if (!x) return
    const els = x.getSceneElements()
    const at = { x: els.length ? Math.max(...els.map(e => e.x + e.width)) + 120 : 0, y: els.length ? Math.min(...els.map(e => e.y)) : 0 }
    const out = figmaToSkeleton(c, at)
    if (!out.count) { toast('불러올 요소가 없습니다.'); return }
    if (out.files.length) x.addFiles(out.files as never)
    const added = placeTexts(convertToExcalidrawElements(out.skeleton as never, { regenerateIds: false } as never) as never, out.textBoxes) as never as ReturnType<typeof convertToExcalidrawElements>
    x.updateScene({ elements: [...x.getSceneElementsIncludingDeleted(), ...added] as never })
    x.scrollToContent(added as never, { fitToContent: true })
    const cut = c.frames.some(f => f.truncated)
    const miss = out.rasterMissing
    toast(`피그마 요소 ${out.count}개를 붙였습니다. 글 · 도형을 눌러 바로 고칠 수 있습니다.${cut ? ' (요소가 많아 일부만)' : ''}${miss ? ` 그림 ${miss}개는 자리만 표시했습니다.` : ''}`)
  }

  if (error) return (
    <div className={`board-page board-msg${embedded ? ' embedded' : ''}`}>
      <p role="alert">{error}</p>
      {embedded ? <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>닫기</button> : <Link to="/projects">프로젝트로 돌아가기</Link>}
    </div>
  )
  const others = peers.filter(p => p.id !== me.id)
  return (
    <div className={`board-page${embedded ? ' embedded' : ''}${full ? ' is-full' : ''}`} ref={wrap}>
      <div className="board-bar">
        {!embedded && (board?.project_id ? <Link to={`/projects?id=${board.project_id}`} className="board-back" title="프로젝트로"><ArrowLeft size={14} /> 프로젝트</Link> : <Link to="/boards" className="board-back" title="화이트보드 목록으로"><ArrowLeft size={14} /> 화이트보드</Link>)}
        <input className="board-title" value={title} maxLength={60} aria-label="보드 이름" onChange={e => setTitle(e.target.value)} onBlur={() => void rename()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} disabled={!board} />
        <span className={`board-state s-${state.replace(/\s/g, '')}`} role="status">{state}</span>
        <span className="board-peers" title={peers.map(p => p.name).join(', ')}><Users size={13} /> {others.length ? `${others.map(p => p.name).join(' · ')} 함께 보는 중` : '혼자 보는 중'}</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setFigmaOpen(true)} disabled={!board} title="피그마 주소나 연결한 파일의 프레임을 수정 가능한 요소로 불러오기"><Figma size={13} /> 피그마 불러오기</button>
        <span className="board-tofigma">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setToFigma(v => !v)} disabled={!board} aria-expanded={toFigma} title="보드(또는 고른 요소)를 피그마로"><Upload size={13} /> 피그마로 내보내기</button>
          {toFigma && (
            <span className="board-tofigma-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void copyForFigma()}><Copy size={13} /> 복사 → 피그마에 붙여 넣기<small>글 · 도형 · 선이 고칠 수 있는 층으로</small></button>
              <button type="button" role="menuitem" onClick={() => void downloadSvg()}><Download size={13} /> SVG 파일로 받기<small>피그마 캔버스에 끌어다 놓기</small></button>
              <small className="board-tofigma-note">요소를 골라 두면 고른 것만, 아니면 보드 전체 · 피그마 원본 파일에 바로 쓰는 것은 피그마가 막아 둠</small>
            </span>
          )}
        </span>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void downloadPng()} disabled={!board}><Download size={13} /> PNG</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void downloadPdf()} disabled={!board} title="프레임마다 한 쪽 (프레임이 없으면 보드 전체 한 쪽)"><FileDown size={13} /> PDF</button>
        <button type="button" className="icon-btn board-full" onClick={() => void toggleFull()} title={full ? '전체 화면 끝 (Esc)' : '전체 화면'} aria-label={full ? '전체 화면 끝' : '전체 화면'}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        {embedded && onClose && <button type="button" className="icon-btn" onClick={onClose} title="보드 닫기" aria-label="보드 닫기"><X size={14} /></button>}
      </div>
      {figmaOpen && board && <BoardFigmaImport projectId={board.project_id} onClose={() => setFigmaOpen(false)} onPick={p => { setFigmaOpen(false); addFigma(p) }} onContent={c => { setFigmaOpen(false); addFigmaContent(c) }} />}
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
