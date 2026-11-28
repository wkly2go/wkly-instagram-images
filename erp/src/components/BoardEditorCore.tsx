// 협업 화이트보드 편집기 (로드맵 3단계 · 2026-11-20) — /board 화면과 프로젝트 화면(바로 아래 열기 · 2026-11-27)이 함께 씀
//  - Excalidraw(MIT · 무료)를 인트라넷 안에서. 그리면 2초 뒤 자동 저장 · 사진은 비공개 보관함에 올리고 경로만 저장
//  - 같은 보드를 다른 사람이 저장하면 알림을 받아 요소별로 합침(내가 고치던 것은 그대로) · 지금 보는 사람 표시
//  - 저장이 어긋나면(다른 사람이 먼저 저장) 서버 그림과 합쳐 다시 저장 — 지워지는 것 없음
//  - 2026-11-27 외부 협업: 이 파일은 로그인 화면(useApp)에 기대지 않음 — 팀원은 BoardEditor.tsx 가, 외부인은 GuestBoards.tsx 가 api · 나 · 알림을 넘겨 줌
//  - PNG 내려받기. 이 화면을 열면 채팅 칸 · 오른쪽 일정 칸을 숨겨 넓게 씀
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Excalidraw, exportToBlob, exportToSvg } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import { ArrowLeft, ChevronDown, ChevronUp, Copy, Download, FileDown, FileUp, Figma, Map as MapIcon, Maximize2, Minimize2, Plus, Presentation, Upload, Users, X } from 'lucide-react'
import { Link } from '../lib/router'
import { boardFilePath, boardTitle, mergeElements, pool, saveDelay, sceneForSave, sceneSignature, type BoardElement, type BoardFileRef, type BoardScene } from '../lib/board'
import type { BoardApi, BoardLive, BoardPeer, ProjectBoard } from '../lib/boardApi'
import { collaboratorsOf, type CursorPeer, type CursorRoom } from '../lib/boardCursors'
import { imagesToPdf } from '../lib/imagePdf'
import { figmaToSkeleton, placeTexts, type FigmaContent } from '../lib/figmaToBoard'
import { BoardMinimap, type MinimapSize, type MinimapSource } from './BoardMinimap'
import { nextPagePlace, pageLabel, pageList, PAGE_SIZES, type PageBox, type PageKind } from '../lib/boardPages'
import { BOARD_FONT, installBoardFonts, svgFontsForFigma } from '../lib/boardFonts'
import '../pages/Board.css'

type ExApi = Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0]
type BinaryFile = { id: string; mimeType: string; dataURL: string; created: number }
type SaveState = '불러오는 중' | '저장됨' | '고치는 중' | '저장 중' | '저장 실패' | '읽기 전용'

/** 보드 사진은 경로가 곧 내용(바뀌지 않음) → 이 브라우저에 보관해 다시 열 때 서버에서 안 받음 (로그아웃하면 지움 · supabaseApi.signOut) */
const FILE_CACHE = 'wkly-board-files'
async function cachedBlob(path: string, fetchIt: () => Promise<Blob>): Promise<Blob> {
  const key = `/__board-file/${path}`
  try {
    const c = await caches.open(FILE_CACHE)
    const hit = await c.match(key)
    if (hit) return await hit.blob()
    const b = await fetchIt()
    if (b.size) void c.put(key, new Response(b, { headers: { 'Content-Type': b.type || 'application/octet-stream' } })).catch(() => {})
    return b
  } catch { return fetchIt() }
}

const blobToDataURL = (b: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(b) })

export interface FigmaPicked { fileId: string; name: string; w: number; h: number; mime: string; dataURL: string }
/** 편집기가 쓰는 것만 (팀원 = 인트라넷 API · 외부인 = 협업방 서버 함수) */
export type BoardSource = Pick<BoardApi, 'getBoard' | 'saveBoard' | 'uploadBoardFile' | 'downloadBoardFile' | 'watchBoard' | 'watchCursors' | 'renameBoard'>
export interface BoardEditorCoreProps {
  id: string
  embedded?: boolean
  onClose?: () => void
  api: BoardSource
  me: { id: string; name: string }
  toast: (text: string) => void
  /** 외부인: 이름 고치기 · 피그마 · 브라우저 사진 보관 없음 */
  guest?: boolean
  /** 보기만 (외부인에게 '보기만'으로 공유한 보드) */
  readOnly?: boolean
  /** 피그마 불러오기 창 (팀원 화면만 넘김) */
  figma?: (p: { projectId: string | null; onClose: () => void; onPick: (p: FigmaPicked[]) => void; onContent: (c: FigmaContent) => void }) => ReactNode
}

