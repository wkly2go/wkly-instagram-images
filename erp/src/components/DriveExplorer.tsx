import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, Clipboard, Copy, Download, ExternalLink, FileText, FolderPlus, Folder, FolderOpen, HardDrive, LayoutGrid, Link2, List, Pencil, RefreshCw, Scissors, Search, Star, Clock, Users, Trash2, Upload } from 'lucide-react'
import { useApp } from '../lib/app'
import { copyInto, driveApi, DriveAuthError, editUrl, FOLDER_MIME, LIST_FIELDS, listChildren, moveFile, newFolder, renameFile, trashFile, uploadToDrive, YEAR_RE, type GFile } from '../lib/gdrive'
import type { DriveIndexFile } from '../lib/types'
import { openLink } from './WebSearch'
import { ask } from './Ask'

/**
 * 드라이브 탐색기 (대표 지시 2026-10-23 "구글 드라이브를 윈도우 폴더처럼, 바로 수정이나 복사하기 등 윈도우 폴더와 똑같은 환경")
 *  - 왼쪽 폴더 트리 · 주소 줄(뒤로 · 앞으로 · 위로) · 큰 아이콘 / 자세히 보기 · 정렬
 *  - 클릭 · Ctrl · Shift 다중 선택, 더블클릭 열기, 오른쪽 클릭 메뉴
 *  - Ctrl+C · Ctrl+X · Ctrl+V · Delete · F2 · Ctrl+A · Enter · Backspace · Alt+← →
 *  - 끌어다 놓기: 항목 → 폴더로 옮기기, 컴퓨터 파일 → 지금 폴더에 올리기
 *  - 20초마다 · 창으로 돌아올 때 저절로 새로 고침 (다른 사람이 바꾼 것도 바로 보임)
 *  - 안전 규칙 (대표 지시 2026-10-21): 기존 드라이브 자료는 열기 · 복사만. 만들기 · 이름 바꾸기 · 옮기기 · 삭제는 인트라넷 '#연도' 폴더 안에서만
 */
type Kind = 'folder' | 'my' | 'shared' | 'recent' | 'starred' | 'drives' | 'search' | 'idx'
export interface Loc {
  kind: Kind
  id?: string
  name: string
  driveId?: string
}
type View = 'grid' | 'list'
type SortKey = 'name' | 'modified' | 'type' | 'size'