export default function BoardEditorCore({ id, embedded = false, onClose, api, me, toast, guest = false, readOnly = false, figma }: BoardEditorCoreProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [figmaOpen, setFigmaOpen] = useState(false)
  const [toFigma, setToFigma] = useState(false)
  // 전체 보기 지도 (켜고 끈 것은 이 브라우저에 기억 · 기본 켬)
  // 도구 줄(페이지 · 내보내기 · 피그마 · 전체 보기 지도)은 접어 둘 수 있음 — 기본은 접힘 (2026-11-28 대표 지시)
  const [toolsOn, setToolsOn] = useState(() => { try { return localStorage.getItem('wkly-board-tools') === '1' } catch { return false } })
  const toggleTools = (on: boolean) => { setToolsOn(on); try { localStorage.setItem('wkly-board-tools', on ? '1' : '0') } catch { /* 저장 못 해도 동작 */ } }
  const [mapOn, setMapOn] = useState(() => { try { return localStorage.getItem('wkly-board-map') !== '0' } catch { return true } })
  const toggleMap = (on: boolean) => { setMapOn(on); try { localStorage.setItem('wkly-board-map', on ? '1' : '0') } catch { /* 저장 못 해도 그대로 */ } }
  const [mapSize, setMapSize] = useState<MinimapSize>(() => { try { return localStorage.getItem('wkly-board-map-size') === 'large' ? 'large' : 'small' } catch { return 'small' } })
  const sizeMap = (v: MinimapSize) => { setMapSize(v); try { localStorage.setItem('wkly-board-map-size', v) } catch { /* 그대로 */ } }
  // 페이지 줄: 프레임 목록 (0.6초마다 바뀐 때만)
  const [pages, setPages] = useState<PageBox[]>([])
  const [pageKind, setPageKind] = useState<PageKind>('slide')
  const pptIn = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const mapSource = useCallback(() => ex.current as unknown as MinimapSource | null, [])
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
  const room = useRef<CursorRoom | null>(null)
  const [cursors, setCursors] = useState<CursorPeer[]>([])

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
    const want = Object.values(refs).filter(f => !have.has(f.id))
    // 6장씩 나란히 (예전엔 한 장씩 차례로 — 사진 60장 보드가 한참 걸림) · 못 받은 사진은 빈 칸으로
    const got = await pool(want, 6, async f => ({ id: f.id, mimeType: f.mimeType, created: f.created, dataURL: await blobToDataURL(guest ? await api.downloadBoardFile(f.path) : await cachedBlob(f.path, () => api.downloadBoardFile(f.path))) }))
    const out = got.filter((f): f is BinaryFile => !!f)
    return out
  }, [api, guest])

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
        version.current = got.board.version
        fileRefs.current = { ...got.scene.files }
        savedSig.current = sceneSignature(got.scene.elements)
        setBoard(got.board); setTitle(got.board.title)
        // 그림(요소)을 먼저 띄우고 사진은 뒤에서 받아 채움 (사진을 다 받을 때까지 빈 화면이던 것 고침)
        // 빈 보드에는 인쇄 · 발표용 첫 페이지(16:9)를 기본으로 놓음 (2026-11-28 · 저장은 무언가 그린 뒤 함께)
        const first = !readOnly && !got.scene.elements.some(e => !e.isDeleted)
          ? convertToExcalidrawElements([{ type: 'frame', ...nextPagePlace([], 'slide'), children: [] }] as never) as never as BoardElement[]
          : []
        if (first.length) savedSig.current = sceneSignature([...got.scene.elements, ...first])
        setInitial({ elements: [...got.scene.elements, ...first], files: [] })
        setState(readOnly ? '읽기 전용' : '저장됨')
        void loadFiles(got.scene.files, new Set()).then(async files => {
          if (!alive || !files.length) return
          for (let i = 0; i < 100 && alive && !ex.current; i++) await new Promise(r => setTimeout(r, 50))
          if (alive) ex.current?.addFiles(files as never)
        })
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : '보드를 불러오지 못했습니다.') }
    })()
    return () => { alive = false }
  }, [api, id, loadFiles, readOnly])

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
    if (!x || !board || saving.current || readOnly) return
    saving.current = true
    setState('저장 중')
    try {
      for (let tryNo = 0; tryNo < 3; tryNo++) {
        const elements = x.getSceneElementsIncludingDeleted() as unknown as BoardElement[]
        const sig = sceneSignature(elements)
        if (sig === savedSig.current) { setState('저장됨'); return }
        // 새로 붙인 사진 올리기
        const files = x.getFiles() as unknown as Record<string, BinaryFile>
        const fresh = [...new Set(elements.filter(e => e.fileId && !e.isDeleted && !fileRefs.current[e.fileId as string] && files[e.fileId as string]).map(e => e.fileId as string))]
        const up = await pool(fresh, 4, async fid => {
          const f = files[fid]
          const path = boardFilePath(board.id, fid, f.mimeType)
          const blob = await (await fetch(f.dataURL)).blob()
          await api.uploadBoardFile(path, blob)
          fileRefs.current[fid] = { id: fid, mimeType: f.mimeType, path, created: f.created }
          return true
        })
        if (up.some(v => !v)) throw new Error('사진 일부를 올리지 못했습니다. 잠시 뒤 다시 저장합니다.')
        const r = await api.saveBoard(board.id, sceneForSave(elements, fileRefs.current), version.current)
        if (r.ok) {
          version.current = r.version
          savedSig.current = sig
          live.current?.saved(r.version)
          room.current?.saved(r.version)
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
  }, [api, board, mergeRemote, toast, readOnly])

  const schedule = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { timer.current = null; void save() }, saveDelay(ex.current?.getSceneElementsIncludingDeleted().length ?? 0))
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

  // 실시간 커서: 같은 보드를 연 팀원 · 외부인의 마우스 위치 (방송만 · 저장 없음) + 상대가 저장하면 바로 합침
  const liveKey = board?.live_key
  useEffect(() => {
    if (!board || !liveKey || !api.watchCursors) return
    let asked = 0
    const r = api.watchCursors(liveKey, { id: me.id, name: me.name }, {
      cursors: setCursors,
      saved: p => {
        // 남이 보낸 숫자는 믿지 않고 서버에서 다시 읽음 (2초에 한 번까지)
        if (p.version <= version.current || Date.now() - asked < 2_000) return
        asked = Date.now()
        void (async () => {
          const got = await api.getBoard(board.id).catch(() => null)
          if (got && got.board.version > version.current) await mergeRemote(got.scene, got.board.version)
        })()
      },
    })
    room.current = r
    return () => { r.close(); room.current = null; setCursors([]) }
  }, [api, board, liveKey, me.id, me.name, mergeRemote])
  useEffect(() => {
    ex.current?.updateScene({ collaborators: collaboratorsOf(cursors) as never })
  }, [cursors, initial])

  // 닫기 전 저장 안 한 것 경고 · 화면을 떠날 때 마지막 저장
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (timer.current || saving.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null; void save() }
    }
  }, [save])

  const lastEls = useRef<readonly unknown[] | null>(null)
  const lastSum = useRef(-1)
  const onChange = useCallback((elements: readonly unknown[]) => {
    if (state === '불러오는 중' || readOnly) return
    // Excalidraw 는 마우스 이동 · 확대 · 고르기에도 부름 → 요소 배열이 그대로면 바로 지나가고, 버전 합이 같아도 지나감(요소 8천 개에서 글자 해시를 매번 돌리지 않게)
    if (elements === lastEls.current) return
    lastEls.current = elements
    let sum = elements.length
    for (const e of elements as BoardElement[]) sum += e.version
    if (sum === lastSum.current) return
    lastSum.current = sum
    if (sceneSignature(elements as BoardElement[]) === savedSig.current) return
    setState(s => (s === '저장 중' ? s : '고치는 중'))
    schedule()
  }, [schedule, state, readOnly])

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
    return { text: svgFontsForFigma(new XMLSerializer().serializeToString(svg)), count: els.length, part: sel.length > 0 }
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

  useEffect(() => {
    if (!initial) return
    let sig = ''
    const tick = () => {
      const x = ex.current
      if (!x || document.visibilityState !== 'visible') return
      const list = pageList(x.getSceneElements() as never as PageBox[])
      const next = list.map(p => `${p.id}:${p.name ?? ''}:${Math.round(p.x)}:${Math.round(p.y)}`).join('|')
      if (next !== sig) { sig = next; setPages(list) }
    }
    tick()
    const t = window.setInterval(tick, 600)
    return () => window.clearInterval(t)
  }, [initial])

  /** 페이지(슬라이드 · A4) 한 장 추가 → 그 페이지로 이동 */
  const addPage = (kind: PageKind) => {
    const x = ex.current
    if (!x || readOnly) return
    const added = convertToExcalidrawElements([{ type: 'frame', ...nextPagePlace(x.getSceneElements() as never as PageBox[], kind), children: [] }] as never)
    x.updateScene({ elements: [...x.getSceneElementsIncludingDeleted(), ...added] as never })
    x.scrollToContent(added as never, { fitToContent: true, animate: true })
  }
  const goPage = (id: string) => {
    const x = ex.current
    const el = x?.getSceneElements().find(e => e.id === id)
    if (x && el) x.scrollToContent(el as never, { fitToContent: true, animate: true })
  }

  /** PPT 내보내기: 페이지마다 슬라이드 한 장 — 글은 고칠 수 있는 글 상자, 나머지는 그림 */
  const downloadPptx = async () => {
    const x = ex.current
    if (!x || busy) return
    const els = x.getSceneElements()
    const frames = pageList(els as never as PageBox[])
    if (!frames.length) { toast('페이지가 없습니다. 위 ‘슬라이드 추가’로 페이지를 만든 뒤 내보내 주세요.'); return }
    setBusy('PPT 만드는 중')
    try {
      const { buildPptx } = await import('../lib/pptxExport')
      const slides = []
      for (const f of frames) {
        const full = els.find(e => e.id === f.id)!
        const texts = els.filter(e => e.type === 'text' && (e as { frameId?: string | null }).frameId === f.id)
        const skip = new Set(texts.map(t => t.id))
        const blob = await exportToBlob({ elements: els.filter(e => !skip.has(e.id)), appState: { ...x.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff', exportScale: f.width > 1400 ? 1 : 2 }, files: x.getFiles(), mimeType: 'image/jpeg', quality: 0.92, exportPadding: 0, exportingFrame: full } as never)
        slides.push({ image: await blobToDataURL(blob), frame: f, texts: texts as never })
      }
      const out = await buildPptx(slides, boardTitle(title))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(out)
      a.download = `${boardTitle(title)}.pptx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      toast(`페이지 ${frames.length}장을 PPT 로 내려받았습니다. 글은 파워포인트에서 바로 고칠 수 있습니다.`)
    } catch (e) { toast(e instanceof Error ? e.message : 'PPT 를 만들지 못했습니다.') } finally { setBusy('') }
  }

  /** PPT 불러오기: 슬라이드마다 페이지 하나 · 글 · 도형 · 사진을 고칠 수 있는 요소로 (이 브라우저 안에서 읽음) */
  const importPptx = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy('PPT 읽는 중')
    try {
      const { readPptxFile } = await import('../lib/pptxImport')
      const c = await readPptxFile(file)
      // 페이지 이름은 지금 있는 페이지 뒤 번호로 이어 붙임
      const base = pageList((ex.current?.getSceneElements() ?? []) as never as PageBox[]).length
      let n = 0
      for (const f of c.frames) for (const e of f.els) if (e.kind === 'frame') e.name = `슬라이드 ${base + ++n}`
      await addFigmaContent(c, `PPT 슬라이드 ${c.slides}장을 페이지로 불러왔습니다.${c.skipped ? ` 표 · 차트 등 ${c.skipped}개는 옮기지 못했습니다.` : ''}${c.missingImages ? ` 그림 ${c.missingImages}개는 자리만 표시했습니다.` : ''}`)
    } catch (e) { toast(e instanceof Error ? e.message : 'PPT 를 읽지 못했습니다.') } finally { setBusy(''); if (pptIn.current) pptIn.current.value = '' }
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
  const addFigmaContent = async (c: FigmaContent, done?: string) => {
    const x = ex.current
    if (!x) return
    await installBoardFonts() // 글 폭을 우리 글꼴로 재도록
    const els = x.getSceneElements()
    // PPT 는 아래 빈 줄에(페이지 줄이 이어지게) · 피그마는 오른쪽 빈 곳에
    const at = done
      ? { x: els.length ? Math.min(...els.map(e => e.x)) : 0, y: els.length ? Math.max(...els.map(e => e.y + e.height)) + 120 : 0 }
      : { x: els.length ? Math.max(...els.map(e => e.x + e.width)) + 120 : 0, y: els.length ? Math.min(...els.map(e => e.y)) : 0 }
    const out = figmaToSkeleton(c, at)
    if (!out.count) { toast('불러올 요소가 없습니다.'); return }
    if (out.files.length) x.addFiles(out.files as never)
    const added = placeTexts(convertToExcalidrawElements(out.skeleton as never, { regenerateIds: false } as never) as never, out.textBoxes) as never as ReturnType<typeof convertToExcalidrawElements>
    x.updateScene({ elements: [...x.getSceneElementsIncludingDeleted(), ...added] as never })
    x.scrollToContent(added as never, { fitToContent: true })
    const cut = c.frames.some(f => f.truncated)
    const miss = out.rasterMissing
    if (done) { toast(done); return }
    toast(`피그마 요소 ${out.count}개를 붙였습니다. 글 · 도형을 눌러 바로 고칠 수 있습니다.${cut ? ' (요소가 많아 일부만)' : ''}${miss ? ` 그림 ${miss}개는 자리만 표시했습니다.` : ''}`)
  }

  if (error) return (
    <div className={`board-page board-msg${embedded ? ' embedded' : ''}`}>
      <p role="alert">{error}</p>
      {embedded ? <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>닫기</button> : <Link to="/projects">프로젝트로 돌아가기</Link>}
    </div>
  )
  // 접속 표시(팀원끼리) + 커서가 보이는 사람(팀원 · 외부인)
  const others = [...new Map([...peers, ...cursors].filter(p => p.id !== me.id).map(p => [p.id, p.name])).entries()].map(([id, name]) => ({ id, name }))
  return (
    <div className={`board-page${embedded ? ' embedded' : ''}${full ? ' is-full' : ''}`} ref={wrap}>
      <div className="board-bar">
        {!embedded && (board?.project_id ? <Link to={`/projects?id=${board.project_id}`} className="board-back" title="프로젝트로"><ArrowLeft size={14} /> 프로젝트</Link> : <Link to="/boards" className="board-back" title="화이트보드 목록으로"><ArrowLeft size={14} /> 화이트보드</Link>)}
        <input className="board-title" value={title} maxLength={60} aria-label="보드 이름" onChange={e => setTitle(e.target.value)} onBlur={() => void rename()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} disabled={!board || guest} />
        <span className={`board-state s-${state.replace(/\s/g, '')}`} role="status">{state}</span>
        {(!guest || others.length > 0) && <span className="board-peers" title={others.map(p => p.name).join(', ')}><Users size={13} /> {others.length ? `${others.map(p => p.name).join(' · ')} 함께 보는 중` : '혼자 보는 중'}</span>}
        <button type="button" className={`btn btn-outline btn-sm board-toolsbtn${toolsOn ? ' on' : ''}`} onClick={() => toggleTools(!toolsOn)} aria-expanded={toolsOn} title={toolsOn ? '도구 줄 · 전체 보기 지도 접기' : '페이지 · 내보내기 · 피그마 · 전체 보기 지도 펼치기'}>{toolsOn ? <ChevronUp size={13} /> : <ChevronDown size={13} />} 도구</button>
        <button type="button" className="icon-btn board-full" onClick={() => void toggleFull()} title={full ? '전체 화면 끝 (Esc)' : '전체 화면'} aria-label={full ? '전체 화면 끝' : '전체 화면'}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        {embedded && onClose && <button type="button" className="icon-btn" onClick={onClose} title="보드 닫기" aria-label="보드 닫기"><X size={14} /></button>}
      </div>
      {toolsOn && <div className="board-pages" role="group" aria-label="페이지 · 도구">
        <span className="board-pages-label">페이지</span>
        {pages.map((p, i) => <button key={p.id} type="button" className="board-page-chip" onClick={() => goPage(p.id)} title={`${pageLabel(p, i)} 로 이동`}><i>{i + 1}</i>{pageLabel(p, i)}</button>)}
        {!pages.length && <span className="board-pages-empty">아직 없음 — 페이지를 만들면 PDF · PPT 가 페이지마다 한 장으로 나옵니다</span>}
        {!readOnly && <>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => addPage(pageKind)} disabled={!board}><Plus size={13} /> {PAGE_SIZES[pageKind].name === 'A4' ? '페이지 추가' : '슬라이드 추가'}</button>
          <select value={pageKind} onChange={e => setPageKind(e.target.value as PageKind)} aria-label="페이지 크기">
            {(Object.keys(PAGE_SIZES) as PageKind[]).map(k => <option key={k} value={k}>{PAGE_SIZES[k].label}</option>)}
          </select>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => pptIn.current?.click()} disabled={!board || !!busy} title="파워포인트(.pptx) 슬라이드를 페이지로 — 글 · 도형 · 사진을 고칠 수 있는 요소로"><FileUp size={13} /> {busy === 'PPT 읽는 중' ? busy : 'PPT 불러오기'}</button>
        </>}
        <span className="board-pages-gap" />
        {figma && !readOnly && <button type="button" className="btn btn-outline btn-sm" onClick={() => setFigmaOpen(true)} disabled={!board} title="피그마 주소나 연결한 파일의 프레임을 수정 가능한 요소로 불러오기"><Figma size={13} /> 피그마 불러오기</button>}
        {!guest && <span className="board-tofigma">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setToFigma(v => !v)} disabled={!board} aria-expanded={toFigma} title="보드(또는 고른 요소)를 피그마로"><Upload size={13} /> 피그마로 내보내기</button>
          {toFigma && (
            <span className="board-tofigma-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void copyForFigma()}><Copy size={13} /> 복사 → 피그마에 붙여 넣기<small>글 · 도형 · 선이 고칠 수 있는 층으로</small></button>
              <button type="button" role="menuitem" onClick={() => void downloadSvg()}><Download size={13} /> SVG 파일로 받기<small>피그마 캔버스에 끌어다 놓기</small></button>
              <small className="board-tofigma-note">요소를 골라 두면 고른 것만, 아니면 보드 전체 · 피그마 원본 파일에 바로 쓰는 것은 피그마가 막아 둠</small>
            </span>
          )}
        </span>}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void downloadPng()} disabled={!board}><Download size={13} /> PNG</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void downloadPdf()} disabled={!board} title="프레임마다 한 쪽 (프레임이 없으면 보드 전체 한 쪽)"><FileDown size={13} /> PDF</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void downloadPptx()} disabled={!board || !!busy} title="페이지마다 슬라이드 한 장 · 글은 파워포인트에서 고칠 수 있음"><Presentation size={13} /> {busy === 'PPT 만드는 중' ? busy : 'PPT'}</button>
        <button type="button" className={`icon-btn board-mapbtn${mapOn ? ' on' : ''}`} onClick={() => toggleMap(!mapOn)} title={mapOn ? '전체 보기 지도 숨기기' : '전체 보기 지도 — 보드 전체에서 지금 위치를 보고 눌러서 이동'} aria-label="전체 보기 지도" aria-pressed={mapOn}><MapIcon size={14} /></button>
      </div>}
      <input ref={pptIn} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden onChange={e => void importPptx(e.target.files?.[0])} />
      {figmaOpen && board && figma?.({ projectId: board.project_id, onClose: () => setFigmaOpen(false), onPick: p => { setFigmaOpen(false); addFigma(p) }, onContent: c => { setFigmaOpen(false); void addFigmaContent(c) } })}
      <div className="board-canvas">
        {initial ? (
          <Excalidraw
            excalidrawAPI={a => { ex.current = a; void installBoardFonts() }}
            initialData={{ elements: initial.elements as never, files: Object.fromEntries(initial.files.map(f => [f.id, f])) as never, appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: BOARD_FONT.regular }, scrollToContent: true }}
            onChange={els => onChange(els)}
            onPointerUpdate={p => room.current?.move(p.pointer.x, p.pointer.y)}
            langCode="ko-KR"
            theme="light"
            isCollaborating={others.length > 0}
            viewModeEnabled={readOnly}
            UIOptions={{ canvasActions: { saveToActiveFile: false, toggleTheme: false } }}
          />
        ) : <p className="board-msg" role="status">보드를 불러오는 중입니다.</p>}
        {initial && mapOn && toolsOn && <BoardMinimap source={mapSource} onHide={() => toggleMap(false)} size={mapSize} onSize={sizeMap} />}
      </div>
    </div>
  )
}