const VIEW_KEY = 'wkly-explorer-view'
const isFolder = (f: GFile) => f.mimeType === FOLDER_MIME || f.mimeType === 'drive' || f.shortcutDetails?.targetMimeType === FOLDER_MIME
const targetId = (f: GFile) => f.shortcutDetails?.targetId ?? f.id
const isGoogleDoc = (m: string) => m.startsWith('application/vnd.google-apps.') && m !== FOLDER_MIME
const TYPE: Record<string, string> = {
  [FOLDER_MIME]: '폴더',
  drive: '공유 드라이브',
  'application/vnd.google-apps.document': '구글 문서',
  'application/vnd.google-apps.spreadsheet': '구글 시트',
  'application/vnd.google-apps.presentation': '구글 슬라이드',
  'application/vnd.google-apps.form': '구글 설문',
  'application/vnd.google-apps.shortcut': '바로 가기',
  'application/pdf': 'PDF',
}
const typeOf = (f: GFile) => TYPE[f.mimeType] ?? (f.mimeType.startsWith('image/') ? '이미지' : f.mimeType.startsWith('video/') ? '동영상' : f.mimeType.includes('zip') ? '압축 파일' : (f.name.split('.').pop() ?? '파일').toUpperCase() + ' 파일')
const sizeOf = (f: GFile) => {
  const n = Number(f.size ?? 0)
  if (!n || isFolder(f)) return ''
  return n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)}GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`
}
const when = (t?: string) => (t ? new Date(t).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/**
 * 탐색기 토큰: 이 브라우저의 구글 로그인이 있으면 그것, 없으면 회사 계정 연결(서버)에서 받은 1시간 토큰.
 * PC 프로그램 · 구글 로그인 안 한 팀원도 회사 드라이브를 바로 씀
 */
export function useExplorerToken(browserToken: string | null): { token: string | null; server: boolean; refresh: () => void; checked: boolean } {
  const { api } = useApp()
  const [server, setServer] = useState<{ token: string; expires_at: number } | null>(null)
  const [checked, setChecked] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (browserToken) return setChecked(true)
    let alive = true
    api
      .driveAccessToken()
      .then(r => alive && setServer(r))
      .catch(() => alive && setServer(null))
      .finally(() => alive && setChecked(true))
    return () => {
      alive = false
    }
  }, [api, browserToken, n])
  // 만료 5분 전에 새 토큰
  useEffect(() => {
    if (!server) return
    const id = window.setTimeout(() => setN(v => v + 1), Math.max(30_000, server.expires_at - Date.now() - 5 * 60_000))
    return () => window.clearTimeout(id)
  }, [server])
  return { token: browserToken ?? server?.token ?? null, server: !browserToken && !!server, refresh: () => setN(v => v + 1), checked }
}

/**
 * 탐색기 자료 출처 (2026-10-23 "구글 드라이브는 윈도우 폴더처럼")
 *  - google: 구글 드라이브 API (토큰 있을 때, 바로 고치기 · 복사 · 올리기)
 *  - index: 구글 연결 전에도 보이게, 서버가 5분마다 모은 프로젝트 폴더 목록(drive_index) + 프로젝트 · 회사 폴더 주소 (열기 · 링크만)
 */
export interface ExSource {
  readOnly: boolean
  roots: { loc: Loc; icon: typeof HardDrive; expandable?: boolean }[]
  list(loc: Loc): Promise<GFile[]>
  folders(loc: Loc): Promise<GFile[]>
  /** 비어 있을 때 안내 · 드라이브에서 열 주소 */
  emptyHint?(loc: Loc): { text: string; url?: string | null } | null
}

export interface IndexData {
  projects: { id: string; code: string | null; name: string; division: string; divisionName: string; url: string | null; status: string }[]
  files: DriveIndexFile[]
  company: { name: string; url: string }[]
  year: string
}

const asG = (f: DriveIndexFile): GFile => ({
  id: f.id,
  name: f.name,
  mimeType: f.mime_type ?? 'application/octet-stream',
  webViewLink: f.url ?? undefined,
  iconLink: f.icon_url ?? undefined,
  modifiedTime: f.modified_at ?? undefined,
  size: f.size != null ? String(f.size) : undefined,
})
const vfolder = (id: string, name: string, url?: string | null, modified?: string): GFile => ({ id, name, mimeType: FOLDER_MIME, webViewLink: url ?? undefined, modifiedTime: modified })

export function indexSource(d: IndexData): ExSource {
  const live = d.projects.filter(p => p.status !== '완료' && p.status !== '보류')
  const divs = [...new Map(live.map(p => [p.division, p.divisionName])).entries()]
  const latest = (pid: string) => d.files.filter(f => f.project_id === pid).reduce((m, f) => (f.modified_at && f.modified_at > m ? f.modified_at : m), '')
  const list = async (loc: Loc): Promise<GFile[]> => {
    const id = loc.id ?? ''
    if (id === 'year') return divs.map(([k, n]) => vfolder(`div:${k}`, `#${k === 'TW' ? 'WKLY' : k === 'AR' ? 'ARTERIOR' : k}_${d.year} · ${n}`))
    if (id.startsWith('div:')) return live.filter(p => p.division === id.slice(4)).map(p => vfolder(`proj:${p.id}`, `${p.code ? `${p.code}_` : ''}${p.name}`, p.url, latest(p.id) || undefined))
    if (id.startsWith('proj:')) {
      const pid = id.slice(5)
      return d.files.filter(f => f.project_id === pid && (!f.parent_id || !d.files.some(x => x.id === f.parent_id))).map(asG)
    }
    if (id === 'company') return d.company.map((c, i) => vfolder(`co:${i}`, c.name, c.url))
    if (id === 'recent') return d.files.filter(f => f.mime_type !== FOLDER_MIME).slice(0, 80).map(asG)
    if (loc.kind === 'search') {
      const k = loc.name.toLowerCase()
      return [...d.projects.filter(p => `${p.code ?? ''} ${p.name}`.toLowerCase().includes(k)).map(p => vfolder(`proj:${p.id}`, `${p.code ? `${p.code}_` : ''}${p.name}`, p.url)), ...d.files.filter(f => f.name.toLowerCase().includes(k)).slice(0, 200).map(asG)]
    }
    return d.files.filter(f => f.parent_id === id).map(asG)
  }
  return {
    readOnly: true,
    roots: [
      { loc: { kind: 'idx', id: 'year', name: `#${d.year} 프로젝트` }, icon: FolderOpen, expandable: true },
      { loc: { kind: 'idx', id: 'recent', name: '최근 바뀐 파일' }, icon: Clock },
      { loc: { kind: 'idx', id: 'company', name: '회사 공용 폴더' }, icon: Star, expandable: true },
    ],
    list,
    folders: async loc => (await list(loc)).filter(f => f.mimeType === FOLDER_MIME),
    emptyHint: loc => {
      const id = loc.id ?? ''
      const url = id.startsWith('proj:') ? d.projects.find(p => p.id === id.slice(5))?.url : id.startsWith('co:') ? d.company[Number(id.slice(3))]?.url : null
      if (id.startsWith('proj:') || id.startsWith('co:'))
        return { text: '아직 이 폴더 목록이 모이지 않았습니다. 회사 구글 계정을 연결하면 5분 안에 여기 보이고, 바로 고치기 · 복사 · 올리기가 됩니다.', url }
      return null
    },
  }
}

function googleSource(token: string): ExSource {
  return {
    readOnly: false,
    roots: ROOTS.map(r => ({ ...r, expandable: r.loc.kind === 'my' })),
    list: async loc => {
      if (loc.kind === 'folder' || loc.kind === 'my') return listChildren(token, loc.id ?? 'root', { driveId: loc.driveId })
      if (loc.kind === 'drives') {
        const r = await driveApi<{ drives?: { id: string; name: string }[] }>(token, 'drives?pageSize=100&fields=drives(id,name)')
        return (r.drives ?? []).map(d => ({ id: d.id, name: d.name, mimeType: 'drive' }))
      }
      const p = new URLSearchParams({ pageSize: '300', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives', fields: `files(${LIST_FIELDS})` })
      if (loc.kind === 'shared') (p.set('q', 'sharedWithMe and trashed = false'), p.delete('corpora'), p.delete('includeItemsFromAllDrives'))
      else if (loc.kind === 'recent') (p.set('q', `trashed = false and mimeType != '${FOLDER_MIME}'`), p.set('orderBy', 'modifiedTime desc'), p.set('pageSize', '80'))
      else if (loc.kind === 'starred') p.set('q', 'starred and trashed = false')
      else p.set('q', `name contains '${esc(loc.name)}' and trashed = false`)
      const r = await driveApi<{ files?: GFile[] }>(token, `files?${p}`)
      return r.files ?? []
    },
    folders: loc => listChildren(token, loc.id ?? 'root', { foldersOnly: true, driveId: loc.driveId }),
  }
}

// 클립보드는 화면을 옮겨도 남게 (윈도우처럼)
let clip: { mode: 'copy' | 'cut'; items: GFile[]; from: string } | null = null

const ROOTS: { loc: Loc; icon: typeof HardDrive }[] = [
  { loc: { kind: 'my', id: 'root', name: '내 드라이브' }, icon: HardDrive },
  { loc: { kind: 'shared', name: '공유 문서함' }, icon: Users },
  { loc: { kind: 'recent', name: '최근 문서' }, icon: Clock },
  { loc: { kind: 'starred', name: '중요 문서함' }, icon: Star },
  { loc: { kind: 'drives', name: '공유 드라이브' }, icon: HardDrive },
]

export function DriveExplorer({ token, source, companyFolders, start, onOpenDoc, onAuthError, banner }: { token: string | null; source?: ExSource; companyFolders: { name: string; id: string }[]; start?: Loc | null; onOpenDoc: (url: string) => void; onAuthError?: () => void; banner?: ReactNode }) {
  const { toast } = useApp()
  const tk = token ?? ''
  const src = useMemo(() => source ?? googleSource(tk), [source, tk])
  const [path, setPath] = useState<Loc[]>(() => [start ?? src.roots[0].loc])
  const [back, setBack] = useState<Loc[][]>([])
  const [fwd, setFwd] = useState<Loc[][]>([])
  const [items, setItems] = useState<GFile[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View) || 'grid'
    } catch {
      return 'grid'
    }
  })
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false })
  const [menu, setMenu] = useState<{ x: number; y: number; on: GFile | null } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [, setClipTick] = useState(0)
  const here = path[path.length - 1]
  const box = useRef<HTMLDivElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  // 인트라넷 '#연도' 폴더 안인지 (만들기 · 고치기 · 옮기기 · 삭제는 여기서만)
  const editable = !src.readOnly && here.kind === 'folder' && path.some(l => l.kind === 'folder' && YEAR_RE.test(l.name))
  const editableIn = (p: Loc[]) => !src.readOnly && p[p.length - 1]?.kind === 'folder' && p.some(l => l.kind === 'folder' && YEAR_RE.test(l.name))

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof DriveAuthError) onAuthError?.()
      const m = e instanceof Error ? e.message : '드라이브 작업을 하지 못했습니다.'
      setErr(m)
      toast(m)
    },
    [onAuthError, toast],
  )

  const fetchList = useCallback((loc: Loc) => src.list(loc), [src])
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const list = await fetchList(here)
        setItems(list)
        setErr('')
        // 사라진 항목은 선택에서 뺌
        setSel(s => new Set([...s].filter(id => list.some(f => f.id === id))))
      } catch (e) {
        if (!quiet) fail(e)
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [fetchList, here, fail],
  )
  useEffect(() => {
    setSel(new Set())
    setAnchor(null)
    void load()
  }, [load])
  // 실시간처럼: 20초마다 · 창으로 돌아올 때 조용히 새로 고침
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && !renaming && !menu && !busy && void load(true)
    const id = window.setInterval(tick, 20_000)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', tick)
    }
  }, [load, renaming, menu, busy])

  const go = (p: Loc[]) => {
    setBack(b => [...b, path].slice(-50))
    setFwd([])
    setPath(p)
    setMenu(null)
  }
  const goBack = () => back.length && (setFwd(f => [path, ...f]), setPath(back[back.length - 1]), setBack(b => b.slice(0, -1)))
  const goFwd = () => fwd.length && (setBack(b => [...b, path]), setPath(fwd[0]), setFwd(f => f.slice(1)))
  const goUp = () => path.length > 1 && go(path.slice(0, -1))

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1
    const val = (f: GFile) => (sort.key === 'modified' ? f.modifiedTime ?? '' : sort.key === 'type' ? typeOf(f) : sort.key === 'size' ? Number(f.size ?? 0) : f.name.toLowerCase())
    return [...items].sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0))
  }, [items, sort])
  const selected = sorted.filter(f => sel.has(f.id))

  const open = (f: GFile) => {
    if (here.kind === 'idx' || (src.readOnly && here.kind === 'search')) {
      if (isFolder(f)) return go([...(here.kind === 'idx' ? path : [here]), { kind: 'idx', id: f.id, name: f.name }])
      if (f.webViewLink) onOpenDoc(isGoogleDoc(f.mimeType) ? editUrl(f.webViewLink) : f.webViewLink)
      return
    }
    if (f.mimeType === 'drive') return go([...path, { kind: 'folder', id: f.id, name: f.name, driveId: f.id }])
    if (isFolder(f)) return go([...(here.kind === 'folder' || here.kind === 'my' ? path : [here]), { kind: 'folder', id: targetId(f), name: f.name, driveId: here.driveId }])
    if (f.webViewLink) onOpenDoc(isGoogleDoc(f.mimeType) ? editUrl(f.webViewLink) : f.webViewLink)
  }
  const click = (e: MouseEvent, f: GFile, i: number) => {
    e.stopPropagation()
    setMenu(null)
    if (e.shiftKey && anchor != null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]
      setSel(new Set(sorted.slice(a, b + 1).map(x => x.id)))
    } else if (e.ctrlKey || e.metaKey) {
      setSel(s => {
        const n = new Set(s)
        if (n.has(f.id)) n.delete(f.id)
        else n.add(f.id)
        return n
      })
      setAnchor(i)
    } else {
      setSel(new Set([f.id]))
      setAnchor(i)
    }
  }

  // ---------------------------------------------------------------- 작업
  const guard = (what: string) => {
    if (editable) return true
    toast(`${what}는 인트라넷 '#연도' 폴더 안에서만 됩니다. 기존 드라이브 자료는 열기 · 복사만 할 수 있어요.`)
    return false
  }
  const work = async (label: string, fn: () => Promise<void>, done?: string) => {
    setBusy(label)
    try {
      await fn()
      if (done) toast(done)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
      void load(true)
    }
  }
  const copySel = (mode: 'copy' | 'cut') => {
    if (!selected.length) return
    if (mode === 'cut' && !guard('잘라내기')) return
    clip = { mode, items: selected, from: here.id ?? '' }
    setClipTick(t => t + 1)
    toast(`${selected.length}개를 ${mode === 'copy' ? '복사' : '잘라내기'}했습니다. 붙여 넣을 폴더에서 Ctrl+V`)
  }
  const paste = () => {
    if (!clip || !clip.items.length) return
    if (!guard('붙여넣기')) return
    const c = clip
    const dest = here.id!
    void work(
      '붙여 넣는 중',
      async () => {
        for (const f of c.items) {
          if (c.mode === 'cut') {
            if (c.from === dest) continue
            await moveFile(tk, f.id, c.from, dest)
          } else {
            const exists = items.some(x => x.name === f.name)
            await copyInto(tk, f, dest, exists ? `${f.name} - 복사본` : f.name)
          }
        }
        if (c.mode === 'cut') clip = null
      },
      `${c.items.length}개를 ${c.mode === 'cut' ? '옮겼습니다' : '붙여 넣었습니다'}.`,
    )
  }
  const remove = async () => {
    if (!selected.length || !guard('삭제')) return
    if (!(await ask(`${selected.length === 1 ? `'${selected[0].name}'을(를)` : `${selected.length}개 항목을`} 삭제할까요?\n구글 드라이브 휴지통으로 옮겨지며 30일 안에 되살릴 수 있습니다.`))) return
    const list = selected
    void work('삭제하는 중', async () => {
      for (const f of list) await trashFile(tk, f.id)
    }, '휴지통으로 옮겼습니다.')
  }
  const startRename = () => {
    if (selected.length !== 1 || !guard('이름 바꾸기')) return
    setRenaming(selected[0].id)
  }
  const finishRename = (f: GFile, name: string) => {
    setRenaming(null)
    const v = name.trim()
    if (!v || v === f.name) return
    setItems(list => list.map(x => (x.id === f.id ? { ...x, name: v } : x)))
    void work('이름 바꾸는 중', () => renameFile(tk, f.id, v).then(() => undefined))
  }
  const makeFolder = async () => {
    if (!guard('새 폴더')) return
    let name = '새 폴더'
    for (let i = 2; items.some(x => x.name === name); i++) name = `새 폴더 (${i})`
    setBusy('폴더 만드는 중')
    try {
      const f = await newFolder(tk, name, here.id!)
      setItems(list => [...list, f])
      setSel(new Set([f.id]))
      setRenaming(f.id)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }
  const uploadFiles = (files: File[]) => {
    if (!files.length || !guard('파일 올리기')) return
    void work(`${files.length}개 올리는 중`, async () => {
      for (const file of files) await uploadToDrive(tk, file, here.id!)
    }, `${files.length}개를 올렸습니다.`)
  }
  const moveTo = (ids: string[], dest: GFile | Loc, destPath: Loc[]) => {
    const destId = 'mimeType' in dest ? targetId(dest) : dest.id
    if (!destId || !editable || !editableIn(destPath)) return toast("옮기기는 인트라넷 '#연도' 폴더 안끼리만 됩니다.")
    const list = items.filter(f => ids.includes(f.id) && f.id !== destId)
    if (!list.length) return
    void work('옮기는 중', async () => {
      for (const f of list) await moveFile(tk, f.id, here.id!, destId)
    }, `${list.length}개를 '${dest.name}'(으)로 옮겼습니다.`)
  }
  const copyLink = (f: GFile) => {
    if (!f.webViewLink) return
    void navigator.clipboard?.writeText(f.webViewLink).then(() => toast('링크를 복사했습니다.'))
  }
  const download = (f: GFile) => openLink(isGoogleDoc(f.mimeType) ? (f.webViewLink ?? '') : `https://drive.google.com/uc?export=download&id=${f.id}`)

  const onKey = (e: KeyboardEvent) => {
    if (renaming || (e.target as HTMLElement).tagName === 'INPUT') return
    const k = e.key.toLowerCase()
    const mod = e.ctrlKey || e.metaKey
    if (mod && k === 'a') (e.preventDefault(), setSel(new Set(sorted.map(f => f.id))))
    else if (mod && k === 'c') (e.preventDefault(), copySel('copy'))
    else if (mod && k === 'x') (e.preventDefault(), copySel('cut'))
    else if (mod && k === 'v') (e.preventDefault(), paste())
    else if (e.key === 'Delete') (e.preventDefault(), void remove())
    else if (e.key === 'F2') (e.preventDefault(), startRename())
    else if (e.key === 'Enter' && selected.length === 1) (e.preventDefault(), open(selected[0]))
    else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) (e.preventDefault(), goUp())
    else if (e.altKey && e.key === 'ArrowLeft') (e.preventDefault(), goBack())
    else if (e.altKey && e.key === 'ArrowRight') (e.preventDefault(), goFwd())
    else if (e.key === 'Escape') (setSel(new Set()), setMenu(null))
    else if (e.key === 'F5') (e.preventDefault(), void load())
    else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key) && sorted.length) {
      e.preventDefault()
      const cols = view === 'grid' ? Math.max(1, Math.floor((box.current?.clientWidth ?? 600) / 116)) : 1
      const step = e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : e.key === 'ArrowRight' ? 1 : -1
      const cur = anchor ?? -1
      const i = Math.min(sorted.length - 1, Math.max(0, cur + step))
      setAnchor(i)
      setSel(new Set([sorted[i].id]))
    }
  }
  const ctx = (e: MouseEvent, f: GFile | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (f && !sel.has(f.id)) setSel(new Set([f.id]))
    const r = box.current?.getBoundingClientRect()
    setMenu({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), on: f })
  }
  // 끌어다 놓기
  const dragStart = (e: DragEvent, f: GFile) => {
    const ids = sel.has(f.id) ? [...sel] : [f.id]
    if (!sel.has(f.id)) setSel(new Set([f.id]))
    e.dataTransfer.setData('application/x-wkly-drive', JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'move'
  }
  const dropOnItem = (e: DragEvent, f: GFile) => {
    const raw = e.dataTransfer.getData('application/x-wkly-drive')
    setDropOn(null)
    if (!raw || !isFolder(f)) return
    e.preventDefault()
    e.stopPropagation()
    moveTo(JSON.parse(raw) as string[], f, [...path, { kind: 'folder', id: targetId(f), name: f.name }])
  }
  const dropOnPane = (e: DragEvent) => {
    e.preventDefault()
    setDropOn(null)
    if (e.dataTransfer.files?.length) uploadFiles([...e.dataTransfer.files])
  }

  const cols: [SortKey, string][] = [
    ['name', '이름'],
    ['modified', '수정한 날짜'],
    ['type', '유형'],
    ['size', '크기'],
  ]
  const setV = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* 저장 안 됨 */
    }
  }
  const icon = (f: GFile, big = false) =>
    isFolder(f) ? (
      <Folder size={big ? 40 : 16} className="ex-folder" />
    ) : f.iconLink ? (
      <img src={big ? f.iconLink.replace(/\/16\//, '/64/') : f.iconLink} alt="" width={big ? 40 : 16} height={big ? 40 : 16} />
    ) : (
      <FileText size={big ? 40 : 16} />
    )
  const nameCell = (f: GFile) =>
    renaming === f.id ? (
      <input
        className="input ex-rename"
        autoFocus
        defaultValue={f.name}
        onClick={e => e.stopPropagation()}
        onFocus={e => {
          const dot = isFolder(f) ? -1 : e.currentTarget.value.lastIndexOf('.')
          e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length)
        }}
        onBlur={e => finishRename(f, e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') setRenaming(null)
          e.stopPropagation()
        }}
        aria-label="새 이름"
      />
    ) : (
      <span className="ex-name" title={f.name}>
        {f.name}
      </span>
    )

  return (
    <div className="explorer" onClick={() => setMenu(null)}>
      <div className="ex-bar">
        <button type="button" className="icon-btn sm" onClick={goBack} disabled={!back.length} aria-label="뒤로" title="뒤로 (Alt+←)">
          <ArrowLeft size={15} />
        </button>
        <button type="button" className="icon-btn sm" onClick={goFwd} disabled={!fwd.length} aria-label="앞으로" title="앞으로 (Alt+→)">
          <ArrowRight size={15} />
        </button>
        <button type="button" className="icon-btn sm" onClick={goUp} disabled={path.length < 2} aria-label="위로" title="상위 폴더 (Backspace)">
          <ArrowUp size={15} />
        </button>
        <div className="ex-address" role="navigation" aria-label="경로">
          {path.map((l, i) => (
            <span key={i} className="row" style={{ gap: 2 }}>
              {i > 0 && <ChevronRight size={12} />}
              <button type="button" className="ex-crumb" onClick={() => i < path.length - 1 && go(path.slice(0, i + 1))}>
                {l.kind === 'search' ? `검색: ${l.name}` : l.name}
              </button>
            </span>
          ))}
        </div>
        <button type="button" className="icon-btn sm" onClick={() => void load()} aria-label="새로 고침" title="새로 고침 (F5)">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
        <form
          className="ex-search"
          onSubmit={e => {
            e.preventDefault()
            if (q.trim()) go([{ kind: 'search', name: q.trim() }])
          }}
        >
          <Search size={13} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="드라이브 검색" aria-label="드라이브 검색" />
        </form>
      </div>
      <div className="ex-tools">
        <button type="button" className="ex-tool" onClick={() => void makeFolder()} disabled={!editable}>
          <FolderPlus size={14} /> 새 폴더
        </button>
        <button type="button" className="ex-tool" onClick={() => upload.current?.click()} disabled={!editable}>
          <Upload size={14} /> 올리기
        </button>
        <input ref={upload} type="file" multiple hidden onChange={e => (uploadFiles([...(e.target.files ?? [])]), (e.target.value = ''))} />
        <span className="ex-sep" />
        <button type="button" className="ex-tool" onClick={() => copySel('cut')} disabled={!selected.length || !editable} title="잘라내기 (Ctrl+X)">
          <Scissors size={14} /> 잘라내기
        </button>
        <button type="button" className="ex-tool" onClick={() => copySel('copy')} disabled={!selected.length} title="복사 (Ctrl+C)">
          <Copy size={14} /> 복사
        </button>
        <button type="button" className="ex-tool" onClick={paste} disabled={!clip || !editable} title="붙여넣기 (Ctrl+V)">
          <Clipboard size={14} /> 붙여넣기
        </button>
        <button type="button" className="ex-tool" onClick={startRename} disabled={selected.length !== 1 || !editable} title="이름 바꾸기 (F2)">
          <Pencil size={14} /> 이름 바꾸기
        </button>
        <button type="button" className="ex-tool" onClick={() => void remove()} disabled={!selected.length || !editable} title="삭제 (Delete)">
          <Trash2 size={14} /> 삭제
        </button>
        <span className="grow" />
        {busy && <span className="t-cap">{busy}…</span>}
        {src.readOnly ? <span className="t-cap ex-ro">보기 전용 · 열기 · 링크</span> : !editable && here.kind === 'folder' && <span className="t-cap ex-ro">읽기 · 복사만 (기존 자료)</span>}
        <button type="button" className={`icon-btn sm${view === 'grid' ? ' on' : ''}`} onClick={() => setV('grid')} aria-label="큰 아이콘" title="큰 아이콘">
          <LayoutGrid size={14} />
        </button>
        <button type="button" className={`icon-btn sm${view === 'list' ? ' on' : ''}`} onClick={() => setV('list')} aria-label="자세히" title="자세히">
          <List size={14} />
        </button>
      </div>
      {banner}
      <div className="ex-body">
        <nav className="ex-tree" aria-label="폴더">
          <div className="ex-tree-head">{src.readOnly ? '회사 드라이브' : '구글 드라이브'}</div>
          {src.roots.map(r => (
            <TreeNode key={r.loc.name} src={src} loc={r.loc} icon={r.icon} path={[r.loc]} current={path} onPick={go} expandable={!!r.expandable} onDropItems={(ids, p) => moveTo(ids, p[p.length - 1], p)} />
          ))}
          {!src.readOnly && companyFolders.length > 0 && <div className="ex-tree-head">회사 폴더</div>}
          {!src.readOnly &&
            companyFolders.map(f => {
              const loc: Loc = { kind: 'folder', id: f.id, name: f.name }
              return <TreeNode key={f.id} src={src} loc={loc} icon={FolderOpen} path={[loc]} current={path} onPick={go} expandable onDropItems={(ids, p) => moveTo(ids, p[p.length - 1], p)} />
            })}
        </nav>
        <div
          ref={box}
          className={`ex-pane ${view}${dropOn === '__pane' ? ' drop' : ''}`}
          tabIndex={0}
          onKeyDown={onKey}
          onClick={() => (setSel(new Set()), setMenu(null))}
          onContextMenu={e => ctx(e, null)}
          onDragOver={e => {
            if (e.dataTransfer.types.includes('Files')) (e.preventDefault(), setDropOn('__pane'))
          }}
          onDragLeave={() => setDropOn(null)}
          onDrop={dropOnPane}
          aria-label="파일 목록"
        >
          {view === 'list' && (
            <div className="ex-head">
              {cols.map(([k, l]) => (
                <button key={k} type="button" className={`ex-col ${k}`} onClick={e => (e.stopPropagation(), setSort(s => ({ key: k, desc: s.key === k ? !s.desc : false })))}>
                  {l}
                  {sort.key === k && <ChevronDown size={12} style={{ transform: sort.desc ? 'none' : 'rotate(180deg)' }} />}
                </button>
              ))}
            </div>
          )}
          {!loading && !sorted.length && (
            <div className="ex-empty">
              {src.emptyHint?.(here)?.text ?? (editable ? '비어 있습니다. 파일을 끌어다 놓으면 올라갑니다.' : '이 폴더는 비어 있습니다.')}
              {src.emptyHint?.(here)?.url && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => openLink(src.emptyHint!(here)!.url!)}>
                    구글 드라이브에서 이 폴더 열기
                  </button>
                </div>
              )}
            </div>
          )}
          {sorted.map((f, i) => (
            <div
              key={f.id}
              className={`ex-item${sel.has(f.id) ? ' sel' : ''}${clip?.mode === 'cut' && clip.items.some(c => c.id === f.id) ? ' cut' : ''}${dropOn === f.id ? ' drop' : ''}`}
              draggable={editable && renaming !== f.id}
              onDragStart={e => dragStart(e, f)}
              onDragOver={e => {
                if (isFolder(f) && e.dataTransfer.types.includes('application/x-wkly-drive')) (e.preventDefault(), setDropOn(f.id))
              }}
              onDragLeave={() => setDropOn(d => (d === f.id ? null : d))}
              onDrop={e => dropOnItem(e, f)}
              onClick={e => click(e, f, i)}
              onDoubleClick={() => open(f)}
              onContextMenu={e => ctx(e, f)}
              role="option"
              aria-selected={sel.has(f.id)}
            >
              {view === 'grid' ? (
                <>
                  <span className="ex-icon">{icon(f, true)}</span>
                  {nameCell(f)}
                </>
              ) : (
                <>
                  <span className="ex-col name">
                    {icon(f)}
                    {nameCell(f)}
                  </span>
                  <span className="ex-col modified">{when(f.modifiedTime)}</span>
                  <span className="ex-col type">{typeOf(f)}</span>
                  <span className="ex-col size">{sizeOf(f)}</span>
                </>
              )}
            </div>
          ))}
          {menu && (
            <div className="ex-menu" style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()} role="menu">
              {menu.on ? (
                <>
                  <MenuItem icon={FolderOpen} label="열기" onClick={() => (setMenu(null), open(menu.on!))} />
                  {menu.on.webViewLink && <MenuItem icon={ExternalLink} label="새 창에서 열기" onClick={() => (setMenu(null), openLink(menu.on!.webViewLink!))} />}
                  <hr />
                  <MenuItem icon={Scissors} label="잘라내기" hint="Ctrl+X" disabled={!editable} onClick={() => (setMenu(null), copySel('cut'))} />
                  <MenuItem icon={Copy} label="복사" hint="Ctrl+C" onClick={() => (setMenu(null), copySel('copy'))} />
                  {isFolder(menu.on) && clip && <MenuItem icon={Clipboard} label="이 폴더에 붙여넣기" disabled={!editable} onClick={() => (setMenu(null), open(menu.on!))} />}
                  <hr />
                  <MenuItem icon={Pencil} label="이름 바꾸기" hint="F2" disabled={!editable || selected.length !== 1} onClick={() => (setMenu(null), startRename())} />
                  <MenuItem icon={Trash2} label="삭제" hint="Delete" disabled={!editable} onClick={() => (setMenu(null), void remove())} />
                  <hr />
                  <MenuItem icon={Link2} label="링크 복사" onClick={() => (setMenu(null), copyLink(menu.on!))} />
                  {!isFolder(menu.on) && <MenuItem icon={Download} label="내려받기" onClick={() => (setMenu(null), download(menu.on!))} />}
                </>
              ) : (
                <>
                  <MenuItem icon={Clipboard} label="붙여넣기" hint="Ctrl+V" disabled={!clip || !editable} onClick={() => (setMenu(null), paste())} />
                  <MenuItem icon={FolderPlus} label="새 폴더" disabled={!editable} onClick={() => (setMenu(null), void makeFolder())} />
                  <MenuItem icon={Upload} label="파일 올리기" disabled={!editable} onClick={() => (setMenu(null), upload.current?.click())} />
                  <hr />
                  <MenuItem icon={RefreshCw} label="새로 고침" hint="F5" onClick={() => (setMenu(null), void load())} />
                  <MenuItem icon={LayoutGrid} label={view === 'grid' ? '자세히 보기' : '큰 아이콘 보기'} onClick={() => (setMenu(null), setV(view === 'grid' ? 'list' : 'grid'))} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="ex-status">
        <span>{sorted.length}개 항목</span>
        {selected.length > 0 && <span>{selected.length}개 선택</span>}
        {clip && <span>{clip.mode === 'cut' ? '잘라낸' : '복사한'} 항목 {clip.items.length}개 · 붙여넣기 대기</span>}
        <span className="grow" />
        {err && <span className="t-red">{err}</span>}
        <span>{src.readOnly ? '5분마다 서버가 모은 목록' : '20초마다 저절로 새로 고침'}</span>
      </div>
    </div>
  )
}

function MenuItem({ icon: Icon, label, hint, disabled, onClick }: { icon: typeof Folder; label: string; hint?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="ex-mi" disabled={disabled} onClick={onClick}>
      <Icon size={14} />
      <span className="grow">{label}</span>
      {hint && <span className="ex-hint">{hint}</span>}
    </button>
  )
}

/** 왼쪽 폴더 트리 (펼칠 때 하위 폴더를 불러옴) */
function TreeNode({ src, loc, icon: Icon, path, current, onPick, expandable, onDropItems, depth = 0 }: { src: ExSource; loc: Loc; icon: typeof Folder; path: Loc[]; current: Loc[]; onPick: (p: Loc[]) => void; expandable?: boolean; onDropItems: (ids: string[], p: Loc[]) => void; depth?: number }) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState<GFile[] | null>(null)
  const [over, setOver] = useState(false)
  const active = current.length === path.length && current.every((l, i) => l.kind === path[i].kind && l.id === path[i].id && l.name === path[i].name)
  const onPath = current.length > path.length && path.every((l, i) => current[i]?.id === l.id && current[i]?.name === l.name)
  // 지금 보고 있는 폴더까지 저절로 펼침
  useEffect(() => {
    if (onPath && expandable) setOpen(true)
  }, [onPath, expandable])
  useEffect(() => {
    if (!open || kids || !expandable) return
    src
      .folders(loc)
      .then(setKids)
      .catch(() => setKids([]))
  }, [open, kids, expandable, src, loc])
  return (
    <div>
      <div
        className={`ex-node${active ? ' on' : ''}${over ? ' drop' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => onPick(path)}
        onDragOver={e => {
          if (loc.kind === 'folder' && e.dataTransfer.types.includes('application/x-wkly-drive')) (e.preventDefault(), setOver(true))
        }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          setOver(false)
          const raw = e.dataTransfer.getData('application/x-wkly-drive')
          if (raw) (e.preventDefault(), onDropItems(JSON.parse(raw) as string[], path))
        }}
      >
        {expandable ? (
          <button type="button" className="ex-twisty" onClick={e => (e.stopPropagation(), setOpen(o => !o))} aria-label={open ? '접기' : '펼치기'}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="ex-twisty" />
        )}
        <Icon size={14} className={YEAR_RE.test(loc.name) ? 't-blue' : ''} />
        <span className="truncate">{loc.name}</span>
      </div>
      {open &&
        kids?.map(k => {
          const child: Loc = { kind: loc.kind === 'idx' ? 'idx' : 'folder', id: k.shortcutDetails?.targetId ?? k.id, name: k.name, driveId: loc.driveId }
          return <TreeNode key={k.id} src={src} loc={child} icon={Folder} path={[...path, child]} current={current} onPick={onPick} expandable onDropItems={onDropItems} depth={depth + 1} />
        })}
      {open && kids && !kids.length && depth < 8 && <div className="ex-node empty" style={{ paddingLeft: 30 + depth * 12 }}>(하위 폴더 없음)</div>}
    </div>
  )
}
